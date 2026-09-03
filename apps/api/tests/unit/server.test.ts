import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemorySessionStore } from "../../src/auth/memorySessionStore.js";
import { MemoryUserStore } from "../../src/auth/memoryUserStore.js";
import { hashPassword } from "../../src/auth/password.js";
import { seedAdmin } from "../../src/auth/seedAdmin.js";
import type { AppConfig } from "../../src/config.js";
import type { PRD } from "../../src/schemas/prdSchema.js";
import { buildServer } from "../../src/server.js";
import { TaskService, type TaskGraphRunner } from "../../src/services/taskService.js";
import type { Storage, StoredFile } from "../../src/storage/index.js";

const repoPublic = path.resolve(
  fileURLToPath(new URL("../../../../public", import.meta.url)),
);

const config: AppConfig = {
  port: 3000,
  apiKey: "test-api-key",
  openaiApiKey: "",
  openaiBaseUrl: null,
  structuredOutputMethod: null,
  extractModel: "test-extract",
  prdModel: "test-prd",
  uploadDir: "unused",
  maxFileBytes: 1024,
  maxTotalBytes: 2048,
  maxFiles: 2,
  langsmithTracing: false,
  adminUser: "admin",
  adminPassword: "admin-change-me",
  sessionTtlMs: 60_000,
  cookieSecure: false,
  webDistDir: path.join(repoPublic, "web"),
  publicDir: repoPublic,
  corsOrigin: "http://localhost:5173",
};

const runner: TaskGraphRunner = {
  async *run() {
    yield { status: "completed", progress: 100 };
  },
};

const prd: PRD = {
  title: "Exportable PRD",
  version: "1.0.0",
  date: "2026-09-02",
  language: "en-US",
  background: "Export test",
  objectives: [],
  targetUsers: [],
  assumptions: [],
  outOfScope: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  userStories: [],
  userFlows: [],
  openQuestions: [],
  technicalConsiderations: [],
  prototypeDescription: "None",
};

const storage: Storage = {
  async save(input): Promise<StoredFile> {
    return {
      storageKey: input.originalName,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.buffer.length,
      absolutePath: input.originalName,
    };
  },
  async read() {
    return Buffer.alloc(0);
  },
  async remove() {},
};

function multipart(fields: Record<string, string>) {
  const boundary = "route-test-boundary";
  const payload =
    Object.entries(fields)
      .map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      )
      .join("") + `--${boundary}--\r\n`;
  return {
    payload,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  };
}

function multipartWithoutAuth(fields: Record<string, string>) {
  const request = multipart(fields);
  const { authorization: _authorization, ...headers } = request.headers;
  return { ...request, headers };
}

function multipartWithFile(
  fields: Record<string, string>,
  file: { name: string; filename: string; content: string; mimeType?: string },
) {
  const boundary = "route-test-boundary";
  const fieldParts = Object.entries(fields)
    .map(
      ([name, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )
    .join("");
  const filePart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
    `Content-Type: ${file.mimeType ?? "text/plain"}\r\n\r\n` +
    `${file.content}\r\n`;
  const payload = fieldParts + filePart + `--${boundary}--\r\n`;
  return {
    payload,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  };
}

describe("buildServer", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function app(taskService = new TaskService({ runner })) {
    const users = new MemoryUserStore();
    const sessions = new MemorySessionStore();
    await seedAdmin(users, config);
    const instance = await buildServer({
      config,
      storage,
      taskService,
      users,
      sessions,
    });
    apps.push(instance);
    return instance;
  }

  it("keeps health and the static placeholder public", async () => {
    const instance = await app();

    const health = await instance.inject({ method: "GET", url: "/api/health" });
    const index = await instance.inject({ method: "GET", url: "/" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    expect(index.statusCode).toBe(200);
    expect(index.headers["content-type"]).toContain("text/html");
  });

  it("requires the exact bearer API key for protected API routes", async () => {
    const instance = await app();

    const missing = await instance.inject({
      method: "GET",
      url: "/api/thread/unknown",
    });
    const wrong = await instance.inject({
      method: "GET",
      url: "/api/thread/unknown",
      headers: { authorization: "Bearer wrong" },
    });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(missing.json()).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required",
    });
  });

  it("allows a session cookie to generate after login", async () => {
    const instance = await app();
    const login = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin-change-me" },
    });
    const sid = login.cookies.find((cookie) => cookie.name === "sid")?.value;

    const response = await instance.inject({
      method: "POST",
      url: "/api/generate",
      ...multipartWithoutAuth({ textDescription: "用会话生成 PRD" }),
      cookies: { sid: sid! },
    });

    expect(login.statusCode).toBe(200);
    expect(sid).toBeTruthy();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      threadId: expect.any(String),
      status: "queued",
    });
  });

  it("enforces user ownership while allowing API key access", async () => {
    const users = new MemoryUserStore();
    const sessions = new MemorySessionStore();
    await seedAdmin(users, config);
    await users.create({
      username: "other-user",
      passwordHash: await hashPassword("other-password"),
      role: "user",
      status: "active",
      email: null,
    });
    const instance = await buildServer({
      config,
      storage,
      taskService: new TaskService({ runner }),
      users,
      sessions,
    });
    apps.push(instance);

    const ownerLogin = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin-change-me" },
    });
    const otherLogin = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "other-user", password: "other-password" },
    });
    const created = await instance.inject({
      method: "POST",
      url: "/api/generate",
      ...multipartWithoutAuth({ textDescription: "private requirements" }),
      cookies: { sid: ownerLogin.cookies.find((cookie) => cookie.name === "sid")!.value },
    });
    const { threadId } = created.json<{ threadId: string }>();

    const ownerRead = await instance.inject({
      method: "GET",
      url: `/api/thread/${threadId}`,
      cookies: { sid: ownerLogin.cookies.find((cookie) => cookie.name === "sid")!.value },
    });
    const otherRead = await instance.inject({
      method: "GET",
      url: `/api/thread/${threadId}`,
      cookies: { sid: otherLogin.cookies.find((cookie) => cookie.name === "sid")!.value },
    });
    const apiKeyRead = await instance.inject({
      method: "GET",
      url: `/api/thread/${threadId}`,
      headers: { authorization: `Bearer ${config.apiKey}` },
    });

    expect(ownerRead.statusCode).toBe(200);
    expect(otherRead.statusCode).toBe(403);
    expect(otherRead.json()).toEqual({
      code: "FORBIDDEN",
      message: "You do not have access to this task",
    });
    expect(apiKeyRead.statusCode).toBe(200);
  });

  it("limits login attempts to five per IP each minute", async () => {
    const instance = await app();

    for (let index = 0; index < 5; index += 1) {
      const response = await instance.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "wrong" },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
    });
  });

  it("queues a multipart generation request without waiting for the graph", async () => {
    const instance = await app();

    const response = await instance.inject({
      method: "POST",
      url: "/api/generate",
      ...multipart({
        textDescription: "做一个待办 App",
        options: JSON.stringify({ skipPrototype: true }),
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      threadId: expect.any(String),
      status: "queued",
    });
  });

  it("removes saved uploads when body validation fails after multipart parsing", async () => {
    const remove = vi.fn(async () => {});
    const testStorage: Storage = {
      ...storage,
      async save(input) {
        return {
          storageKey: "saved-upload-key",
          originalName: input.originalName,
          mimeType: input.mimeType,
          size: input.buffer.length,
          absolutePath: input.originalName,
        };
      },
      remove,
    };
    const instance = await buildServer({
      config,
      storage: testStorage,
      taskService: new TaskService({ runner }),
    });
    apps.push(instance);

    const response = await instance.inject({
      method: "POST",
      url: "/api/generate",
      ...multipartWithFile(
        { options: JSON.stringify({ language: "fr-FR" }) },
        { name: "file", filename: "notes.txt", content: "hello" },
      ),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "INVALID_GENERATE_REQUEST",
      message: expect.any(String),
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("saved-upload-key");
  });

  it("limits generation requests to five per API key each minute", async () => {
    const instance = await app();

    for (let index = 0; index < 5; index += 1) {
      const response = await instance.inject({
        method: "POST",
        url: "/api/generate",
        ...multipart({ textDescription: `需求 ${index}` }),
      });
      expect(response.statusCode).toBe(200);
    }

    const limited = await instance.inject({
      method: "POST",
      url: "/api/generate",
      ...multipart({ textDescription: "第六个需求" }),
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("returns thread snapshots and handles missing export artifacts", async () => {
    const taskService = new TaskService({ runner });
    const { threadId } = await taskService.createTask(
      {
        files: [],
        textDescription: "查询任务",
      },
      { kind: "apiKey" },
    );
    const instance = await app(taskService);
    const headers = { authorization: `Bearer ${config.apiKey}` };

    const snapshot = await instance.inject({
      method: "GET",
      url: `/api/thread/${threadId}`,
      headers,
    });
    const missingExport = await instance.inject({
      method: "GET",
      url: `/api/thread/${threadId}/export/prd.md`,
      headers,
    });
    const cancelled = await instance.inject({
      method: "DELETE",
      url: `/api/thread/${threadId}`,
      headers,
    });

    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toEqual(expect.objectContaining({ threadId }));
    expect(missingExport.statusCode).toBe(404);
    expect(missingExport.json()).toEqual({
      code: "NOT_FOUND",
      message: "PRD Markdown export is not available",
    });
    expect(cancelled.statusCode).toBe(204);
  });

  it("exports a structured PRD as JSON", async () => {
    const taskService = new TaskService({
      runner: {
        async *run() {
          yield { status: "completed", progress: 100, prd };
        },
      },
    });
    const { threadId } = await taskService.createTask(
      {
        files: [],
        textDescription: "导出 JSON",
      },
      { kind: "apiKey" },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const instance = await app(taskService);

    const response = await instance.inject({
      method: "GET",
      url: `/api/thread/${threadId}/export/prd.json`,
      headers: { authorization: `Bearer ${config.apiKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual(prd);
  });

  it("falls back to index.html for unknown client routes when web dist exists", async () => {
    const webDistDir = await mkdtemp(path.join(tmpdir(), "prd-web-dist-"));
    await writeFile(
      path.join(webDistDir, "index.html"),
      "<!doctype html><html><body>SPA</body></html>",
    );
    const instance = await buildServer({
      config: { ...config, webDistDir, publicDir: path.join(webDistDir, "missing-public") },
      storage,
      taskService: new TaskService({ runner }),
    });
    apps.push(instance);

    const login = await instance.inject({ method: "GET", url: "/login" });
    const head = await instance.inject({ method: "HEAD", url: "/workbench" });

    expect(login.statusCode).toBe(200);
    expect(login.headers["content-type"]).toContain("text/html");
    expect(login.body).toContain("SPA");
    expect(head.statusCode).toBe(200);
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const instance = await app();

    const response = await instance.inject({
      method: "GET",
      url: "/api/does-not-exist",
      headers: { authorization: `Bearer ${config.apiKey}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "NOT_FOUND",
      message: "Not found",
    });
  });
});

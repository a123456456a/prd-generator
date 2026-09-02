import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../src/config.js";
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
    const instance = await buildServer({
      config,
      storage,
      taskService,
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
    const { threadId } = await taskService.createTask({
      files: [],
      textDescription: "查询任务",
    });
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
    expect(missingExport.body).toBe("");
    expect(cancelled.statusCode).toBe(204);
  });
});

import { stat } from "node:fs/promises";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { MemorySessionStore } from "./auth/memorySessionStore.js";
import { MemoryUserStore } from "./auth/memoryUserStore.js";
import type { SessionStore, UserStore } from "./auth/types.js";
import { type AppConfig, loadConfig } from "./config.js";
import { registerPrincipal, requireAuth } from "./middleware/auth.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { generateRoutes } from "./routes/generate.js";
import { healthRoutes } from "./routes/health.js";
import { threadRoutes } from "./routes/thread.js";
import { TaskService } from "./services/taskService.js";
import { createTaskStore } from "./services/taskStore.js";
import { createStorage, type Storage } from "./storage/index.js";
import { AppError } from "./utils/errors.js";

export type BuildServerDependencies = {
  config?: AppConfig;
  taskService?: TaskService;
  storage?: Storage;
  users?: UserStore;
  sessions?: SessionStore;
};

async function existingDirectory(...candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // An absent optional static directory must not prevent API startup.
    }
  }
  return null;
}

function principalKey(request: FastifyRequest): string {
  if (request.principal?.kind === "user") {
    return `user:${request.principal.userId}`;
  }
  if (request.principal?.kind === "apiKey") {
    return "key:api";
  }
  return `ip:${request.ip}`;
}

export async function buildServer(
  dependencies: BuildServerDependencies = {},
): Promise<FastifyInstance> {
  const config = dependencies.config ?? loadConfig();
  const taskService =
    dependencies.taskService ??
    new TaskService({ store: createTaskStore(null) });
  const storage = dependencies.storage ?? createStorage(config);
  const users = dependencies.users ?? new MemoryUserStore();
  const sessions = dependencies.sessions ?? new MemorySessionStore();
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode =
      error instanceof AppError
        ? error.statusCode
        : typeof error.statusCode === "number" && error.statusCode >= 400
          ? error.statusCode
          : 500;
    const code =
      error instanceof AppError
        ? error.code
        : typeof error.code === "string"
          ? error.code
          : "INTERNAL_ERROR";
    return reply.code(statusCode).send({
      code,
      message: statusCode >= 500 ? "服务器内部错误" : error.message,
    });
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: config.maxFileBytes,
      files: config.maxFiles,
      fields: 20,
    },
  });
  const staticRoot = await existingDirectory(config.webDistDir, config.publicDir);
  if (staticRoot) {
    await app.register(fastifyStatic, { root: staticRoot });
  }

  registerPrincipal(app);
  await app.register(healthRoutes, { prefix: "/api" });
  await registerAuthRoutes(app, { users, sessions, config });

  const generalRateLimit = createRateLimiter({
    windowMs: 60_000,
    max: 20,
    keyFn: principalKey,
  });
  const generateRateLimit = createRateLimiter({
    windowMs: 60_000,
    max: 5,
    keyFn: principalKey,
  });

  await app.register(
    async (api) => {
      api.addHook("onRequest", requireAuth({ config, users, sessions }));
      api.addHook("onRequest", generalRateLimit);
      api.addHook("onRequest", async (request, reply) => {
        const path = request.url.split("?", 1)[0];
        if (path.startsWith("/api/generate")) {
          await generateRateLimit(request, reply);
        }
      });
      await api.register(generateRoutes, {
        taskService,
        storage,
        maxFileBytes: config.maxFileBytes,
        maxTotalBytes: config.maxTotalBytes,
        maxFiles: config.maxFiles,
      });
      await api.register(threadRoutes, { taskService });
    },
    { prefix: "/api" },
  );

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?", 1)[0];
    if (
      staticRoot &&
      (request.method === "GET" || request.method === "HEAD") &&
      !path.startsWith("/api/")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      code: "NOT_FOUND",
      message: "Not found",
    });
  });

  return app;
}

import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import { type AppConfig, loadConfig } from "./config.js";
import { createAuthHook } from "./middleware/auth.js";
import { createRateLimitHook } from "./middleware/rateLimit.js";
import { generateRoutes } from "./routes/generate.js";
import { healthRoutes } from "./routes/health.js";
import { threadRoutes } from "./routes/thread.js";
import { TaskService } from "./services/taskService.js";
import { createStorage, type Storage } from "./storage/index.js";
import { AppError } from "./utils/errors.js";

export type BuildServerDependencies = {
  config?: AppConfig;
  taskService?: TaskService;
  storage?: Storage;
};

export async function buildServer(
  dependencies: BuildServerDependencies = {},
): Promise<FastifyInstance> {
  const config = dependencies.config ?? loadConfig();
  const taskService = dependencies.taskService ?? new TaskService();
  const storage = dependencies.storage ?? createStorage(config);
  const app = Fastify({ logger: false });

  await app.register(cors);
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: config.maxFileBytes,
      files: config.maxFiles,
      fields: 20,
    },
  });
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL("../public", import.meta.url)),
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(
    async (api) => {
      api.addHook("onRequest", createAuthHook(config.apiKey));
      api.addHook("onRequest", createRateLimitHook());
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
    reply.code(statusCode).send({
      error: {
        code,
        message: statusCode >= 500 ? "服务器内部错误" : error.message,
      },
    });
  });

  return app;
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { MemorySessionStore } from "../../src/auth/memorySessionStore.js";
import { MemoryUserStore } from "../../src/auth/memoryUserStore.js";
import { seedAdmin } from "../../src/auth/seedAdmin.js";
import type { AppConfig } from "../../src/config.js";
import { registerAuthRoutes } from "../../src/routes/auth.js";

const repoPublic = path.resolve(
  fileURLToPath(new URL("../../../../public", import.meta.url)),
);

export const defaultAuthTestConfig: AppConfig = {
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

export type AuthTestApp = {
  app: FastifyInstance;
  users: MemoryUserStore;
  sessions: MemorySessionStore;
  config: AppConfig;
};

export async function buildAuthTestApp(
  config: AppConfig = defaultAuthTestConfig,
): Promise<AuthTestApp> {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  await seedAdmin(users, config);

  const app = Fastify({ logger: false });
  await registerAuthRoutes(app, { config, users, sessions });
  return { app, users, sessions, config };
}

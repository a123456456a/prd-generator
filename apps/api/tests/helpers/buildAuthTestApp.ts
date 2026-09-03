import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { MemorySessionStore } from "../../src/auth/memorySessionStore.js";
import { MemoryUserStore } from "../../src/auth/memoryUserStore.js";
import { verifyPassword } from "../../src/auth/password.js";
import { seedAdmin } from "../../src/auth/seedAdmin.js";
import type { AppConfig } from "../../src/config.js";
import { registerPrincipal, requireAuth } from "../../src/middleware/auth.js";
import { registerAuthRoutes } from "../../src/routes/auth.js";

const repoPublic = path.resolve(
  fileURLToPath(new URL("../../../../public", import.meta.url)),
);

export const defaultAuthTestConfig: AppConfig = {
  port: 3000,
  apiKey: "test-api-key",
  openaiApiKey: "",
  openaiBaseUrl: null,
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
  passwordVerifier = verifyPassword,
): Promise<AuthTestApp> {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  await seedAdmin(users, config);

  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerAuthRoutes(app, {
    config,
    users,
    sessions,
    verifyPassword: passwordVerifier,
  });
  return { app, users, sessions, config };
}

export async function buildDualAuthTestApp(
  config: AppConfig = defaultAuthTestConfig,
  prepare?: (deps: AuthTestApp) => Promise<void>,
): Promise<AuthTestApp> {
  const testApp = await buildAuthTestApp(config);
  if (prepare) {
    await prepare(testApp);
  }

  registerPrincipal(testApp.app);
  testApp.app.addHook(
    "onRequest",
    requireAuth({
      config: testApp.config,
      users: testApp.users,
      sessions: testApp.sessions,
    }),
  );
  testApp.app.get("/api/protected", async (request) => ({
    principal: request.principal,
  }));

  return testApp;
}

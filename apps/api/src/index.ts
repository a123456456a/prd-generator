import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MemorySessionStore } from "./auth/memorySessionStore.js";
import { MemoryUserStore } from "./auth/memoryUserStore.js";
import { seedAdmin } from "./auth/seedAdmin.js";
import { loadConfig } from "./config.js";
import { REPO_ROOT } from "./paths.js";
import { buildServer } from "./server.js";

const apiRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(apiRoot, ".env") });

const config = loadConfig();
const users = new MemoryUserStore();
const sessions = new MemorySessionStore();
await seedAdmin(users, config);

const app = await buildServer({ config, users, sessions });

try {
  const address = await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`PRD Generator listening at ${address}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createAuthStores } from "./auth/createStores.js";
import { seedAdmin } from "./auth/seedAdmin.js";
import { assertProductionConfig, loadConfig } from "./config.js";
import { bootstrapPersistence } from "./db/bootstrap.js";
import { REPO_ROOT } from "./paths.js";
import { buildServer } from "./server.js";
import { runStartup } from "./startup.js";

const apiRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(apiRoot, ".env") });

const config = loadConfig();
if (process.env.NODE_ENV === "production") {
  assertProductionConfig(config);
}
const { pool } = await bootstrapPersistence(config);
const { users, sessions } = createAuthStores(config, pool);
await seedAdmin(users, config);

const app = await buildServer({ config, users, sessions });

try {
  await runStartup(pool, async () => {
    const address = await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`PRD Generator listening at ${address}`);
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

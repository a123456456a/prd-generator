import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createAuthStores } from "./auth/createStores.js";
import { seedAdmin } from "./auth/seedAdmin.js";
import { assertProductionConfig, loadConfig } from "./config.js";
import { bootstrapPersistence } from "./db/bootstrap.js";
import { REPO_ROOT } from "./paths.js";
import { buildServer } from "./server.js";
import { TaskService } from "./services/taskService.js";
import { createTaskStore } from "./services/taskStore.js";
import { createUsageStore } from "./services/usageStore.js";
import { runStartup } from "./startup.js";
import { createStorage } from "./storage/index.js";
import { runTtlCleanup } from "./services/ttlCleanup.js";
import { createArtifactWriter } from "./services/artifactWriter.js";

const apiRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(apiRoot, ".env") });

const config = loadConfig();
if (process.env.NODE_ENV === "production") {
  assertProductionConfig(config);
}
const { pool, checkpointer } = await bootstrapPersistence(config);
const { users, sessions } = createAuthStores(config, pool);
await seedAdmin(users, config);
const taskStore = createTaskStore(pool);
const usageStore = createUsageStore(pool);
const artifactWriter = createArtifactWriter(config.outputDir);
const taskService = new TaskService({
  store: taskStore,
  usageStore,
  config,
  checkpointer,
  artifactWriter,
});

const storage = createStorage(config);
const app = await buildServer({ config, users, sessions, taskService, storage });

const ttlTimer = setInterval(
  () => {
    void runTtlCleanup({
      taskStore,
      sessionStore: sessions,
      storage,
      artifactWriter,
      checkpointer,
    }).catch((error) => {
      app.log.error(error, "TTL cleanup failed");
    });
  },
  60 * 60 * 1000,
);

const shutdown = async () => {
  clearInterval(ttlTimer);
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

try {
  await runStartup(pool, async () => {
    const address = await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`PRD Generator listening at ${address}`);
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

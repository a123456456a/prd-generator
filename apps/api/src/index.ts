import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "./config.js";
import { REPO_ROOT } from "./paths.js";
import { buildServer } from "./server.js";

const apiRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(apiRoot, ".env") });

const config = loadConfig();

const app = await buildServer({ config });

try {
  const address = await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`PRD Generator listening at ${address}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

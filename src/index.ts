import "dotenv/config";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();

const app = await buildServer({ config });

try {
  const address = await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`PRD Generator listening at ${address}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

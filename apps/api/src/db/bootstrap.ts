import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { createCheckpointer } from "../graph/checkpointer.js";
import { runMigrations } from "./migrate.js";
import { createPool } from "./pool.js";

export async function bootstrapPersistence(config: AppConfig) {
  const pool = config.databaseUrl ? createPool(config.databaseUrl) : null;
  if (pool) await runMigrations(pool);
  const checkpointer = await createCheckpointer(pool);
  return { pool, checkpointer };
}

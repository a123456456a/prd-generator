import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { runMigrations } from "./migrate.js";
import { createPool } from "./pool.js";

export async function bootstrapPersistence(
  config: AppConfig,
): Promise<{ pool: Pool | null }> {
  const pool = config.databaseUrl ? createPool(config.databaseUrl) : null;
  if (pool) await runMigrations(pool);
  return { pool };
}

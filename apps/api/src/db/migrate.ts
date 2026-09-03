import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { API_ROOT } from "../paths.js";

const MIGRATION_ADVISORY_LOCK_KEY = 8_873_421_906_117_239n;

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
    await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
    const dir = path.join(API_ROOT, "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const exists = await client.query(
        `SELECT 1 FROM schema_migrations WHERE id = $1`,
        [file],
      );
      if (exists.rowCount) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [
          file,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
    client.release();
  }
}

import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { runMigrations } from "../../src/db/migrate.js";

function createPool(options: { failMigration?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT 1 FROM schema_migrations")) {
      return { rowCount: 0 };
    }
    if (
      options.failMigration &&
      sql.includes("CREATE TABLE IF NOT EXISTS users")
    ) {
      throw new Error("migration failed");
    }
    return { rowCount: 1 };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const poolQuery = vi.fn();
  const pool = { connect, query: poolQuery } as unknown as pg.Pool;

  return { pool, connect, poolQuery, query, release };
}

describe("runMigrations", () => {
  it("holds one advisory-locked client for the full migration run", async () => {
    const { pool, connect, poolQuery, query, release } = createPool();

    await runMigrations(pool);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(query.mock.calls[0]).toEqual([
      "SELECT pg_advisory_lock($1)",
      [8_873_421_906_117_239n],
    ]);
    expect(query.mock.calls.at(-1)).toEqual([
      "SELECT pg_advisory_unlock($1)",
      [8_873_421_906_117_239n],
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("unlocks and releases the migration client when a migration fails", async () => {
    const { pool, query, release } = createPool({ failMigration: true });

    await expect(runMigrations(pool)).rejects.toThrow("migration failed");

    expect(query.mock.calls.at(-1)).toEqual([
      "SELECT pg_advisory_unlock($1)",
      [8_873_421_906_117_239n],
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

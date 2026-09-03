import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { PostgresUserStore } from "../../src/auth/postgresUserStore.js";

const url = process.env.DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("PostgresUserStore", () => {
  const pool = createPool(url!);
  const users = new PostgresUserStore(pool);

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates and finds admin by username", async () => {
    const user = await users.ensureAdmin(
      `admin-${Date.now()}`,
      "test-password-not-for-prod",
    );
    const found = await users.findByUsername(user.username);
    expect(found?.id).toBe(user.id);
    expect(found?.role).toBe("admin");
  });
});

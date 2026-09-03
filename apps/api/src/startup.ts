import type { Pool } from "pg";

export async function runStartup(
  pool: Pool | null,
  listen: () => Promise<void>,
): Promise<void> {
  try {
    await listen();
  } catch (error) {
    if (pool) {
      await pool.end();
    }
    throw error;
  }
}

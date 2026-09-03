import type { Pool } from "pg";

export interface UsageStore {
  getTokens(principalKey: string, day: string): Promise<number>;
  addTokens(principalKey: string, day: string, delta: number): Promise<number>;
}

function compositeKey(principalKey: string, day: string): string {
  return `${principalKey}\0${day}`;
}

export class MemoryUsageStore implements UsageStore {
  private readonly totals = new Map<string, number>();

  async getTokens(principalKey: string, day: string): Promise<number> {
    return this.totals.get(compositeKey(principalKey, day)) ?? 0;
  }

  async addTokens(
    principalKey: string,
    day: string,
    delta: number,
  ): Promise<number> {
    const key = compositeKey(principalKey, day);
    const next = (this.totals.get(key) ?? 0) + delta;
    this.totals.set(key, next);
    return next;
  }
}

export class PostgresUsageStore implements UsageStore {
  constructor(private readonly pool: Pool) {}

  async getTokens(principalKey: string, day: string): Promise<number> {
    const result = await this.pool.query<{ token_total: string }>(
      `SELECT token_total
       FROM usage_daily
       WHERE principal_key = $1 AND day = $2::date`,
      [principalKey, day],
    );
    return Number(result.rows[0]?.token_total ?? 0);
  }

  async addTokens(
    principalKey: string,
    day: string,
    delta: number,
  ): Promise<number> {
    const result = await this.pool.query<{ token_total: string }>(
      `INSERT INTO usage_daily (principal_key, day, token_total)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (principal_key, day)
       DO UPDATE SET token_total = usage_daily.token_total + EXCLUDED.token_total
       RETURNING token_total`,
      [principalKey, day, delta],
    );
    return Number(result.rows[0]?.token_total ?? 0);
  }
}

export function createUsageStore(pool: Pool | null): UsageStore {
  if (pool) return new PostgresUsageStore(pool);
  return new MemoryUsageStore();
}

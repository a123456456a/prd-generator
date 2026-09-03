import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SessionRecord, SessionStore } from "./types.js";

type SessionRow = {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
};

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, ttlMs: number): Promise<SessionRecord> {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (id, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, created_at, expires_at`,
      [randomUUID(), userId, createdAt, expiresAt],
    );
    return toSessionRecord(result.rows[0]);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, user_id, created_at, expires_at
       FROM sessions
       WHERE id = $1 AND expires_at > now()`,
      [id],
    );
    const row = result.rows[0];
    if (row) return toSessionRecord(row);
    await this.pool.query(
      `DELETE FROM sessions WHERE id = $1 AND expires_at <= now()`,
      [id],
    );
    return null;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
  }
}

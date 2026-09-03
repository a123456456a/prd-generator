import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../utils/errors.js";
import { hashPassword } from "./password.js";
import type { CreateUserInput, UserRecord, UserStore } from "./types.js";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRecord["role"];
  status: UserRecord["status"];
  email: string | null;
  created_at: Date;
  updated_at: Date;
};

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export class PostgresUserStore implements UserStore {
  constructor(private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, username, password_hash, role, status, email, created_at, updated_at
       FROM users
       WHERE username = $1`,
      [username],
    );
    return result.rows[0] ? toUserRecord(result.rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, username, password_hash, role, status, email, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toUserRecord(result.rows[0]) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const now = new Date();
    try {
      const result = await this.pool.query<UserRow>(
        `INSERT INTO users (
           id, username, password_hash, role, status, email, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id, username, password_hash, role, status, email, created_at, updated_at`,
        [
          randomUUID(),
          input.username,
          input.passwordHash,
          input.role,
          input.status,
          input.email,
          now,
        ],
      );
      return toUserRecord(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("USER_EXISTS", "User already exists", 409);
      }
      throw error;
    }
  }

  async ensureAdmin(username: string, password: string): Promise<UserRecord> {
    const existing = await this.findByUsername(username);
    if (existing) return existing;
    return this.create({
      username,
      passwordHash: await hashPassword(password),
      role: "admin",
      status: "active",
      email: null,
    });
  }
}

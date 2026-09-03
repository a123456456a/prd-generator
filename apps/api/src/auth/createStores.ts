import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { MemorySessionStore } from "./memorySessionStore.js";
import { MemoryUserStore } from "./memoryUserStore.js";
import { PostgresSessionStore } from "./postgresSessionStore.js";
import { PostgresUserStore } from "./postgresUserStore.js";
import type { SessionStore, UserStore } from "./types.js";

export function createAuthStores(
  config: AppConfig,
  pool: Pool | null,
): { users: UserStore; sessions: SessionStore } {
  if (pool) {
    return {
      users: new PostgresUserStore(pool),
      sessions: new PostgresSessionStore(pool),
    };
  }
  return {
    users: new MemoryUserStore(),
    sessions: new MemorySessionStore(),
  };
}

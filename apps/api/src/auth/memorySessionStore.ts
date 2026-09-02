import { randomUUID } from "node:crypto";
import type { SessionRecord, SessionStore } from "./types.js";

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async create(userId: string, ttlMs: number): Promise<SessionRecord> {
    const now = new Date();
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

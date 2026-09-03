import type { Pool } from "pg";
import type { TaskSnapshot } from "./taskService.js";
import { PostgresTaskStore } from "./postgresTaskStore.js";

export interface TaskStore {
  save(task: TaskSnapshot): Promise<void>;
  get(threadId: string): Promise<TaskSnapshot | null>;
  delete(threadId: string): Promise<void>;
  listExpired(now: Date): Promise<TaskSnapshot[]>;
}

export class MemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, TaskSnapshot>();

  async save(task: TaskSnapshot): Promise<void> {
    this.tasks.set(task.threadId, { ...task });
  }

  async get(threadId: string): Promise<TaskSnapshot | null> {
    const task = this.tasks.get(threadId);
    return task ? { ...task } : null;
  }

  async delete(threadId: string): Promise<void> {
    this.tasks.delete(threadId);
  }

  async listExpired(now: Date): Promise<TaskSnapshot[]> {
    const expired: TaskSnapshot[] = [];
    for (const task of this.tasks.values()) {
      if (task.expiresAt && new Date(task.expiresAt) <= now) {
        expired.push({ ...task });
      }
    }
    return expired;
  }
}

export function createTaskStore(pool: Pool | null): TaskStore {
  if (pool) return new PostgresTaskStore(pool);
  return new MemoryTaskStore();
}

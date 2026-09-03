import type { Pool } from "pg";
import type { GraphConfig } from "../graph/state.js";
import type { PRD } from "../schemas/prdSchema.js";
import type { TaskOwner, TaskSnapshot, TaskStatus } from "./taskService.js";
import type { TaskStore } from "./taskStore.js";

type TaskRow = {
  thread_id: string;
  owner_kind: "user" | "apiKey";
  owner_user_id: string | null;
  status: string;
  progress: number;
  prd: PRD | null;
  prd_markdown: string;
  prototype_html: string;
  error: string | null;
  gaps: string[];
  config: GraphConfig;
  extracted_text: string;
  structured_requirements: unknown;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
};

function toOwner(row: TaskRow): TaskOwner {
  if (row.owner_kind === "user" && row.owner_user_id) {
    return { kind: "user", userId: row.owner_user_id };
  }
  return { kind: "apiKey" };
}

function toTaskSnapshot(row: TaskRow): TaskSnapshot {
  const snapshot: TaskSnapshot = {
    threadId: row.thread_id,
    owner: toOwner(row),
    status: row.status as TaskStatus,
    progress: row.progress,
    prdMarkdown: row.prd_markdown,
    prototypeHtml: row.prototype_html,
    gaps: row.gaps ?? [],
    config: row.config ?? {},
    extractedText: row.extracted_text,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (row.prd) snapshot.prd = row.prd;
  if (row.error) snapshot.error = row.error;
  if (row.structured_requirements !== null && row.structured_requirements !== undefined) {
    snapshot.structuredRequirements = row.structured_requirements;
  }
  if (row.expires_at) snapshot.expiresAt = row.expires_at.toISOString();
  return snapshot;
}

function ownerParams(owner: TaskOwner): {
  ownerKind: "user" | "apiKey";
  ownerUserId: string | null;
} {
  if (owner.kind === "user") {
    return { ownerKind: "user", ownerUserId: owner.userId };
  }
  return { ownerKind: "apiKey", ownerUserId: null };
}

const TASK_COLUMNS = `
  thread_id, owner_kind, owner_user_id, status, progress,
  prd, prd_markdown, prototype_html, error, gaps, config,
  extracted_text, structured_requirements, created_at, updated_at, expires_at
`;

export class PostgresTaskStore implements TaskStore {
  constructor(private readonly pool: Pool) {}

  async save(task: TaskSnapshot): Promise<void> {
    const { ownerKind, ownerUserId } = ownerParams(task.owner);
    const expiresAt = task.expiresAt ? new Date(task.expiresAt) : null;
    await this.pool.query(
      `INSERT INTO tasks (
         thread_id, owner_kind, owner_user_id, status, progress,
         prd, prd_markdown, prototype_html, error, gaps, config,
         extracted_text, structured_requirements, created_at, updated_at, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10::jsonb, $11::jsonb,
         $12, $13::jsonb, $14, $15, $16
       )
       ON CONFLICT (thread_id) DO UPDATE SET
         owner_kind = EXCLUDED.owner_kind,
         owner_user_id = EXCLUDED.owner_user_id,
         status = EXCLUDED.status,
         progress = EXCLUDED.progress,
         prd = EXCLUDED.prd,
         prd_markdown = EXCLUDED.prd_markdown,
         prototype_html = EXCLUDED.prototype_html,
         error = EXCLUDED.error,
         gaps = EXCLUDED.gaps,
         config = EXCLUDED.config,
         extracted_text = EXCLUDED.extracted_text,
         structured_requirements = EXCLUDED.structured_requirements,
         updated_at = EXCLUDED.updated_at,
         expires_at = EXCLUDED.expires_at`,
      [
        task.threadId,
        ownerKind,
        ownerUserId,
        task.status,
        task.progress,
        task.prd ?? null,
        task.prdMarkdown,
        task.prototypeHtml,
        task.error ?? null,
        JSON.stringify(task.gaps),
        JSON.stringify(task.config),
        task.extractedText,
        task.structuredRequirements ?? null,
        task.createdAt,
        task.updatedAt,
        expiresAt,
      ],
    );
  }

  async get(threadId: string): Promise<TaskSnapshot | null> {
    const result = await this.pool.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE thread_id = $1`,
      [threadId],
    );
    const row = result.rows[0];
    return row ? toTaskSnapshot(row) : null;
  }

  async delete(threadId: string): Promise<void> {
    await this.pool.query(`DELETE FROM tasks WHERE thread_id = $1`, [threadId]);
  }

  async listExpired(now: Date): Promise<TaskSnapshot[]> {
    const result = await this.pool.query<TaskRow>(
      `SELECT ${TASK_COLUMNS}
       FROM tasks
       WHERE expires_at IS NOT NULL AND expires_at <= $1`,
      [now],
    );
    return result.rows.map(toTaskSnapshot);
  }
}

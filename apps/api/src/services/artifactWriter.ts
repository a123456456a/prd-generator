import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { loadConfig } from "../config.js";
import type { TaskSnapshot } from "./taskService.js";

/**
 * Persists the deliverables produced by a task (PRD JSON/Markdown, prototype
 * HTML) to disk, in addition to whatever is stored in the task store/DB.
 * This gives the agent's output a stable, file-system-visible home
 * (`outputs/<threadId>/…`) mirroring how uploaded inputs land in `uploads/`,
 * so results can be browsed, backed up, or synced outside of the API.
 */
export interface ArtifactWriter {
  write(task: TaskSnapshot): Promise<void>;
  remove(threadId: string): Promise<void>;
}

const SAFE_THREAD_ID = /^[a-zA-Z0-9_-]+$/;

function assertSafeThreadId(threadId: string): void {
  if (!SAFE_THREAD_ID.test(threadId)) {
    throw new Error(`Invalid threadId for artifact storage: ${threadId}`);
  }
}

export class LocalArtifactWriter implements ArtifactWriter {
  constructor(private readonly rootDir: string) {}

  private taskDir(threadId: string): string {
    assertSafeThreadId(threadId);
    return join(this.rootDir, threadId);
  }

  async write(task: TaskSnapshot): Promise<void> {
    const files: Array<[name: string, content: string]> = [];
    if (task.prd) files.push(["prd.json", JSON.stringify(task.prd, null, 2)]);
    if (task.prdMarkdown) files.push(["prd.md", task.prdMarkdown]);
    if (task.prototypeHtml) files.push(["prototype.html", task.prototypeHtml]);
    if (files.length === 0) return;

    const dir = this.taskDir(task.threadId);
    await mkdir(dir, { recursive: true });
    await Promise.all(
      files.map(([name, content]) => writeFile(join(dir, name), content, "utf-8")),
    );
  }

  async remove(threadId: string): Promise<void> {
    await rm(this.taskDir(threadId), { recursive: true, force: true });
  }
}

/** Writer used when no on-disk persistence is desired (e.g. unit tests). */
export class NoopArtifactWriter implements ArtifactWriter {
  async write(): Promise<void> {
    // Intentionally does nothing.
  }
  async remove(): Promise<void> {
    // Intentionally does nothing.
  }
}

export function createArtifactWriter(rootDir?: string): LocalArtifactWriter {
  return new LocalArtifactWriter(rootDir ?? loadConfig().outputDir);
}

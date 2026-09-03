import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { PostgresTaskStore } from "../../src/services/postgresTaskStore.js";
import {
  TaskService,
  type TaskGraphRunner,
} from "../../src/services/taskService.js";

const url = process.env.DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const apiKeyPrincipal = { kind: "apiKey" } as const;

function createAwaitingReviewRunner(): TaskGraphRunner {
  return {
    async *run(request) {
      if (request.kind === "create") {
        yield {
          status: "awaiting_review",
          progress: 100,
          prd: { title: "Restart PRD" } as never,
          prdMarkdown: "# Restart PRD",
        };
        return;
      }
      if (request.kind === "resume") {
        yield {
          status: "completed",
          progress: 100,
          prototypeHtml: "<!doctype html><html></html>",
        };
      }
    },
  };
}

describeDb("AC-07 restart resume", () => {
  const pool = createPool(url!);
  const store = new PostgresTaskStore(pool);
  const config = { ...loadConfig(), dailyTokenBudget: 0 };

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reloads awaiting_review task from Postgres after new TaskService", async () => {
    const runner = createAwaitingReviewRunner();
    const service1 = new TaskService({ store, runner, config });

    const { threadId } = await service1.createTask(
      { files: [], options: { enableHumanReview: true } },
      apiKeyPrincipal,
    );

    await vi.waitFor(async () => {
      expect((await service1.getTask(threadId))?.status).toBe("awaiting_review");
    });

    const service2 = new TaskService({ store, runner, config });
    expect((await service2.getTask(threadId))?.status).toBe("awaiting_review");

    await service2.resumeTask(threadId, { action: "approve" });

    await vi.waitFor(async () => {
      expect((await service2.getTask(threadId))?.status).toBe("completed");
    });
  });
});

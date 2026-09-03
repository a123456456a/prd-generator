import { describe, expect, it, vi } from "vitest";
import {
  LangGraphRunner,
  TaskService,
  type GraphRunRequest,
  type TaskGraphRunner,
} from "../../src/services/taskService.js";
import { MemoryTaskStore } from "../../src/services/taskStore.js";
import { AppError } from "../../src/utils/errors.js";

const apiKeyPrincipal = { kind: "apiKey" } as const;

function createService(
  options: ConstructorParameters<typeof TaskService>[0] = {},
) {
  return new TaskService({ store: new MemoryTaskStore(), ...options });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("TaskService", () => {
  it("emits checkpoint changes before a resumed graph continuation", async () => {
    const graph = {
      updateState: vi.fn().mockResolvedValue(undefined),
      stream: vi.fn().mockResolvedValue(
        (async function* () {
          // No node runs when skipPrototype routes directly to END.
        })(),
      ),
    };
    const runner = new LangGraphRunner(graph as never);
    const now = new Date().toISOString();
    const updates = [];

    for await (const update of runner.run({
      kind: "resume",
      threadId: "resume-thread",
      snapshot: {
        threadId: "resume-thread",
        owner: apiKeyPrincipal,
        status: "awaiting_review",
        progress: 100,
        prd: { title: "PRD" } as never,
        prdMarkdown: "# PRD",
        prototypeHtml: "",
        gaps: [],
        config: { skipPrototype: true, enableHumanReview: true },
        extractedText: "需求",
        createdAt: now,
        updatedAt: now,
      },
      body: { action: "approve" },
    })) {
      updates.push(update);
    }

    expect(updates).toEqual([
      expect.objectContaining({ status: "completed", progress: 100 }),
    ]);
    expect(graph.updateState).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ status: "completed" }),
      "generate_prd",
    );
  });

  it("clears the checkpoint PRD when review is rejected", async () => {
    const graph = {
      updateState: vi.fn().mockResolvedValue(undefined),
      stream: vi.fn().mockResolvedValue(
        (async function* () {
          // The checkpoint update is sufficient for this assertion.
        })(),
      ),
    };
    const runner = new LangGraphRunner(graph as never);
    const now = new Date().toISOString();

    for await (const _update of runner.run({
      kind: "resume",
      threadId: "reject-thread",
      snapshot: {
        threadId: "reject-thread",
        owner: apiKeyPrincipal,
        status: "awaiting_review",
        progress: 100,
        prd: { title: "旧 PRD" } as never,
        prdMarkdown: "# 旧 PRD",
        prototypeHtml: "stale",
        gaps: [],
        config: {},
        extractedText: "需求",
        createdAt: now,
        updatedAt: now,
      },
      body: { action: "reject", feedback: "请重写" },
    })) {
      // Drain the runner so updateState executes.
    }

    expect(graph.updateState).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ prd: null, prdMarkdown: "" }),
      "extract_requirements",
    );
  });

  it("returns a queued task before asynchronous graph work completes", async () => {
    const release = deferred<void>();
    const runner: TaskGraphRunner = {
      async *run() {
        await release.promise;
        yield { status: "completed", progress: 100, prdMarkdown: "# 完成" };
      },
    };
    const service = createService({ runner });

    const result = await service.createTask(
      {
        files: [],
        textDescription: "生成 PRD",
      },
      apiKeyPrincipal,
    );

    expect(result.threadId).toEqual(expect.any(String));
    expect((await service.getTask(result.threadId))?.status).toBe("queued");
    release.resolve();
  });

  it("fans out progress, result, and done events from graph updates", async () => {
    const release = deferred<void>();
    const runner: TaskGraphRunner = {
      async *run() {
        await release.promise;
        yield { status: "extracting", progress: 25 };
        yield {
          status: "completed",
          progress: 100,
          prdMarkdown: "# PRD",
          prototypeHtml: "<!doctype html><html></html>",
        };
      },
    };
    const service = createService({ runner });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );
    const send = vi.fn();
    service.subscribe(threadId, send);

    release.resolve();
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith("done", expect.any(Object));
    });

    expect(send).toHaveBeenCalledWith("progress", { progress: 25 });
    expect(send).toHaveBeenCalledWith(
      "result",
      expect.objectContaining({ prdMarkdown: "# PRD" }),
    );
    expect((await service.getTask(threadId))?.status).toBe("completed");
  });

  it("resumes an awaiting review task with edited PRD and cleared stale output", async () => {
    const requests: GraphRunRequest[] = [];
    const runner: TaskGraphRunner = {
      async *run(request) {
        requests.push(request);
        if (request.kind === "create") {
          yield {
            status: "awaiting_review",
            progress: 100,
            prd: { title: "旧标题" } as never,
            prototypeHtml: "stale",
            error: "stale error",
          };
          return;
        }
        yield {
          status: "completed",
          progress: 100,
          prototypeHtml: "<!doctype html><html>new</html>",
        };
      },
    };
    const service = createService({ runner });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );
    await vi.waitFor(async () => {
      expect((await service.getTask(threadId))?.status).toBe("awaiting_review");
    });

    await service.resumeTask(threadId, {
      action: "edit",
      prdPatch: { title: "新标题" },
    });

    expect(requests[1]).toEqual(
      expect.objectContaining({
        kind: "resume",
        body: { action: "edit", prdPatch: { title: "新标题" } },
      }),
    );
    expect(await service.getTask(threadId)).toEqual(
      expect.objectContaining({
        status: "completed",
        prd: expect.objectContaining({ title: "新标题" }),
        prototypeHtml: "<!doctype html><html>new</html>",
        error: undefined,
      }),
    );
  });

  it("rejects resume for a completed task without changing its snapshot", async () => {
    const run = vi.fn<TaskGraphRunner["run"]>(() =>
      (async function* () {
        yield {
          status: "completed",
          progress: 100,
          prdMarkdown: "# 完成",
        };
      })(),
    );
    const service = createService({ runner: { run } });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );
    await vi.waitFor(async () => {
      expect((await service.getTask(threadId))?.status).toBe("completed");
    });
    const before = await service.getTask(threadId);

    await expect(
      service.resumeTask(threadId, { action: "approve" }),
    ).rejects.toBeInstanceOf(AppError);

    expect(await service.getTask(threadId)).toEqual(before);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects an overlapping run for the same task", async () => {
    const release = deferred<void>();
    const run = vi.fn<TaskGraphRunner["run"]>(() =>
      (async function* () {
        await release.promise;
        yield { status: "completed", progress: 100 };
      })(),
    );
    const service = createService({ runner: { run } });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );
    await vi.waitFor(async () => {
      expect((await service.getTask(threadId))?.status).toBe("running");
    });

    await expect(service.regenerate(threadId, "prd")).rejects.toMatchObject({
      code: "TASK_ALREADY_RUNNING",
    });
    expect(run).toHaveBeenCalledTimes(1);
    release.resolve();
  });

  it("marks cancellation and rejects later updates", async () => {
    const release = deferred<void>();
    const runner: TaskGraphRunner = {
      async *run() {
        await release.promise;
        yield { status: "completed", progress: 100 };
      },
    };
    const service = createService({ runner });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );
    const send = vi.fn();
    service.subscribe(threadId, send);

    await service.cancelTask(threadId);
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await service.getTask(threadId))?.status).toBe("cancelled");
    expect(send).toHaveBeenCalledWith(
      "status",
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("does not start queued graph work after cancellation", async () => {
    const run = vi.fn<TaskGraphRunner["run"]>(() =>
      (async function* () {
        yield { status: "completed", progress: 100 };
      })(),
    );
    const service = createService({ runner: { run } });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );

    await service.cancelTask(threadId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(run).not.toHaveBeenCalled();
    expect((await service.getTask(threadId))?.status).toBe("cancelled");
  });

  it("starts partial regeneration without reparsing input", async () => {
    const requests: GraphRunRequest[] = [];
    const runner: TaskGraphRunner = {
      async *run(request) {
        requests.push(request);
        yield {
          status: "completed",
          progress: 100,
          prd: { title: "PRD" } as never,
        };
      },
    };
    const service = createService({ runner });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );
    await vi.waitFor(async () => {
      expect((await service.getTask(threadId))?.status).toBe("completed");
    });

    await service.regenerate(threadId, "prototype");

    expect(requests[1]).toEqual(
      expect.objectContaining({ kind: "regenerate", target: "prototype" }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import {
  LangGraphRunner,
  TaskService,
  type GraphRunRequest,
  type TaskGraphRunner,
} from "../../src/services/taskService.js";
import { MemoryTaskStore } from "../../src/services/taskStore.js";
import type { TaskQueue } from "../../src/services/taskQueue.js";
import { MemoryUsageStore } from "../../src/services/usageStore.js";
import type { ArtifactWriter } from "../../src/services/artifactWriter.js";
import { logger } from "../../src/utils/logger.js";
import { AppError } from "../../src/utils/errors.js";

const apiKeyPrincipal = { kind: "apiKey" } as const;

function createService(
  options: ConstructorParameters<typeof TaskService>[0] = {},
) {
  return new TaskService({ store: new MemoryTaskStore(), ...options });
}

function blockingQueue(gate: ReturnType<typeof deferred<void>>): TaskQueue {
  return {
    get pending() {
      return 0;
    },
    get active() {
      return 0;
    },
    schedule: async (fn) => {
      await gate.promise;
      return fn();
    },
  };
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

  it("revises content directly through the LangGraphRunner without touching the compiled graph", async () => {
    const graph = { updateState: vi.fn(), stream: vi.fn() };
    const reviseHandlers = {
      revisePrd: vi.fn().mockResolvedValue({
        prd: { title: "新标题" },
        prdMarkdown: "# 新标题",
        changeSummary: "已更新标题",
      }),
      revisePrototype: vi.fn(),
    };
    const runner = new LangGraphRunner(graph as never, reviseHandlers as never);
    const now = new Date().toISOString();

    const updates = [];
    for await (const update of runner.run({
      kind: "revise",
      threadId: "revise-thread",
      snapshot: {
        threadId: "revise-thread",
        owner: apiKeyPrincipal,
        status: "completed",
        progress: 100,
        prd: { title: "旧标题" } as never,
        prdMarkdown: "# 旧标题",
        prototypeHtml: "<!doctype html><html></html>",
        gaps: [],
        config: {},
        extractedText: "需求",
        conversation: [],
        createdAt: now,
        updatedAt: now,
      },
      target: "prd",
      message: "把标题改一下",
    })) {
      updates.push(update);
    }

    expect(graph.updateState).not.toHaveBeenCalled();
    expect(graph.stream).not.toHaveBeenCalled();
    expect(reviseHandlers.revisePrd).toHaveBeenCalledWith(
      { title: "旧标题" },
      "把标题改一下",
      [],
      "zh-CN",
      undefined,
    );
    expect(updates).toEqual([
      expect.objectContaining({
        status: "completed",
        progress: 100,
        prd: { title: "新标题" },
        prdMarkdown: "# 新标题",
        error: undefined,
      }),
    ]);
    expect(updates[0].conversation).toEqual([
      expect.objectContaining({ role: "user", message: "把标题改一下" }),
      expect.objectContaining({ role: "assistant", message: "已更新标题" }),
    ]);
  });

  it("keeps the task's status and appends an apology turn when a revision fails", async () => {
    const graph = { updateState: vi.fn(), stream: vi.fn() };
    const reviseHandlers = {
      revisePrd: vi.fn().mockResolvedValue({ error: "模型超时" }),
      revisePrototype: vi.fn(),
    };
    const runner = new LangGraphRunner(graph as never, reviseHandlers as never);
    const now = new Date().toISOString();

    const updates = [];
    for await (const update of runner.run({
      kind: "revise",
      threadId: "revise-thread-2",
      snapshot: {
        threadId: "revise-thread-2",
        owner: apiKeyPrincipal,
        status: "awaiting_review",
        progress: 100,
        prd: { title: "旧标题" } as never,
        prdMarkdown: "# 旧标题",
        prototypeHtml: "",
        gaps: [],
        config: {},
        extractedText: "需求",
        conversation: [],
        createdAt: now,
        updatedAt: now,
      },
      target: "prd",
      message: "把标题改一下",
    })) {
      updates.push(update);
    }

    expect(updates).toEqual([
      expect.objectContaining({
        status: "awaiting_review",
        progress: 100,
        error: "模型超时",
      }),
    ]);
    expect(updates[0].conversation?.[1]).toEqual(
      expect.objectContaining({
        role: "assistant",
        message: expect.stringContaining("模型超时"),
      }),
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
    const gate = deferred<void>();
    const service = createService({ runner, queue: blockingQueue(gate) });

    const result = await service.createTask(
      {
        files: [],
        textDescription: "生成 PRD",
      },
      apiKeyPrincipal,
    );

    expect(result.threadId).toEqual(expect.any(String));
    expect((await service.getTask(result.threadId))?.status).toBe("queued");
    gate.resolve();
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
    const gate = deferred<void>();
    const service = createService({ runner: { run }, queue: blockingQueue(gate) });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );

    await service.cancelTask(threadId);
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(run).not.toHaveBeenCalled();
    expect((await service.getTask(threadId))?.status).toBe("cancelled");
  });

  it("rejects create when daily token budget is exceeded", async () => {
    const usageStore = new MemoryUsageStore();
    const day = new Date().toISOString().slice(0, 10);
    await usageStore.addTokens("key:api", day, 100);
    const service = createService({
      usageStore,
      config: { ...loadConfig(), dailyTokenBudget: 100 },
      runner: {
        async *run() {
          yield { status: "completed", progress: 100 };
        },
      },
    });

    await expect(
      service.createTask({ files: [] }, apiKeyPrincipal),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("records token usage after graph updates", async () => {
    const usageStore = new MemoryUsageStore();
    const service = createService({
      usageStore,
      config: { ...loadConfig(), dailyTokenBudget: 0 },
      runner: {
        async *run() {
          yield {
            status: "generating_prd",
            progress: 50,
            structuredRequirements: { goal: "test" },
          };
        },
      },
    });
    const day = new Date().toISOString().slice(0, 10);

    await service.createTask({ files: [] }, apiKeyPrincipal);
    await vi.waitFor(async () => {
      expect(await usageStore.getTokens("key:api", day)).toBeGreaterThan(0);
    });
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

  it("revises the PRD via a chat message without disrupting the task's status", async () => {
    const requests: GraphRunRequest[] = [];
    const runner: TaskGraphRunner = {
      async *run(request) {
        requests.push(request);
        if (request.kind === "create") {
          yield {
            status: "completed",
            progress: 100,
            prd: { title: "旧标题" } as never,
            prototypeHtml: "<!doctype html><html></html>",
          };
          return;
        }
        yield {
          status: "completed",
          progress: 100,
          prd: { title: "新标题" } as never,
          prdMarkdown: "# 新标题",
          conversation: [
            { role: "user", target: "prd", message: "改标题", createdAt: "t1" },
            { role: "assistant", target: "prd", message: "已更新标题", createdAt: "t2" },
          ],
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

    await service.reviseContent(threadId, { target: "prd", message: "改标题" });

    expect(requests[1]).toEqual(
      expect.objectContaining({
        kind: "revise",
        target: "prd",
        message: "改标题",
      }),
    );
    expect(await service.getTask(threadId)).toEqual(
      expect.objectContaining({
        status: "completed",
        prd: expect.objectContaining({ title: "新标题" }),
        conversation: expect.arrayContaining([
          expect.objectContaining({ role: "assistant", message: "已更新标题" }),
        ]),
      }),
    );
  });

  it("rejects revising a task that has not produced a PRD yet", async () => {
    const runner: TaskGraphRunner = {
      async *run() {
        yield { status: "failed", progress: 100, error: "解析失败" };
      },
    };
    const service = createService({ runner });
    const { threadId } = await service.createTask(
      { files: [] },
      apiKeyPrincipal,
    );
    await vi.waitFor(async () => {
      expect((await service.getTask(threadId))?.status).toBe("failed");
    });

    await expect(
      service.reviseContent(threadId, { target: "prd", message: "改一下" }),
    ).rejects.toMatchObject({ code: "TASK_NOT_REVISABLE" });
  });

  it("rejects revising the prototype before one has been generated", async () => {
    const runner: TaskGraphRunner = {
      async *run() {
        yield {
          status: "awaiting_review",
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
      expect((await service.getTask(threadId))?.status).toBe("awaiting_review");
    });

    await expect(
      service.reviseContent(threadId, { target: "prototype", message: "改一下" }),
    ).rejects.toMatchObject({ code: "PROTOTYPE_REQUIRED" });
  });

  it("persists deliverables via the artifact writer as they are produced", async () => {
    const release = deferred<void>();
    const runner: TaskGraphRunner = {
      async *run() {
        await release.promise;
        yield { status: "generating_prototype", progress: 75, prdMarkdown: "# PRD" };
        yield {
          status: "completed",
          progress: 100,
          prototypeHtml: "<!doctype html><html></html>",
        };
      },
    };
    const write = vi.fn().mockResolvedValue(undefined);
    const artifactWriter: ArtifactWriter = { write, remove: vi.fn() };
    const service = createService({ runner, artifactWriter });
    const { threadId } = await service.createTask({ files: [] }, apiKeyPrincipal);

    release.resolve();
    await vi.waitFor(async () => {
      expect((await service.getTask(threadId))?.status).toBe("completed");
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ threadId, prdMarkdown: "# PRD" }),
    );
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadId,
        status: "completed",
        prototypeHtml: "<!doctype html><html></html>",
      }),
    );
  });

  it("does not let an artifact write failure break task processing", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const runner: TaskGraphRunner = {
      async *run() {
        yield { status: "completed", progress: 100, prdMarkdown: "# PRD" };
      },
    };
    const artifactWriter: ArtifactWriter = {
      write: vi.fn().mockRejectedValue(new Error("disk full")),
      remove: vi.fn(),
    };
    const service = createService({ runner, artifactWriter });

    const { threadId } = await service.createTask({ files: [] }, apiKeyPrincipal);

    await vi.waitFor(async () => {
      expect((await service.getTask(threadId))?.status).toBe("completed");
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

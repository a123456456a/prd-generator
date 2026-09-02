import { describe, expect, it, vi } from "vitest";
import {
  LangGraphRunner,
  TaskService,
  type GraphRunRequest,
  type TaskGraphRunner,
} from "../../src/services/taskService.js";

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

  it("returns a queued task before asynchronous graph work completes", async () => {
    const release = deferred<void>();
    const runner: TaskGraphRunner = {
      async *run() {
        await release.promise;
        yield { status: "completed", progress: 100, prdMarkdown: "# 完成" };
      },
    };
    const service = new TaskService({ runner });

    const result = await service.createTask({
      files: [],
      textDescription: "生成 PRD",
    });

    expect(result.threadId).toEqual(expect.any(String));
    expect(service.getTask(result.threadId)?.status).toBe("queued");
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
    const service = new TaskService({ runner });
    const { threadId } = await service.createTask({ files: [] });
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
    expect(service.getTask(threadId)?.status).toBe("completed");
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
    const service = new TaskService({ runner });
    const { threadId } = await service.createTask({ files: [] });
    await vi.waitFor(() => {
      expect(service.getTask(threadId)?.status).toBe("awaiting_review");
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
    expect(service.getTask(threadId)).toEqual(
      expect.objectContaining({
        status: "completed",
        prd: expect.objectContaining({ title: "新标题" }),
        prototypeHtml: "<!doctype html><html>new</html>",
        error: undefined,
      }),
    );
  });

  it("marks cancellation and rejects later updates", async () => {
    const release = deferred<void>();
    const runner: TaskGraphRunner = {
      async *run() {
        await release.promise;
        yield { status: "completed", progress: 100 };
      },
    };
    const service = new TaskService({ runner });
    const { threadId } = await service.createTask({ files: [] });
    const send = vi.fn();
    service.subscribe(threadId, send);

    await service.cancelTask(threadId);
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.getTask(threadId)?.status).toBe("cancelled");
    expect(send).toHaveBeenCalledWith(
      "status",
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("starts partial regeneration without reparsing input", async () => {
    const requests: GraphRunRequest[] = [];
    const runner: TaskGraphRunner = {
      async *run(request) {
        requests.push(request);
        yield { status: "completed", progress: 100 };
      },
    };
    const service = new TaskService({ runner });
    const { threadId } = await service.createTask({ files: [] });
    await vi.waitFor(() => {
      expect(service.getTask(threadId)?.status).toBe("completed");
    });

    await service.regenerate(threadId, "prototype");

    expect(requests[1]).toEqual(
      expect.objectContaining({ kind: "regenerate", target: "prototype" }),
    );
  });
});

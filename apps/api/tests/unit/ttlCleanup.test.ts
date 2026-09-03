import { describe, expect, it, vi } from "vitest";
import { MemoryTaskStore } from "../../src/services/taskStore.js";
import { runTtlCleanup } from "../../src/services/ttlCleanup.js";
import type { Storage } from "../../src/storage/types.js";
import type { TaskSnapshot } from "../../src/services/taskService.js";

function makeTask(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  const now = new Date().toISOString();
  return {
    threadId: "11111111-1111-1111-1111-111111111111",
    owner: { kind: "apiKey" },
    status: "completed",
    progress: 100,
    prdMarkdown: "",
    prototypeHtml: "",
    gaps: [],
    config: {},
    extractedText: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const noopStorage: Storage = {
  save: async () => ({
    storageKey: "key",
    originalName: "file",
    mimeType: "text/plain",
    size: 0,
    absolutePath: "/tmp/file",
  }),
  read: async () => Buffer.alloc(0),
  remove: async () => undefined,
};

describe("runTtlCleanup", () => {
  it("removes expired tasks from MemoryTaskStore", async () => {
    const taskStore = new MemoryTaskStore();
    const past = new Date("2020-01-01T00:00:00.000Z");
    const task = makeTask({
      threadId: "expired-thread",
      expiresAt: past.toISOString(),
    });
    const active = makeTask({
      threadId: "active-thread",
      expiresAt: new Date("2099-01-01T00:00:00.000Z").toISOString(),
    });
    await taskStore.save(task);
    await taskStore.save(active);

    const deleteThread = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2025-01-01T00:00:00.000Z");

    const result = await runTtlCleanup({
      taskStore,
      storage: noopStorage,
      checkpointer: { deleteThread },
      now,
    });

    expect(result.tasksRemoved).toBe(1);
    expect(await taskStore.get("expired-thread")).toBeNull();
    expect(await taskStore.get("active-thread")).not.toBeNull();
    expect(deleteThread).toHaveBeenCalledWith("expired-thread");
  });
});

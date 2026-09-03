import { describe, expect, it } from "vitest";
import { MemoryTaskStore } from "../../src/services/taskStore.js";

describe("MemoryTaskStore", () => {
  it("round-trips a task snapshot", async () => {
    const store = new MemoryTaskStore();
    const now = new Date().toISOString();
    const task = {
      threadId: "11111111-1111-1111-1111-111111111111",
      owner: { kind: "apiKey" as const },
      status: "queued" as const,
      progress: 0,
      prdMarkdown: "",
      prototypeHtml: "",
      gaps: [],
      config: {},
      extractedText: "",
      createdAt: now,
      updatedAt: now,
    };
    await store.save(task);
    expect(await store.get(task.threadId)).toEqual(task);
  });
});

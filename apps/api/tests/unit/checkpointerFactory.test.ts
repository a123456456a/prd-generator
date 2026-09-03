import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { createCheckpointer } from "../../src/graph/checkpointer.js";

describe("createCheckpointer", () => {
  it("returns MemorySaver when pool is null", async () => {
    const cp = await createCheckpointer(null);
    expect(cp).toBeInstanceOf(MemorySaver);
  });
});

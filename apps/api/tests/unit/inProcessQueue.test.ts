import { describe, expect, it } from "vitest";
import { InProcessQueue } from "../../src/services/taskQueue.js";

describe("InProcessQueue", () => {
  it("never runs more than maxConcurrent jobs", async () => {
    const queue = new InProcessQueue(2);
    let active = 0;
    let maxActive = 0;
    const job = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
    };
    await Promise.all([
      queue.schedule(job),
      queue.schedule(job),
      queue.schedule(job),
      queue.schedule(job),
    ]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

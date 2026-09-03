import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { runStartup } from "../../src/startup.js";

describe("runStartup", () => {
  it("ends the pool when startup fails", async () => {
    const error = new Error("listen failed");
    const end = vi.fn(async () => undefined);
    const pool = { end } as unknown as Pool;

    await expect(
      runStartup(pool, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(end).toHaveBeenCalledTimes(1);
  });

  it("preserves the memory path when startup fails without a pool", async () => {
    const error = new Error("listen failed");

    await expect(
      runStartup(null, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});

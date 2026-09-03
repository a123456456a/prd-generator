import { describe, expect, it } from "vitest";
import {
  assertWithinBudget,
  principalKey,
  utcDay,
} from "../../src/services/budget.js";
import { MemoryUsageStore } from "../../src/services/usageStore.js";

describe("budget", () => {
  it("throws BUDGET_EXCEEDED when usage reaches limit", async () => {
    const store = new MemoryUsageStore();
    await store.addTokens("key:api", utcDay(), 100);
    await expect(
      assertWithinBudget(store, "key:api", 100),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("skips when budget is 0", async () => {
    const store = new MemoryUsageStore();
    await store.addTokens("key:api", "2026-09-03", 999_999);
    await expect(assertWithinBudget(store, "key:api", 0)).resolves.toBeUndefined();
  });

  it("maps principals to stable keys", () => {
    expect(principalKey({ kind: "apiKey" })).toBe("key:api");
    expect(
      principalKey({
        kind: "user",
        userId: "u1",
        username: "alice",
        role: "user",
      }),
    ).toBe("user:u1");
  });

  it("formats UTC day as YYYY-MM-DD", () => {
    expect(utcDay(new Date("2026-09-03T15:30:00.000Z"))).toBe("2026-09-03");
  });
});

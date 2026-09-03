import type { Principal } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import type { UsageStore } from "./usageStore.js";

export type BudgetPrincipal =
  | { kind: "user"; userId: string }
  | { kind: "apiKey" };

/** Conservative per-LLM-node estimate; replace with real usage_metadata when available. */
export const CONSERVATIVE_NODE_TOKENS = 4000;

export function principalKey(principal: Principal | BudgetPrincipal): string {
  if (principal.kind === "user") return `user:${principal.userId}`;
  return "key:api";
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function assertWithinBudget(
  store: UsageStore,
  principalKey: string,
  budget: number,
): Promise<void> {
  if (budget <= 0) return;
  const used = await store.getTokens(principalKey, utcDay());
  if (used >= budget) {
    throw new AppError(
      "BUDGET_EXCEEDED",
      "今日 token 额度已用尽，请明日再试",
      429,
    );
  }
}

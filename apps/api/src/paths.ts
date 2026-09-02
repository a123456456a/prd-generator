import path from "node:path";
import { fileURLToPath } from "node:url";

/** `apps/api` package root */
export const API_ROOT = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

/** Monorepo repository root */
export const REPO_ROOT = path.resolve(API_ROOT, "../..");

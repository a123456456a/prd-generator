import path from "node:path";
import { REPO_ROOT } from "./paths.js";

export type AppConfig = {
  port: number;
  apiKey: string;
  openaiApiKey: string;
  extractModel: string;
  prdModel: string;
  uploadDir: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  langsmithTracing: boolean;
  adminUser: string;
  adminPassword: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  webDistDir: string;
  publicDir: string;
  corsOrigin: string;
};

export function assertProductionConfig(config: AppConfig): void {
  const errors: string[] = [];
  if (!config.apiKey.trim() || config.apiKey === "dev-api-key") {
    errors.push("API_KEY must be set to a non-default value");
  }
  if (
    !config.adminPassword.trim() ||
    config.adminPassword === "admin-change-me"
  ) {
    errors.push("ADMIN_PASSWORD must be set to a non-default value");
  }
  if (!config.cookieSecure) {
    errors.push("COOKIE_SECURE must be true");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid production configuration: ${errors.join("; ")}`);
  }
}

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    apiKey: process.env.API_KEY ?? "dev-api-key",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    extractModel: process.env.EXTRACT_MODEL ?? "gpt-4o-mini",
    prdModel: process.env.PRD_MODEL ?? "gpt-4o",
    uploadDir: resolveRepoPath(process.env.UPLOAD_DIR ?? "uploads"),
    maxFileBytes: 50 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
    maxFiles: 20,
    langsmithTracing: process.env.LANGSMITH_TRACING === "true",
    adminUser: process.env.ADMIN_USER ?? "admin",
    adminPassword: process.env.ADMIN_PASSWORD ?? "admin-change-me",
    sessionTtlMs: Number(
      process.env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000,
    ),
    cookieSecure: process.env.COOKIE_SECURE === "true",
    webDistDir: resolveRepoPath(process.env.WEB_DIST_DIR ?? "public/web"),
    publicDir: resolveRepoPath(process.env.PUBLIC_DIR ?? "public"),
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  };
}

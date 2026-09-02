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
  corsOrigin: string;
};

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    apiKey: process.env.API_KEY ?? "dev-api-key",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    extractModel: process.env.EXTRACT_MODEL ?? "gpt-4o-mini",
    prdModel: process.env.PRD_MODEL ?? "gpt-4o",
    uploadDir: process.env.UPLOAD_DIR ?? "uploads",
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
    webDistDir: process.env.WEB_DIST_DIR ?? "public/web",
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  };
}

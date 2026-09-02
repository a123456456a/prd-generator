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
  };
}

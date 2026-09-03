import { afterEach, describe, expect, it } from "vitest";
import {
  assertProductionConfig,
  loadConfig,
  type AppConfig,
} from "../../src/config.js";

const baseConfig: AppConfig = {
  port: 3000,
  apiKey: "strong-api-key",
  openaiApiKey: "",
  openaiBaseUrl: null,
  extractModel: "test-extract",
  prdModel: "test-prd",
  uploadDir: "unused",
  maxFileBytes: 1024,
  maxTotalBytes: 2048,
  maxFiles: 2,
  langsmithTracing: false,
  adminUser: "admin",
  adminPassword: "strong-admin-password",
  sessionTtlMs: 60_000,
  cookieSecure: true,
  webDistDir: "unused",
  publicDir: "unused",
  corsOrigin: "https://example.com",
  databaseUrl: "postgresql://prd:prd@10.0.0.15:5432/prd_generator",
  taskTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxConcurrentTasks: 10,
  dailyTokenBudget: 500_000,
};

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "EXTRACT_MODEL",
  "PRD_MODEL",
] as const;

const previousEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("loadConfig OpenAI-compatible provider", () => {
  it("reads DeepSeek-style base URL and model overrides", () => {
    process.env.OPENAI_API_KEY = "sk-deepseek-test";
    process.env.OPENAI_BASE_URL = "https://api.deepseek.com";
    process.env.EXTRACT_MODEL = "deepseek-v4-flash";
    process.env.PRD_MODEL = "deepseek-v4-pro";

    const config = loadConfig();

    expect(config.openaiApiKey).toBe("sk-deepseek-test");
    expect(config.openaiBaseUrl).toBe("https://api.deepseek.com");
    expect(config.extractModel).toBe("deepseek-v4-flash");
    expect(config.prdModel).toBe("deepseek-v4-pro");
  });

  it("treats blank OPENAI_BASE_URL as null", () => {
    process.env.OPENAI_BASE_URL = "   ";
    expect(loadConfig().openaiBaseUrl).toBeNull();
  });
});

describe("assertProductionConfig", () => {
  it.each([
    ["an empty API key", { apiKey: "" }],
    ["the default API key", { apiKey: "dev-api-key" }],
    ["an empty admin password", { adminPassword: "" }],
    ["the default admin password", { adminPassword: "admin-change-me" }],
    ["an insecure session cookie", { cookieSecure: false }],
  ])("rejects %s", (_label, patch) => {
    expect(() =>
      assertProductionConfig({ ...baseConfig, ...patch }),
    ).toThrow();
  });

  it("accepts strong credentials with secure cookies", () => {
    expect(() => assertProductionConfig(baseConfig)).not.toThrow();
  });

  it("rejects missing DATABASE_URL in production config", () => {
    expect(() =>
      assertProductionConfig({ ...baseConfig, databaseUrl: null }),
    ).toThrow(/DATABASE_URL/);
  });
});

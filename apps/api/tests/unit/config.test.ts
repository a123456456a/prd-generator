import { describe, expect, it } from "vitest";
import {
  assertProductionConfig,
  type AppConfig,
} from "../../src/config.js";

const baseConfig: AppConfig = {
  port: 3000,
  apiKey: "strong-api-key",
  openaiApiKey: "",
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

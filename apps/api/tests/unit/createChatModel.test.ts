import { describe, expect, it } from "vitest";
import {
  buildChatModelOptions,
  buildOpenAIClientOptions,
} from "../../src/llm/createChatModel.js";

describe("buildChatModelOptions", () => {
  it("passes api key and base URL for OpenAI-compatible providers", () => {
    expect(
      buildChatModelOptions("deepseek-v4-flash", {
        openaiApiKey: "sk-deepseek",
        openaiBaseUrl: "https://api.deepseek.com",
      }),
    ).toEqual({
      model: "deepseek-v4-flash",
      apiKey: "sk-deepseek",
      configuration: { baseURL: "https://api.deepseek.com" },
    });
  });

  it("omits empty credentials so the SDK can fall back to env defaults", () => {
    expect(
      buildChatModelOptions("gpt-4o-mini", {
        openaiApiKey: "",
        openaiBaseUrl: null,
      }),
    ).toEqual({ model: "gpt-4o-mini" });
  });
});

describe("buildOpenAIClientOptions", () => {
  it("maps config into OpenAI SDK client options", () => {
    expect(
      buildOpenAIClientOptions({
        openaiApiKey: "sk-deepseek",
        openaiBaseUrl: "https://api.deepseek.com",
      }),
    ).toEqual({
      apiKey: "sk-deepseek",
      baseURL: "https://api.deepseek.com",
    });
  });
});

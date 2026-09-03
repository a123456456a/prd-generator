import { describe, expect, it } from "vitest";
import { resolveStructuredOutputMethod } from "../../src/llm/structuredOutput.js";

describe("resolveStructuredOutputMethod", () => {
  it("uses functionCalling for DeepSeek-compatible base URLs", () => {
    expect(
      resolveStructuredOutputMethod({
        openaiBaseUrl: "https://api.deepseek.com",
      }),
    ).toBe("functionCalling");
    expect(
      resolveStructuredOutputMethod({
        openaiBaseUrl: "https://api.deepseek.com/v1",
      }),
    ).toBe("functionCalling");
  });

  it("keeps provider default for OpenAI or unset base URL", () => {
    expect(
      resolveStructuredOutputMethod({ openaiBaseUrl: null }),
    ).toBeUndefined();
    expect(
      resolveStructuredOutputMethod({
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toBeUndefined();
  });

  it("allows STRUCTURED_OUTPUT_METHOD override", () => {
    expect(
      resolveStructuredOutputMethod({
        openaiBaseUrl: null,
        structuredOutputMethod: "functionCalling",
      }),
    ).toBe("functionCalling");
  });
});

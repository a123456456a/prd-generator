import { ChatOpenAI } from "@langchain/openai";
import type { ClientOptions } from "openai";
import type { AppConfig } from "../config.js";
import type { GraphModel } from "../graph/state.js";

export type OpenAICompatibleConfig = Pick<
  AppConfig,
  "openaiApiKey" | "openaiBaseUrl"
>;

export type ChatModelOptions = {
  model: string;
  apiKey?: string;
  configuration?: { baseURL: string };
  /** Extra body fields for OpenAI-compatible providers (e.g. DeepSeek thinking). */
  modelKwargs?: Record<string, unknown>;
};

function isDeepSeekBaseUrl(baseUrl: string | null | undefined): boolean {
  return (baseUrl ?? "").toLowerCase().includes("deepseek");
}

export function buildChatModelOptions(
  model: string,
  config: OpenAICompatibleConfig,
): ChatModelOptions {
  return {
    model,
    ...(config.openaiApiKey ? { apiKey: config.openaiApiKey } : {}),
    ...(config.openaiBaseUrl
      ? { configuration: { baseURL: config.openaiBaseUrl } }
      : {}),
    // DeepSeek V4 thinking mode rejects tool_choice used by functionCalling.
    ...(isDeepSeekBaseUrl(config.openaiBaseUrl)
      ? { modelKwargs: { thinking: { type: "disabled" } } }
      : {}),
  };
}

export function buildOpenAIClientOptions(
  config: OpenAICompatibleConfig,
): ClientOptions {
  return {
    ...(config.openaiApiKey ? { apiKey: config.openaiApiKey } : {}),
    ...(config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : {}),
  };
}

export function createChatModel(
  model: string,
  config: OpenAICompatibleConfig,
): GraphModel {
  return new ChatOpenAI(
    buildChatModelOptions(model, config),
  ) as unknown as GraphModel;
}

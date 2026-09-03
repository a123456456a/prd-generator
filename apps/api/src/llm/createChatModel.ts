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
};

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

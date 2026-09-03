import type { AppConfig } from "../config.js";

export type StructuredOutputMethod =
  | "jsonMode"
  | "functionCalling"
  | "jsonSchema";

export type StructuredOutputConfig = Pick<AppConfig, "openaiBaseUrl"> & {
  structuredOutputMethod?: StructuredOutputMethod | null;
};

/**
 * DeepSeek rejects OpenAI `json_schema` response_format, and its default
 * thinking mode also rejects tool_choice. Prefer functionCalling after
 * disabling thinking in the chat client; leave undefined for OpenAI defaults.
 */
export function resolveStructuredOutputMethod(
  config: StructuredOutputConfig,
): StructuredOutputMethod | undefined {
  if (config.structuredOutputMethod) {
    return config.structuredOutputMethod;
  }
  const base = config.openaiBaseUrl?.toLowerCase() ?? "";
  if (base.includes("deepseek")) {
    return "functionCalling";
  }
  return undefined;
}

export function structuredOutputOptions(
  config: StructuredOutputConfig,
): { method: StructuredOutputMethod } | undefined {
  const method = resolveStructuredOutputMethod(config);
  return method ? { method } : undefined;
}

import type { Language } from "../schemas/prdSchema.js";

export function buildPrdPrompt(
  structuredRequirements: unknown,
  sourceText: string,
  language: Language,
): string {
  return [
    "Generate a complete PRD matching the requested structured schema.",
    `Output language: ${language}.`,
    "Return a single valid JSON object that matches the PRD schema. Do not wrap it in markdown.",
    `Structured requirements: ${JSON.stringify(structuredRequirements)}`,
    "",
    "Source text:",
    sourceText,
  ].join("\n");
}

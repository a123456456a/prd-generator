import type { Language } from "../schemas/prdSchema.js";

export function buildExtractPrompt(text: string, language: Language): string {
  return [
    "Extract structured product requirements from the source text.",
    `Output language: ${language}.`,
    "Return structuredRequirements plus a gaps array for material missing information.",
    "",
    text,
  ].join("\n");
}

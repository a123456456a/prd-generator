import type { Language } from "../schemas/prdSchema.js";

export function buildExtractPrompt(text: string, language: Language): string {
  return [
    "Extract structured product requirements from the source text.",
    `Output language: ${language}.`,
    "Fill productSummary, keyFeatures, targetUsers, constraints, and gaps.",
    "gaps must list missing information needed to write a complete PRD; use an empty array when nothing is missing.",
    "Return JSON via the structured tool/function call.",
    "",
    text,
  ].join("\n");
}

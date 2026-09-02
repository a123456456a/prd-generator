import type { PRD } from "../schemas/prdSchema.js";

export function buildPrototypePrompt(prd: PRD): string {
  return [
    "Generate one self-contained HTML prototype for this PRD.",
    "Return only a complete HTML document, including an opening HTML marker and </html>.",
    "",
    JSON.stringify(prd),
  ].join("\n");
}

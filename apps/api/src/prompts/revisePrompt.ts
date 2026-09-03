import type { ConversationTurn } from "../types/conversation.js";
import type { Language, PRD } from "../schemas/prdSchema.js";

function formatHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return "";
  const recent = history.slice(-8);
  return [
    "Recent conversation about this task (most recent last):",
    ...recent.map(
      (turn) =>
        `${turn.role === "user" ? "User" : "Assistant"} (about ${turn.target}): ${turn.message}`,
    ),
  ].join("\n");
}

export function buildRevisePrdPrompt(
  currentPrd: PRD,
  message: string,
  history: ConversationTurn[],
  language: Language,
): string {
  return [
    "You are helping a user make a small, targeted revision to an existing PRD through natural-language chat.",
    "Return a single JSON object with exactly two fields:",
    '- "prd": the COMPLETE revised PRD matching the PRD schema.',
    '- "changeSummary": one short sentence (in the PRD language) describing what you changed.',
    "Keep every field the user did not ask to change EXACTLY as it was. Only modify what the feedback requires. Do not rewrite or rephrase unrelated sections.",
    `PRD language: ${language}.`,
    formatHistory(history),
    "Current PRD:",
    JSON.stringify(currentPrd),
    "",
    "User's requested change:",
    message,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRevisePrototypePrompt(
  currentHtml: string,
  prd: PRD,
  message: string,
  history: ConversationTurn[],
): string {
  return [
    "You are helping a user make a small, targeted revision to an existing HTML prototype through natural-language chat.",
    "First output a single-line HTML comment summarizing what you changed, e.g. <!-- Updated the primary button color to blue -->.",
    "Immediately after that comment, output the COMPLETE revised HTML document, including an opening HTML marker and a closing </html> tag.",
    "Keep everything the user did not ask to change EXACTLY as it was. Only modify what the feedback requires. Do not regenerate unrelated sections.",
    formatHistory(history),
    "Reference PRD (context only, do not restate it):",
    JSON.stringify(prd),
    "",
    "Current HTML prototype:",
    currentHtml,
    "",
    "User's requested change:",
    message,
  ]
    .filter(Boolean)
    .join("\n");
}

import { buildRevisePrototypePrompt } from "../../prompts/revisePrompt.js";
import type { PRD } from "../../schemas/prdSchema.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { HtmlValidationResult } from "../../utils/htmlValidate.js";
import { responseText } from "../../utils/modelResponseText.js";
import type { GraphModel } from "../state.js";

const MAX_ATTEMPTS = 2;
const LEADING_COMMENT = /^\s*<!--([\s\S]*?)-->\s*/;

function splitSummaryAndHtml(raw: string): { summary?: string; html: string } {
  const match = raw.match(LEADING_COMMENT);
  if (!match) return { html: raw };
  return { summary: match[1].trim(), html: raw.slice(match[0].length) };
}

export type RevisePrototypeOutcome =
  | { prototypeHtml: string; changeSummary: string }
  | { error: string };

export function createRevisePrototypeNode(
  modelFactory: (model: string) => GraphModel,
  defaultModel: string,
  validateHtml: (html: string) => HtmlValidationResult,
) {
  return async (
    currentHtml: string,
    prd: PRD,
    message: string,
    history: ConversationTurn[],
    model = defaultModel,
  ): Promise<RevisePrototypeOutcome> => {
    const chatModel = modelFactory(model);
    const prompt = buildRevisePrototypePrompt(currentHtml, prd, message, history);
    let reason = "模型未返回完整 HTML";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const raw = responseText(await chatModel.invoke(prompt));
        const { summary, html } = splitSummaryAndHtml(raw);
        const validation = validateHtml(html);
        if (validation.ok) {
          return {
            prototypeHtml: html,
            changeSummary: summary?.trim() || "已根据反馈更新原型",
          };
        }
        reason = validation.reason;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }

    return { error: `原型修改失败：${reason}` };
  };
}

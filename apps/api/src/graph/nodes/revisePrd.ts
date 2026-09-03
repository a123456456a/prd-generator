import { buildRevisePrdPrompt } from "../../prompts/revisePrompt.js";
import { RevisePrdResultSchema } from "../../schemas/reviseSchema.js";
import type { Language, PRD } from "../../schemas/prdSchema.js";
import type { ConversationTurn } from "../../types/conversation.js";
import { prdToMarkdown } from "../../utils/prdToMarkdown.js";
import type { GraphModel } from "../state.js";

const MAX_ATTEMPTS = 3;

export type RevisePrdOutcome =
  | { prd: PRD; prdMarkdown: string; changeSummary: string }
  | { error: string };

export function createRevisePrdNode(
  modelFactory: (model: string) => GraphModel,
  defaultModel: string,
) {
  return async (
    currentPrd: PRD,
    message: string,
    history: ConversationTurn[],
    language: Language,
    model = defaultModel,
  ): Promise<RevisePrdOutcome> => {
    const chatModel = modelFactory(model);
    const structuredModel = chatModel.withStructuredOutput?.(
      RevisePrdResultSchema,
    );
    if (!structuredModel) {
      return { error: "PRD 模型不支持结构化输出" };
    }

    const prompt = buildRevisePrdPrompt(currentPrd, message, history, language);
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const parsed = RevisePrdResultSchema.parse(
          await structuredModel.invoke(prompt),
        );
        return {
          prd: parsed.prd,
          prdMarkdown: prdToMarkdown(parsed.prd),
          changeSummary: parsed.changeSummary,
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      error: `PRD 修改失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    };
  };
}

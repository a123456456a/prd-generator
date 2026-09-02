import { buildPrdPrompt } from "../../prompts/prdPrompt.js";
import { PRDSchema } from "../../schemas/prdSchema.js";
import { prdToMarkdown } from "../../utils/prdToMarkdown.js";
import type { GraphModel, GraphStateType } from "../state.js";

const MAX_ATTEMPTS = 3;

export function createGeneratePrdNode(
  modelFactory: (model: string) => GraphModel,
  defaultModel: string,
) {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const model = modelFactory(state.config.prdModel ?? defaultModel);
    const structuredModel = model.withStructuredOutput?.(PRDSchema);
    if (!structuredModel) {
      return {
        status: "failed",
        progress: 100,
        error: "PRD 模型不支持结构化输出",
      };
    }

    const prompt = buildPrdPrompt(
      state.structuredRequirements,
      state.extractedText,
      state.config.language ?? "zh-CN",
    );
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const prd = PRDSchema.parse(await structuredModel.invoke(prompt));
        const status = state.config.enableHumanReview
          ? "awaiting_review"
          : state.config.skipPrototype
            ? "completed"
            : "generating_prototype";

        return {
          prd,
          prdMarkdown: prdToMarkdown(prd),
          status,
          progress: status === "completed" || status === "awaiting_review" ? 100 : 75,
          error: undefined,
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      status: "failed",
      progress: 100,
      error: `PRD 生成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    };
  };
}

import { z } from "zod";
import { buildExtractPrompt } from "../../prompts/extractPrompt.js";
import type { GraphModel, GraphStateType } from "../state.js";

/** Flat schema keeps DeepSeek functionCalling reliable (nested free-form objects often stringify). */
const ExtractedRequirementsSchema = z.object({
  productSummary: z.string(),
  keyFeatures: z.array(z.string()),
  targetUsers: z.array(z.string()),
  constraints: z.array(z.string()),
  gaps: z.array(z.string()),
});

export function createExtractRequirementsNode(
  modelFactory: (model: string) => GraphModel,
  defaultModel: string,
) {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    try {
      const model = modelFactory(state.config.extractModel ?? defaultModel);
      const structuredModel = model.withStructuredOutput?.(
        ExtractedRequirementsSchema,
      );
      if (!structuredModel) {
        throw new Error("抽取模型不支持结构化输出");
      }

      const output = ExtractedRequirementsSchema.parse(
        await structuredModel.invoke(
          buildExtractPrompt(
            state.extractedText,
            state.config.language ?? "zh-CN",
          ),
        ),
      );
      const structuredRequirements = {
        productSummary: output.productSummary,
        keyFeatures: output.keyFeatures,
        targetUsers: output.targetUsers,
        constraints: output.constraints,
      };
      const awaitingClarification =
        Boolean(state.config.requireClarification) && output.gaps.length > 0;

      return {
        structuredRequirements,
        gaps: output.gaps,
        status: awaitingClarification
          ? "awaiting_clarification"
          : "generating_prd",
        progress: awaitingClarification ? 100 : 50,
        error: undefined,
      };
    } catch (error) {
      return {
        status: "failed",
        progress: 100,
        error: `需求抽取失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

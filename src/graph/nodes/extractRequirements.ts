import { z } from "zod";
import { buildExtractPrompt } from "../../prompts/extractPrompt.js";
import type { GraphModel, GraphStateType } from "../state.js";

const ExtractedRequirementsSchema = z.object({
  structuredRequirements: z.unknown(),
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
      const awaitingClarification =
        Boolean(state.config.requireClarification) && output.gaps.length > 0;

      return {
        structuredRequirements: output.structuredRequirements,
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

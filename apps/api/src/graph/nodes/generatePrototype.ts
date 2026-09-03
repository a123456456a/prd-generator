import { buildPrototypePrompt } from "../../prompts/prototypePrompt.js";
import type { HtmlValidationResult } from "../../utils/htmlValidate.js";
import { responseText } from "../../utils/modelResponseText.js";
import type { GraphModel, GraphStateType } from "../state.js";

export function createGeneratePrototypeNode(
  modelFactory: (model: string) => GraphModel,
  defaultModel: string,
  validateHtml: (html: string) => HtmlValidationResult,
) {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    if (!state.prd) {
      return {
        status: "failed",
        progress: 100,
        error: "缺少 PRD，无法生成原型",
      };
    }

    const model = modelFactory(
      state.config.prototypeModel ?? state.config.prdModel ?? defaultModel,
    );
    const prompt = buildPrototypePrompt(state.prd);
    let reason = "模型未返回完整 HTML";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const html = responseText(await model.invoke(prompt));
        const validation = validateHtml(html);
        if (validation.ok) {
          return {
            prototypeHtml: html,
            status: "completed",
            progress: 100,
            error: undefined,
          };
        }
        reason = validation.reason;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      status: "failed",
      progress: 100,
      error: `原型生成失败：${reason}`,
    };
  };
}

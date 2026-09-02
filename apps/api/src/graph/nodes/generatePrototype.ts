import { buildPrototypePrompt } from "../../prompts/prototypePrompt.js";
import type { HtmlValidationResult } from "../../utils/htmlValidate.js";
import type { GraphModel, GraphStateType } from "../state.js";

function responseText(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }
  if (!response || typeof response !== "object" || !("content" in response)) {
    return "";
  }

  const content = response.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof part.text === "string" ? part.text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

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

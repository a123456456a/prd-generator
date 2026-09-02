import type { ParseInputsArgs, ParseResult } from "../../parsers/types.js";
import type { GraphStateType } from "../state.js";

export function createParseMultimodalNode(
  parseInputs: (args: ParseInputsArgs) => Promise<ParseResult>,
) {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    try {
      const result = await parseInputs({
        files: state.rawFiles,
        textDescription: state.config.textDescription ?? state.extractedText,
      });

      if (!result.extractedText.trim()) {
        return {
          fragments: result.fragments,
          extractedText: "",
          status: "failed",
          progress: 100,
          error: "未能从输入中解析出有效文本",
        };
      }

      return {
        fragments: result.fragments,
        extractedText: result.extractedText,
        status: "extracting",
        progress: 25,
        error: undefined,
      };
    } catch (error) {
      return {
        status: "failed",
        progress: 100,
        error: `输入解析失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

import { END, START, StateGraph } from "@langchain/langgraph";
import { loadConfig } from "../config.js";
import { createChatModel } from "../llm/createChatModel.js";
import { structuredOutputOptions } from "../llm/structuredOutput.js";
import { parseInputs } from "../parsers/index.js";
import { assertPrototypeHtml } from "../utils/htmlValidate.js";
import { createExtractRequirementsNode } from "./nodes/extractRequirements.js";
import { createGeneratePrdNode } from "./nodes/generatePRD.js";
import { createGeneratePrototypeNode } from "./nodes/generatePrototype.js";
import { createParseMultimodalNode } from "./nodes/parseMultimodal.js";
import {
  GraphState,
  type GraphDependencies,
  type GraphModel,
  type GraphStateType,
} from "./state.js";

function afterParse(state: GraphStateType): "extract_requirements" | typeof END {
  return state.status === "failed" ? END : "extract_requirements";
}

function afterExtract(
  state: GraphStateType,
): "generate_prd" | typeof END {
  return state.status === "generating_prd" ? "generate_prd" : END;
}

function afterPrd(
  state: GraphStateType,
): "generate_prototype" | typeof END {
  return state.status === "generating_prototype" ? "generate_prototype" : END;
}

export function createDefaultModelFactory(): (model: string) => GraphModel {
  const config = loadConfig();
  const structuredOpts = structuredOutputOptions({
    openaiBaseUrl: config.openaiBaseUrl,
    structuredOutputMethod: config.structuredOutputMethod ?? undefined,
  });

  return (model: string): GraphModel => {
    const chat = createChatModel(model, config);
    if (!structuredOpts) {
      return chat;
    }

    return {
      invoke: (input) => chat.invoke(input),
      withStructuredOutput: (schema) => {
        const bound = chat.withStructuredOutput?.(schema, structuredOpts);
        if (!bound) {
          throw new Error("模型不支持结构化输出");
        }
        return bound;
      },
    };
  };
}

export function buildGraph(deps: GraphDependencies) {
  const config = loadConfig();
  const modelFactory = deps.modelFactory ?? createDefaultModelFactory();

  return new StateGraph(GraphState)
    .addNode(
      "parse_multimodal",
      createParseMultimodalNode(deps.parseInputs ?? parseInputs),
    )
    .addNode(
      "extract_requirements",
      createExtractRequirementsNode(modelFactory, config.extractModel),
    )
    .addNode(
      "generate_prd",
      createGeneratePrdNode(modelFactory, config.prdModel),
    )
    .addNode(
      "generate_prototype",
      createGeneratePrototypeNode(
        modelFactory,
        config.prdModel,
        deps.validateHtml ?? assertPrototypeHtml,
      ),
    )
    .addEdge(START, "parse_multimodal")
    .addConditionalEdges("parse_multimodal", afterParse, [
      "extract_requirements",
      END,
    ])
    .addConditionalEdges("extract_requirements", afterExtract, [
      "generate_prd",
      END,
    ])
    .addConditionalEdges("generate_prd", afterPrd, [
      "generate_prototype",
      END,
    ])
    .addEdge("generate_prototype", END)
    .compile({ checkpointer: deps.checkpointer });
}

export type { GraphDependencies, GraphModel } from "./state.js";

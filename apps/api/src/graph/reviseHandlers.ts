import { loadConfig } from "../config.js";
import { assertPrototypeHtml, type HtmlValidationResult } from "../utils/htmlValidate.js";
import { createRevisePrdNode, type RevisePrdOutcome } from "./nodes/revisePrd.js";
import {
  createRevisePrototypeNode,
  type RevisePrototypeOutcome,
} from "./nodes/revisePrototype.js";
import type { Language, PRD } from "../schemas/prdSchema.js";
import type { ConversationTurn } from "../types/conversation.js";
import { createDefaultModelFactory } from "./workflow.js";
import type { GraphModel } from "./state.js";

export type ReviseDependencies = {
  modelFactory?: (model: string) => GraphModel;
  validateHtml?: (html: string) => HtmlValidationResult;
};

export type ReviseHandlers = {
  revisePrd(
    prd: PRD,
    message: string,
    history: ConversationTurn[],
    language: Language,
    model?: string,
  ): Promise<RevisePrdOutcome>;
  revisePrototype(
    html: string,
    prd: PRD,
    message: string,
    history: ConversationTurn[],
    model?: string,
  ): Promise<RevisePrototypeOutcome>;
};

/** Builds the natural-language "chat" handlers used to revise an already-generated PRD/prototype. */
export function buildReviseHandlers(
  deps: ReviseDependencies = {},
): ReviseHandlers {
  const config = loadConfig();
  const modelFactory = deps.modelFactory ?? createDefaultModelFactory();

  return {
    revisePrd: createRevisePrdNode(modelFactory, config.prdModel),
    revisePrototype: createRevisePrototypeNode(
      modelFactory,
      config.prdModel,
      deps.validateHtml ?? assertPrototypeHtml,
    ),
  };
}

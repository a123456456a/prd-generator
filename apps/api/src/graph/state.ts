import { Annotation } from "@langchain/langgraph";
import type { ParseFragment, ParseInputsArgs, ParseResult } from "../parsers/types.js";
import type { PRD, Language } from "../schemas/prdSchema.js";
import type { StoredFile } from "../storage/types.js";
import type { HtmlValidationResult } from "../utils/htmlValidate.js";

export type GraphStatus =
  | "parsing"
  | "extracting"
  | "generating_prd"
  | "awaiting_clarification"
  | "awaiting_review"
  | "generating_prototype"
  | "completed"
  | "failed";

export type GraphConfig = {
  language?: Language;
  requireClarification?: boolean;
  enableHumanReview?: boolean;
  skipPrototype?: boolean;
  extractModel?: string;
  prdModel?: string;
  prototypeModel?: string;
  textDescription?: string;
};

export type GraphModel = {
  invoke(input: string): Promise<unknown>;
  withStructuredOutput?: (
    schema: unknown,
  ) => { invoke(input: string): Promise<unknown> };
};

export type GraphDependencies = {
  parseInputs?: (args: ParseInputsArgs) => Promise<ParseResult>;
  modelFactory?: (model: string) => GraphModel;
  validateHtml?: (html: string) => HtmlValidationResult;
};

const overwrite = <T>(current: T, update: T): T => update ?? current;

export const GraphState = Annotation.Root({
  rawFiles: Annotation<StoredFile[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  fragments: Annotation<ParseFragment[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  extractedText: Annotation<string>({
    reducer: overwrite,
    default: () => "",
  }),
  gaps: Annotation<string[]>({
    reducer: overwrite,
    default: () => [],
  }),
  structuredRequirements: Annotation<unknown>({
    reducer: overwrite,
    default: () => undefined,
  }),
  prd: Annotation<PRD | null | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  prdMarkdown: Annotation<string>({
    reducer: overwrite,
    default: () => "",
  }),
  prototypeHtml: Annotation<string>({
    reducer: overwrite,
    default: () => "",
  }),
  status: Annotation<GraphStatus>({
    reducer: overwrite,
    default: () => "parsing",
  }),
  progress: Annotation<number>({
    reducer: overwrite,
    default: () => 0,
  }),
  error: Annotation<string | undefined>({
    reducer: overwrite,
    default: () => undefined,
  }),
  userEdits: Annotation<Record<string, unknown>>({
    reducer: overwrite,
    default: () => ({}),
  }),
  config: Annotation<GraphConfig>({
    reducer: overwrite,
    default: () => ({}),
  }),
});

export type GraphStateType = typeof GraphState.State;

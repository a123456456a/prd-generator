import type { StoredFile } from "../storage/types.js";

export type ParseFragment = {
  sourceId: string;
  fileName?: string;
  mimeType?: string;
  excerpt: string;
  charCount: number;
  parseStatus: "ok" | "partial" | "failed";
  errorMessage?: string;
};

export type ParseResult = {
  extractedText: string;
  fragments: ParseFragment[];
  warnings: string[];
};

export type ParseInputsArgs = {
  files: StoredFile[];
  textDescription?: string;
  transcribe?: (file: StoredFile) => Promise<string>;
};

export type FileParseOutput = {
  text: string;
  status: "ok" | "partial";
  warnings: string[];
};

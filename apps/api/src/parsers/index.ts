import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { StoredFile } from "../storage/types.js";
import { parseDocumentFile } from "./documentParser.js";
import { parseTextFile } from "./textParser.js";
import type {
  FileParseOutput,
  ParseFragment,
  ParseInputsArgs,
  ParseResult,
} from "./types.js";
import { transcribeVoice } from "./voiceParser.js";

const EXCERPT_LENGTH = 2_000;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv"]);

function fragmentFor(
  file: StoredFile,
  text: string,
  status: ParseFragment["parseStatus"],
  errorMessage?: string,
): ParseFragment {
  return {
    sourceId: file.storageKey,
    fileName: file.originalName,
    mimeType: file.mimeType,
    excerpt: text.slice(0, EXCERPT_LENGTH),
    charCount: text.length,
    parseStatus: status,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

async function parseFile(
  file: StoredFile,
  transcribe: (file: StoredFile) => Promise<string>,
): Promise<FileParseOutput> {
  const extension = extname(file.originalName).toLowerCase();

  if (file.mimeType.startsWith("audio/")) {
    return {
      text: (await transcribe(file)).trim(),
      status: "ok",
      warnings: [],
    };
  }

  if (file.mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extension)) {
    const buffer = await readFile(file.absolutePath);
    return { text: parseTextFile(buffer).trim(), status: "ok", warnings: [] };
  }

  return parseDocumentFile(file);
}

export async function parseInputs({
  files,
  textDescription,
  transcribe = transcribeVoice,
}: ParseInputsArgs): Promise<ParseResult> {
  const warnings: string[] = [];
  const fragments: ParseFragment[] = [];
  const extractedParts: string[] = [];
  const description = textDescription?.trim();

  if (description) {
    fragments.push({
      sourceId: "text-description",
      excerpt: description.slice(0, EXCERPT_LENGTH),
      charCount: description.length,
      parseStatus: "ok",
    });
    extractedParts.push(description);
  }

  const parsedFiles = await Promise.all(
    files.map(async (file) => {
      try {
        const output = await parseFile(file, transcribe);
        return {
          fragment: fragmentFor(file, output.text, output.status),
          text: output.text,
          warnings: output.warnings,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          fragment: fragmentFor(file, "", "failed", message),
          text: "",
          warnings: [`${file.originalName}: ${message}`],
        };
      }
    }),
  );

  for (const parsed of parsedFiles) {
    fragments.push(parsed.fragment);
    if (parsed.text) {
      extractedParts.push(parsed.text);
    }
    warnings.push(...parsed.warnings);
  }

  if (
    fragments.length > 0 &&
    fragments.every((fragment) => fragment.parseStatus === "failed")
  ) {
    warnings.push("所有输入均解析失败");
  }

  return {
    extractedText: extractedParts.join("\n\n"),
    fragments,
    warnings,
  };
}

export { parseDocumentFile } from "./documentParser.js";
export { parseTextFile } from "./textParser.js";
export type {
  ParseFragment,
  ParseInputsArgs,
  ParseResult,
} from "./types.js";
export { transcribeVoice } from "./voiceParser.js";

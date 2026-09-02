import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type { StoredFile } from "../storage/types.js";
import type { FileParseOutput } from "./types.js";

// markitdown-node was intentionally omitted: installation failed because its
// transitive sharp/tesseract build scripts were blocked. These focused
// fallbacks avoid making native/OCR builds a requirement for the service.

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function parseDocx(buffer: Buffer): Promise<FileParseOutput> {
  const result = await mammoth.extractRawText({ buffer });
  const warnings = result.messages.map((message) => message.message);

  return {
    text: result.value.trim(),
    status: warnings.length > 0 ? "partial" : "ok",
    warnings,
  };
}

async function parsePdf(buffer: Buffer): Promise<FileParseOutput> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text.trim(), status: "ok", warnings: [] };
  } finally {
    await parser.destroy();
  }
}

async function parsePptx(buffer: Buffer): Promise<FileParseOutput> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );

  const slideTexts = await Promise.all(
    slides.map(async (name) => {
      const xml = await zip.file(name)!.async("string");
      return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi)]
        .map((match) => decodeXmlText(match[1]))
        .join(" ");
    }),
  );

  return {
    text: slideTexts.filter(Boolean).join("\n").trim(),
    status: "ok",
    warnings: [],
  };
}

export async function parseDocumentFile(
  file: StoredFile,
): Promise<FileParseOutput> {
  const extension = extname(file.originalName).toLowerCase();
  const buffer = await readFile(file.absolutePath);

  if (
    extension === ".docx" ||
    file.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return parseDocx(buffer);
  }

  if (extension === ".pdf" || file.mimeType === "application/pdf") {
    return parsePdf(buffer);
  }

  if (
    extension === ".pptx" ||
    file.mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return parsePptx(buffer);
  }

  if (
    extension === ".xlsx" ||
    file.mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return {
      text: "",
      status: "partial",
      warnings: [`${file.originalName}: XLSX 文本提取暂不支持`],
    };
  }

  throw new Error(`不支持的文档类型: ${file.mimeType || extension || "未知"}`);
}

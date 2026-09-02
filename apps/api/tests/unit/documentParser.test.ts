import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInputs } from "../../src/parsers/index.js";
import type { StoredFile } from "../../src/storage/types.js";

function storedFile(
  absolutePath: string,
  overrides: Partial<StoredFile> = {},
): StoredFile {
  return {
    storageKey: "input.bin",
    originalName: "input.bin",
    mimeType: "application/octet-stream",
    size: 0,
    absolutePath,
    ...overrides,
  };
}

async function createMinimalDocxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function createMinimalPdfBuffer(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length ${stream.length}>>stream
${stream}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
0000000212 00000 n 
0000000279 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
379
%%EOF`);
}

describe("parseInputs document and voice handling", () => {
  let tempDir: string;
  let pptxPath: string;
  let docxPath: string;
  let pdfPath: string;
  let xlsxPath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "parser-test-"));
    pptxPath = join(tempDir, "requirements.pptx");
    docxPath = join(tempDir, "requirements.docx");
    pdfPath = join(tempDir, "requirements.pdf");
    xlsxPath = join(tempDir, "requirements.xlsx");

    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld xmlns:a="urn:a" xmlns:p="urn:p"><a:t>首页需求</a:t><a:t>支持导出</a:t></p:sld>',
    );
    zip.file(
      "ppt/slides/slide2.xml",
      '<p:sld xmlns:a="urn:a" xmlns:p="urn:p"><a:t>审批流程</a:t></p:sld>',
    );
    await writeFile(pptxPath, await zip.generateAsync({ type: "nodebuffer" }));
    await writeFile(docxPath, await createMinimalDocxBuffer("文档需求内容"));
    await writeFile(pdfPath, createMinimalPdfBuffer("PDF requirement text"));
    await writeFile(xlsxPath, Buffer.from("not-a-real-xlsx"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts text from DOCX via mammoth fallback", async () => {
    const result = await parseInputs({
      files: [
        storedFile(docxPath, {
          storageKey: "requirements.docx",
          originalName: "requirements.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ],
    });

    expect(result.extractedText).toContain("文档需求内容");
    expect(result.fragments[0].parseStatus).toBe("ok");
    expect(result.warnings).toEqual([]);
  });

  it("extracts text from PDF via pdf-parse fallback", async () => {
    const result = await parseInputs({
      files: [
        storedFile(pdfPath, {
          storageKey: "requirements.pdf",
          originalName: "requirements.pdf",
          mimeType: "application/pdf",
        }),
      ],
    });

    expect(result.extractedText).toContain("PDF requirement text");
    expect(result.fragments[0].parseStatus).toBe("ok");
    expect(result.warnings).toEqual([]);
  });

  it("marks XLSX as partial with unsupported warning and no extracted text", async () => {
    const result = await parseInputs({
      files: [
        storedFile(xlsxPath, {
          storageKey: "requirements.xlsx",
          originalName: "requirements.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ],
    });

    expect(result.extractedText).toBe("");
    expect(result.fragments[0]).toMatchObject({
      sourceId: "requirements.xlsx",
      parseStatus: "partial",
      charCount: 0,
    });
    expect(result.fragments[0].parseStatus).not.toBe("ok");
    expect(result.warnings).toEqual([
      "requirements.xlsx: XLSX 文本提取暂不支持",
    ]);
  });

  it("extracts text from PPTX slide XML", async () => {
    const result = await parseInputs({
      files: [
        storedFile(pptxPath, {
          storageKey: "requirements.pptx",
          originalName: "requirements.pptx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }),
      ],
    });

    expect(result.extractedText).toContain("首页需求");
    expect(result.extractedText).toContain("支持导出");
    expect(result.extractedText).toContain("审批流程");
    expect(result.fragments[0].parseStatus).toBe("ok");
    expect(result.warnings).toEqual([]);
  });

  it("uses the injected transcriber without calling a live service", async () => {
    const audio = storedFile(join(tempDir, "voice.mp3"), {
      storageKey: "voice.mp3",
      originalName: "voice.mp3",
      mimeType: "audio/mpeg",
    });
    const transcribe = vi.fn(async (file: StoredFile) => {
      expect(file).toBe(audio);
      return "语音中的产品需求";
    });

    const result = await parseInputs({ files: [audio], transcribe });

    expect(transcribe).toHaveBeenCalledOnce();
    expect(result.extractedText).toBe("语音中的产品需求");
    expect(result.fragments[0].parseStatus).toBe("ok");
  });

  it("keeps successful fragments when another file fails", async () => {
    const validTextPath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "sample-requirements.txt",
    );
    const result = await parseInputs({
      files: [
        storedFile(validTextPath, {
          storageKey: "valid.txt",
          originalName: "valid.txt",
          mimeType: "text/plain",
        }),
        storedFile(join(tempDir, "unknown.bin"), {
          storageKey: "unknown.bin",
          originalName: "unknown.bin",
        }),
      ],
    });

    expect(result.extractedText).toContain("结构化 PRD");
    expect(result.fragments.map((fragment) => fragment.parseStatus)).toEqual([
      "ok",
      "failed",
    ]);
    expect(result.warnings).toHaveLength(1);
  });

  it("returns empty text and warnings when every file fails", async () => {
    const result = await parseInputs({
      files: [
        storedFile(join(tempDir, "unknown.bin"), {
          storageKey: "unknown.bin",
          originalName: "unknown.bin",
        }),
      ],
    });

    expect(result.extractedText).toBe("");
    expect(result.fragments[0]).toMatchObject({
      sourceId: "unknown.bin",
      parseStatus: "failed",
    });
    expect(result.warnings.join(" ")).toContain("unknown.bin");
    expect(result.warnings.join(" ")).toContain("所有输入均解析失败");
  });
});

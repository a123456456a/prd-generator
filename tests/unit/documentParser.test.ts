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

describe("parseInputs document and voice handling", () => {
  let tempDir: string;
  let pptxPath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "parser-test-"));
    pptxPath = join(tempDir, "requirements.pptx");

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
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
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

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseInputs, parseTextFile } from "../../src/parsers/index.js";
import type { StoredFile } from "../../src/storage/types.js";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "sample-requirements.txt",
);

function storedFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    storageKey: "sample-requirements.txt",
    originalName: "sample-requirements.txt",
    mimeType: "text/plain",
    size: 0,
    absolutePath: fixturePath,
    ...overrides,
  };
}

describe("parseTextFile", () => {
  it("decodes a UTF-8 text buffer", async () => {
    const buffer = await readFile(fixturePath);

    expect(parseTextFile(buffer)).toContain("生成结构化 PRD");
  });
});

describe("parseInputs", () => {
  it("merges a text description with a UTF-8 text file", async () => {
    const result = await parseInputs({
      files: [storedFile()],
      textDescription: "支持中文需求描述",
    });

    expect(result.extractedText).toContain("支持中文需求描述");
    expect(result.extractedText).toContain("生成结构化 PRD");
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments.every((fragment) => fragment.parseStatus === "ok")).toBe(
      true,
    );
    expect(result.fragments[0]).toMatchObject({
      sourceId: "text-description",
      excerpt: "支持中文需求描述",
      charCount: 8,
    });
    expect(result.fragments[1]).toMatchObject({
      sourceId: "sample-requirements.txt",
      fileName: "sample-requirements.txt",
      mimeType: "text/plain",
    });
    expect(result.warnings).toEqual([]);
  });
});

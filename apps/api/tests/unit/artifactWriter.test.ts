import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  createArtifactWriter,
  LocalArtifactWriter,
  NoopArtifactWriter,
} from "../../src/services/artifactWriter.js";
import type { TaskSnapshot } from "../../src/services/taskService.js";

function makeTask(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  const now = new Date().toISOString();
  return {
    threadId: "thread-abc-123",
    owner: { kind: "apiKey" },
    status: "completed",
    progress: 100,
    prdMarkdown: "",
    prototypeHtml: "",
    gaps: [],
    config: {},
    extractedText: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("LocalArtifactWriter", () => {
  let tempDir: string;
  let writer: LocalArtifactWriter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "artifact-writer-test-"));
    writer = new LocalArtifactWriter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes prd.json, prd.md and prototype.html under outputs/<threadId>/", async () => {
    const task = makeTask({
      prd: { title: "PRD" } as never,
      prdMarkdown: "# PRD",
      prototypeHtml: "<!doctype html><html></html>",
    });

    await writer.write(task);

    const dir = join(tempDir, task.threadId);
    expect(JSON.parse(await readFile(join(dir, "prd.json"), "utf-8"))).toEqual({
      title: "PRD",
    });
    expect(await readFile(join(dir, "prd.md"), "utf-8")).toBe("# PRD");
    expect(await readFile(join(dir, "prototype.html"), "utf-8")).toBe(
      "<!doctype html><html></html>",
    );
  });

  it("only writes the artifacts that are present", async () => {
    const task = makeTask({ prdMarkdown: "# 草稿" });

    await writer.write(task);

    const dir = join(tempDir, task.threadId);
    expect(await readFile(join(dir, "prd.md"), "utf-8")).toBe("# 草稿");
    expect(await pathExists(join(dir, "prd.json"))).toBe(false);
    expect(await pathExists(join(dir, "prototype.html"))).toBe(false);
  });

  it("overwrites previous content on subsequent writes (e.g. after regenerate)", async () => {
    const task = makeTask({ prdMarkdown: "# v1" });
    await writer.write(task);

    task.prdMarkdown = "# v2";
    await writer.write(task);

    const dir = join(tempDir, task.threadId);
    expect(await readFile(join(dir, "prd.md"), "utf-8")).toBe("# v2");
  });

  it("does nothing when the task has no artifacts yet", async () => {
    const task = makeTask();

    await writer.write(task);

    expect(await pathExists(join(tempDir, task.threadId))).toBe(false);
  });

  it("removes a task's output directory", async () => {
    const task = makeTask({ prdMarkdown: "# PRD" });
    await writer.write(task);
    const dir = join(tempDir, task.threadId);
    expect(await pathExists(dir)).toBe(true);

    await writer.remove(task.threadId);

    expect(await pathExists(dir)).toBe(false);
  });

  it("remove is a no-op for a non-existent thread", async () => {
    await expect(writer.remove("never-existed")).resolves.toBeUndefined();
  });

  it("rejects unsafe thread ids to prevent path traversal", async () => {
    await expect(
      writer.write(makeTask({ threadId: "../escape", prdMarkdown: "# x" })),
    ).rejects.toThrow(/Invalid threadId/);
    await expect(writer.remove("../escape")).rejects.toThrow(/Invalid threadId/);
  });
});

describe("createArtifactWriter", () => {
  it("returns a LocalArtifactWriter instance", () => {
    const writer = createArtifactWriter(join(tmpdir(), "factory-outputs-test"));
    expect(writer).toBeInstanceOf(LocalArtifactWriter);
  });
});

describe("NoopArtifactWriter", () => {
  it("resolves without touching disk", async () => {
    const writer = new NoopArtifactWriter();
    await expect(
      writer.write(makeTask({ prdMarkdown: "# PRD" })),
    ).resolves.toBeUndefined();
    await expect(writer.remove("any-thread")).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { LocalStorage } from "../../src/storage/localStorage.js";
import { createStorage } from "../../src/storage/index.js";
import { AppError } from "../../src/utils/errors.js";

describe("LocalStorage", () => {
  let tempDir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "storage-test-"));
    storage = new LocalStorage(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves and reads back the same buffer content", async () => {
    const buffer = Buffer.from("hello world");
    const stored = await storage.save({
      buffer,
      originalName: "test.txt",
      mimeType: "text/plain",
    });

    expect(stored.storageKey).toMatch(/\.txt$/);
    expect(stored.originalName).toBe("test.txt");
    expect(stored.mimeType).toBe("text/plain");
    expect(stored.size).toBe(buffer.length);
    expect(stored.absolutePath).toContain(tempDir);

    const read = await storage.read(stored.storageKey);
    expect(read.equals(buffer)).toBe(true);
  });

  it("remove with invalid key does not throw uncaught exception", async () => {
    await expect(storage.remove("nonexistent-key")).resolves.toBeUndefined();
  });

  it("rejects path traversal on read", async () => {
    await expect(storage.read("../outside.txt")).rejects.toThrow(AppError);
    await expect(storage.read("foo/../bar.txt")).rejects.toThrow(AppError);
  });

  it("rejects path traversal on remove", async () => {
    await expect(storage.remove("../outside.txt")).rejects.toThrow(AppError);
    await expect(storage.remove("foo/../bar.txt")).rejects.toThrow(AppError);
  });
});

describe("createStorage", () => {
  it("returns a LocalStorage instance", () => {
    const storage = createStorage({ uploadDir: join(tmpdir(), "factory-test") });
    expect(storage).toBeInstanceOf(LocalStorage);
  });
});

import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { join, extname, resolve, sep } from "path";
import { v4 as uuidv4 } from "uuid";
import { loadConfig } from "../config.js";
import { AppError } from "../utils/errors.js";
import type { Storage, StoredFile } from "./types.js";

function validateStorageKey(storageKey: string): void {
  if (
    storageKey.includes("..") ||
    storageKey.includes("/") ||
    storageKey.includes("\\")
  ) {
    throw new AppError("INVALID_STORAGE_KEY", "Invalid storage key", 400);
  }
}

function resolveSafePath(rootDir: string, storageKey: string): string {
  validateStorageKey(storageKey);
  const absolutePath = resolve(rootDir, storageKey);
  const resolvedRoot = resolve(rootDir);
  const rootPrefix = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : resolvedRoot + sep;
  if (!absolutePath.startsWith(rootPrefix)) {
    throw new AppError("INVALID_STORAGE_KEY", "Invalid storage key", 400);
  }
  return absolutePath;
}

export class LocalStorage implements Storage {
  constructor(private readonly rootDir: string) {}

  async save(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  }): Promise<StoredFile> {
    await mkdir(this.rootDir, { recursive: true });
    const ext = extname(input.originalName);
    const storageKey = `${uuidv4()}${ext}`;
    const absolutePath = join(this.rootDir, storageKey);
    await writeFile(absolutePath, input.buffer);
    return {
      storageKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.buffer.length,
      absolutePath: resolve(absolutePath),
    };
  }

  async read(storageKey: string): Promise<Buffer> {
    const absolutePath = resolveSafePath(this.rootDir, storageKey);
    try {
      return await readFile(absolutePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError("FILE_NOT_FOUND", "File not found", 404);
      }
      throw err;
    }
  }

  async remove(storageKey: string): Promise<void> {
    const absolutePath = resolveSafePath(this.rootDir, storageKey);
    try {
      await unlink(absolutePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }
  }
}

export function createLocalStorage(rootDir?: string): LocalStorage {
  return new LocalStorage(rootDir ?? loadConfig().uploadDir);
}

import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { LocalStorage } from "./localStorage.js";

export type { StoredFile, Storage } from "./types.js";
export { LocalStorage } from "./localStorage.js";

export function createStorage(config?: Pick<AppConfig, "uploadDir">): LocalStorage {
  // Future: return S3Storage when config.storageType === "s3"
  const uploadDir = config?.uploadDir ?? loadConfig().uploadDir;
  return new LocalStorage(uploadDir);
}

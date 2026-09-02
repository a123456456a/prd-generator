import type { AppConfig } from "../config.js";
import type { UserStore } from "./types.js";

export async function seedAdmin(
  users: UserStore,
  config: AppConfig,
): Promise<void> {
  await users.ensureAdmin(config.adminUser, config.adminPassword);
}

import { randomUUID } from "node:crypto";
import { AppError } from "../utils/errors.js";
import { hashPassword } from "./password.js";
import type { CreateUserInput, UserRecord, UserStore } from "./types.js";

export class MemoryUserStore implements UserStore {
  private usersById = new Map<string, UserRecord>();
  private usersByUsername = new Map<string, UserRecord>();

  async findByUsername(username: string): Promise<UserRecord | null> {
    return this.usersByUsername.get(username) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.usersById.get(id) ?? null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    if (this.usersByUsername.has(input.username)) {
      throw new AppError("USER_EXISTS", "User already exists", 409);
    }
    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      role: input.role,
      status: input.status,
      email: input.email,
      createdAt: now,
      updatedAt: now,
    };
    this.usersById.set(user.id, user);
    this.usersByUsername.set(user.username, user);
    return user;
  }

  async ensureAdmin(username: string, password: string): Promise<UserRecord> {
    const existing = await this.findByUsername(username);
    if (existing) return existing;
    return this.create({
      username,
      passwordHash: await hashPassword(password),
      role: "admin",
      status: "active",
      email: null,
    });
  }
}

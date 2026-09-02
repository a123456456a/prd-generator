export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  email: string | null;
}

export interface UserStore {
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  ensureAdmin(username: string, password: string): Promise<UserRecord>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionStore {
  create(userId: string, ttlMs: number): Promise<SessionRecord>;
  get(id: string): Promise<SessionRecord | null>;
  delete(id: string): Promise<void>;
}

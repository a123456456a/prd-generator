import { describe, expect, it } from "vitest";
import { MemorySessionStore } from "../../src/auth/memorySessionStore.js";
import { MemoryUserStore } from "../../src/auth/memoryUserStore.js";
import { hashPassword } from "../../src/auth/password.js";
import { AppError } from "../../src/utils/errors.js";

describe("MemoryUserStore", () => {
  it("ensureAdmin is idempotent", async () => {
    const store = new MemoryUserStore();
    const first = await store.ensureAdmin("admin", "secret");
    const second = await store.ensureAdmin("admin", "secret");
    expect(first.id).toBe(second.id);
  });

  it("throws USER_EXISTS on duplicate create", async () => {
    const store = new MemoryUserStore();
    const hash = await hashPassword("pass");
    await store.create({
      username: "alice",
      passwordHash: hash,
      role: "user",
      status: "active",
      email: null,
    });
    await expect(
      store.create({
        username: "alice",
        passwordHash: hash,
        role: "user",
        status: "active",
        email: null,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof AppError &&
        err.code === "USER_EXISTS" &&
        err.statusCode === 409,
    );
  });

  it("finds disabled users", async () => {
    const store = new MemoryUserStore();
    const hash = await hashPassword("pass");
    const user = await store.create({
      username: "disabled",
      passwordHash: hash,
      role: "user",
      status: "disabled",
      email: null,
    });
    const found = await store.findByUsername("disabled");
    expect(found).not.toBeNull();
    expect(found!.status).toBe("disabled");
    expect(found!.id).toBe(user.id);
  });
});

describe("MemorySessionStore", () => {
  it("creates session with random id and ttl", async () => {
    const store = new MemorySessionStore();
    const session = await store.create("user-1", 60_000);
    expect(session.id).toBeTruthy();
    expect(session.userId).toBe("user-1");
    expect(session.expiresAt.getTime()).toBeGreaterThan(
      session.createdAt.getTime(),
    );
  });

  it("get returns session and delete removes it", async () => {
    const store = new MemorySessionStore();
    const session = await store.create("user-1", 60_000);
    expect(await store.get(session.id)).not.toBeNull();
    await store.delete(session.id);
    expect(await store.get(session.id)).toBeNull();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../../src/auth/password.js";
import {
  buildAuthTestApp,
  defaultAuthTestConfig,
  type AuthTestApp,
} from "../helpers/buildAuthTestApp.js";

describe("auth routes", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function setup(
    config = defaultAuthTestConfig,
    prepare?: (deps: AuthTestApp) => Promise<void>,
  ) {
    const testApp = await buildAuthTestApp(config);
    if (prepare) {
      await prepare(testApp);
    }
    apps.push(testApp.app);
    return testApp;
  }

  it("logs in with seed admin and returns me", async () => {
    const { app: instance } = await setup();
    const login = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin-change-me" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({
      user: { id: expect.any(String), username: "admin", role: "admin" },
    });
    const cookie = login.cookies.find((c) => c.name === "sid");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe("/");

    const me = await instance.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { sid: cookie!.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe("admin");
  });

  it("rejects bad password with AUTH_INVALID", async () => {
    const { app: instance } = await setup();
    const res = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "nope" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "AUTH_INVALID",
      message: "Invalid credentials",
    });
  });

  it("rejects unknown username with AUTH_INVALID", async () => {
    const { app: instance } = await setup();
    const res = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nobody", password: "admin-change-me" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_INVALID");
  });

  it("rejects disabled users with AUTH_INVALID", async () => {
    const { app: instance } = await setup(defaultAuthTestConfig, async ({ users }) => {
      await users.create({
        username: "disabled-user",
        passwordHash: await hashPassword("secret-pass"),
        role: "user",
        status: "disabled",
        email: null,
      });
    });
    const login = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "disabled-user", password: "secret-pass" },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json().code).toBe("AUTH_INVALID");
  });

  it("logout clears session and me returns 401", async () => {
    const { app: instance } = await setup();
    const login = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin-change-me" },
    });
    const sid = login.cookies.find((c) => c.name === "sid")!.value;

    const logout = await instance.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { sid },
    });
    expect([200, 204]).toContain(logout.statusCode);

    const me = await instance.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { sid },
    });
    expect(me.statusCode).toBe(401);
  });

  it("logout succeeds without a session cookie", async () => {
    const { app: instance } = await setup();
    const logout = await instance.inject({
      method: "POST",
      url: "/api/auth/logout",
    });
    expect([200, 204]).toContain(logout.statusCode);
  });

  it("returns 501 for register", async () => {
    const { app: instance } = await setup();
    const res = await instance.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "new", password: "pass" },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ code: "NOT_IMPLEMENTED" });
  });
});

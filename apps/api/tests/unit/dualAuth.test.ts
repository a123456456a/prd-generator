import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../../src/auth/password.js";
import {
  buildDualAuthTestApp,
  defaultAuthTestConfig,
} from "../helpers/buildAuthTestApp.js";

describe("dual auth middleware", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function setup(
    config = defaultAuthTestConfig,
    prepare?: Parameters<typeof buildDualAuthTestApp>[1],
  ) {
    const testApp = await buildDualAuthTestApp(config, prepare);
    apps.push(testApp.app);
    return testApp;
  }

  it("allows bearer api key", async () => {
    const { app, config } = await setup();
    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { authorization: `Bearer ${config.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().principal).toEqual({ kind: "apiKey" });
  });

  it("allows session cookie after login", async () => {
    const { app } = await setup();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin-change-me" },
    });
    expect(login.statusCode).toBe(200);
    const sid = login.cookies.find((c) => c.name === "sid")!.value;

    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      cookies: { sid },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().principal).toMatchObject({
      kind: "user",
      username: "admin",
      role: "admin",
    });
    expect(res.json().principal.userId).toEqual(expect.any(String));
  });

  it("rejects anonymous requests with AUTH_REQUIRED", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/protected" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required",
    });
  });

  it("rejects inactive user sessions with AUTH_REQUIRED", async () => {
    const { app, users, sessions } = await setup(defaultAuthTestConfig, async (deps) => {
      await deps.users.create({
        username: "inactive-user",
        passwordHash: await hashPassword("secret-pass"),
        role: "user",
        status: "disabled",
        email: null,
      });
    });

    const disabledUser = await users.findByUsername("inactive-user");
    expect(disabledUser).not.toBeNull();
    const session = await sessions.create(disabledUser!.id, 60_000);

    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      cookies: { sid: session.id },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_REQUIRED");
  });

  it("rejects expired sessions with AUTH_REQUIRED", async () => {
    const { app, users, sessions } = await setup();
    const admin = await users.findByUsername("admin");
    expect(admin).not.toBeNull();
    const session = await sessions.create(admin!.id, -1);

    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      cookies: { sid: session.id },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_REQUIRED");
  });

  it("skips auth for public login route", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_INVALID");
  });
});

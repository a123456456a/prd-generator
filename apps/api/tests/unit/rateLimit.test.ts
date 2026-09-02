import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createRateLimiter } from "../../src/middleware/rateLimit.js";

describe("createRateLimiter", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function appWithLimiter(max: number, now?: () => number) {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook(
      "onRequest",
      createRateLimiter({
        windowMs: 60_000,
        max,
        keyFn: () => "test-key",
        now,
      }),
    );
    app.get("/test", async () => ({ ok: true }));
    return app;
  }

  it("returns 429 RATE_LIMITED when the same key exceeds max", async () => {
    const app = await appWithLimiter(3);

    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({ method: "GET", url: "/test" });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({ method: "GET", url: "/test" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
    });
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("tracks keys independently", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook(
      "onRequest",
      createRateLimiter({
        windowMs: 60_000,
        max: 1,
        keyFn: (request) => request.headers["x-test-key"] ?? "anonymous",
      }),
    );
    app.get("/test", async () => ({ ok: true }));

    const first = await app.inject({
      method: "GET",
      url: "/test",
      headers: { "x-test-key": "alpha" },
    });
    const second = await app.inject({
      method: "GET",
      url: "/test",
      headers: { "x-test-key": "beta" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it("enforces a hard window before allowing more requests", async () => {
    let currentTime = 0;
    const app = await appWithLimiter(5, () => currentTime);

    for (let index = 0; index < 5; index += 1) {
      expect(
        (await app.inject({ method: "GET", url: "/test" })).statusCode,
      ).toBe(200);
    }
    expect(
      (await app.inject({ method: "GET", url: "/test" })).statusCode,
    ).toBe(429);

    currentTime = 59_999;
    expect(
      (await app.inject({ method: "GET", url: "/test" })).statusCode,
    ).toBe(429);

    currentTime = 60_000;
    expect(
      (await app.inject({ method: "GET", url: "/test" })).statusCode,
    ).toBe(200);
  });
});

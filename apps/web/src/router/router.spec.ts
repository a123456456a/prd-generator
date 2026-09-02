import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import { createAppRouter } from "./index";

describe("authentication route guard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("redirects an unauthenticated workbench visit to login", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "AUTH_INVALID", message: "Invalid credentials" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const router = createAppRouter(createMemoryHistory());

    await router.push("/");
    await router.isReady();

    expect(router.currentRoute.value.name).toBe("login");
    expect(router.currentRoute.value.query.redirect).toBe("/");
  });
});

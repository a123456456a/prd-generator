import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import { apiFetch, setUnauthorizedHandler } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import { createAppRouter, installUnauthorizedHandler } from "./index";

describe("authentication route guard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    setUnauthorizedHandler(null);
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

  it("redirects an authenticated workbench session after an API 401", async () => {
    const auth = useAuthStore();
    auth.user = { id: "user-1", username: "admin", role: "admin" };
    const router = createAppRouter(createMemoryHistory());
    installUnauthorizedHandler(router);
    await router.push("/");
    await router.isReady();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "AUTH_REQUIRED", message: "Expired" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(apiFetch("/api/thread/thread-1")).rejects.toMatchObject({
      status: 401,
    });
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("login");
    });

    expect(auth.user).toBeNull();
    expect(router.currentRoute.value.query.redirect).toBe("/");
  });
});

import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError, apiFetch } from "@/api/client";

export type AuthUser = {
  id: string;
  username: string;
  role: "admin" | "user";
};

type UserResponse = {
  user: AuthUser;
};

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>(null);
  let loadMeRequest: Promise<void> | null = null;

  function clearUser() {
    user.value = null;
  }

  async function loadMe() {
    if (loadMeRequest) return loadMeRequest;

    loadMeRequest = (async () => {
      try {
        const response = await apiFetch("/api/auth/me");
        const body = (await response.json()) as UserResponse;
        user.value = body.user;
      } catch (error) {
        clearUser();
        if (!(error instanceof ApiError && error.status === 401)) {
          throw error;
        }
      } finally {
        loadMeRequest = null;
      }
    })();

    return loadMeRequest;
  }

  async function login(username: string, password: string) {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = (await response.json()) as UserResponse;
    user.value = body.user;
  }

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      clearUser();
    }
  }

  return { user, clearUser, loadMe, login, logout };
});

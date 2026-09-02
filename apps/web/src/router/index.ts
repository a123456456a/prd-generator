import {
  createRouter,
  createWebHistory,
  type Router,
  type RouterHistory,
} from "vue-router";
import { setUnauthorizedHandler } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import LoginView from "@/views/LoginView.vue";
import WorkbenchView from "@/views/WorkbenchView.vue";

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      {
        path: "/login",
        name: "login",
        component: LoginView,
      },
      {
        path: "/",
        name: "workbench",
        component: WorkbenchView,
        meta: { requiresAuth: true },
      },
      {
        path: "/:pathMatch(.*)*",
        redirect: "/",
      },
    ],
  });

  router.beforeEach(async (to) => {
    if (!to.meta.requiresAuth) return true;

    const auth = useAuthStore();
    if (!auth.user) {
      try {
        await auth.loadMe();
      } catch {
        // A transient API failure is handled as an unauthenticated visit here.
      }
    }

    if (!auth.user) {
      return {
        name: "login",
        query: { redirect: to.fullPath },
      };
    }

    return true;
  });

  return router;
}

export function installUnauthorizedHandler(router: Router): void {
  setUnauthorizedHandler(() => {
    useAuthStore().clearUser();
    if (router.currentRoute.value.name === "login") return;
    const redirect = router.currentRoute.value.fullPath;
    void router.replace({
      name: "login",
      query: { redirect },
    });
  });
}

export const router = createAppRouter();

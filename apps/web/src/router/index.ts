import {
  createRouter,
  createWebHistory,
  type RouterHistory,
} from "vue-router";
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

export const router = createAppRouter();

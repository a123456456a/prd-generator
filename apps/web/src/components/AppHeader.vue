<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import LocaleSwitch from "./LocaleSwitch.vue";

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();
const isLoggedIn = computed(() => auth.user !== null);

async function logout() {
  await auth.logout();
  await router.replace({ name: "login" });
}
</script>

<template>
  <header class="border-b border-slate-200 bg-white">
    <div
      class="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"
    >
      <div class="min-w-0">
        <p class="truncate text-lg font-semibold text-slate-900">
          {{ t("app.title") }}
        </p>
        <p v-if="isLoggedIn" class="truncate text-xs text-slate-500">
          {{ auth.user?.username }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <LocaleSwitch />
        <button
          v-if="isLoggedIn"
          type="button"
          class="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          @click="logout"
        >
          {{ t("workbench.logout") }}
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import AppSidebar from "./AppSidebar.vue";
import LocaleSwitch from "./LocaleSwitch.vue";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { t, te } = useI18n();

const collapsed = ref(false);
const mobileOpen = ref(false);

onMounted(() => {
  collapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
});

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed.value));
}

const pageTitle = computed(() => {
  const key = route.meta.titleKey as string | undefined;
  return key && te(key) ? t(key) : t("app.title");
});

async function logout() {
  await auth.logout();
  await router.replace({ name: "login" });
}
</script>

<template>
  <div class="flex min-h-screen bg-canvas text-ink">
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/60 lg:hidden"
      aria-hidden="true"
      @click="mobileOpen = false"
    />

    <AppSidebar
      :collapsed="collapsed"
      :mobile-open="mobileOpen"
      @toggle-collapsed="toggleCollapsed"
      @close="mobileOpen = false"
      @navigate="mobileOpen = false"
    />

    <div class="flex min-h-screen flex-1 flex-col">
      <header
        class="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:px-6"
      >
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="-ml-1.5 rounded-lg p-1.5 text-ink-muted transition hover:bg-panel-hover hover:text-ink lg:hidden"
            :aria-label="t('nav.openMenu')"
            @click="mobileOpen = true"
          >
            <svg viewBox="0 0 24 24" fill="none" class="size-5" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
          <p class="truncate text-sm font-medium text-ink-muted">{{ pageTitle }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <LocaleSwitch />
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-panel-hover hover:text-ink"
            @click="logout"
          >
            {{ t("workbench.logout") }}
          </button>
        </div>
      </header>

      <main class="flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import NavIcon from "./NavIcon.vue";

const props = defineProps<{
  collapsed: boolean;
  mobileOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-collapsed"): void;
  (e: "close"): void;
  (e: "navigate"): void;
}>();

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const { user } = storeToRefs(auth);

type NavItem = {
  name: string;
  labelKey: string;
  icon: "grid" | "key";
  soon?: boolean;
};

const navItems: NavItem[] = [
  { name: "workbench", labelKey: "nav.workbench", icon: "grid" },
  { name: "providers", labelKey: "nav.providers", icon: "key", soon: true },
];

const initials = computed(() => {
  const name = user.value?.username ?? "";
  return name.slice(0, 2).toUpperCase() || "?";
});

function onNavigate() {
  emit("navigate");
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-panel transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0"
    :class="[
      props.mobileOpen ? 'translate-x-0' : '-translate-x-full',
      props.collapsed ? 'lg:w-16' : 'lg:w-64',
    ]"
  >
    <div class="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
      <div class="flex min-w-0 items-center gap-2">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white"
          aria-hidden="true"
        >
          P
        </span>
        <span
          class="truncate text-sm font-semibold text-ink"
          :class="{ 'lg:hidden': props.collapsed }"
        >
          {{ t("app.title") }}
        </span>
      </div>
      <button
        type="button"
        class="rounded-lg p-1.5 text-ink-faint transition hover:bg-panel-hover hover:text-ink lg:hidden"
        :aria-label="t('nav.closeMenu')"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" fill="none" class="size-5">
          <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <nav class="flex-1 space-y-1 overflow-y-auto px-2 py-2" :aria-label="t('nav.label')">
      <template v-for="item in navItems" :key="item.name">
        <RouterLink
          v-if="!item.soon"
          :to="{ name: item.name }"
          class="group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition"
          :class="[
            route.name === item.name
              ? 'bg-accent-soft text-ink'
              : 'text-ink-muted hover:bg-panel-hover hover:text-ink',
            props.collapsed && 'lg:justify-center',
          ]"
          @click="onNavigate"
        >
          <NavIcon :name="item.icon" :active="route.name === item.name" />
          <span class="truncate" :class="{ 'lg:hidden': props.collapsed }">
            {{ t(item.labelKey) }}
          </span>
        </RouterLink>
        <div
          v-else
          class="flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-faint"
          :class="props.collapsed && 'lg:justify-center'"
          :title="t(item.labelKey)"
        >
          <NavIcon :name="item.icon" :active="false" />
          <span class="truncate" :class="{ 'lg:hidden': props.collapsed }">
            {{ t(item.labelKey) }}
          </span>
          <span
            class="ml-auto shrink-0 rounded-full bg-panel-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint"
            :class="{ 'lg:hidden': props.collapsed }"
          >
            {{ t("nav.soon") }}
          </span>
        </div>
      </template>
    </nav>

    <div class="border-t border-line p-2">
      <button
        type="button"
        class="hidden w-full items-center justify-center rounded-lg p-2 text-ink-faint transition hover:bg-panel-hover hover:text-ink lg:flex"
        :aria-label="t(collapsed ? 'nav.expand' : 'nav.collapse')"
        @click="emit('toggle-collapsed')"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          class="size-[18px] transition-transform"
          :class="{ 'rotate-180': collapsed }"
        >
          <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div
        class="mt-1 flex items-center gap-2 rounded-lg px-1.5 py-2"
        :class="{ 'lg:justify-center': collapsed }"
      >
        <span
          class="flex size-7 shrink-0 items-center justify-center rounded-full bg-panel-muted text-xs font-semibold text-ink-muted"
          aria-hidden="true"
        >
          {{ initials }}
        </span>
        <span class="min-w-0 truncate text-sm text-ink-muted" :class="{ 'lg:hidden': collapsed }">
          {{ user?.username }}
        </span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { UiLocale } from "@/i18n";

const { locale, t } = useI18n({ useScope: "global" });

function switchLocale() {
  const next: UiLocale = locale.value === "zh-CN" ? "en" : "zh-CN";
  locale.value = next;
  localStorage.setItem("ui_locale", next);
}
</script>

<template>
  <button
    type="button"
    class="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    :aria-label="t('locale.label')"
    @click="switchLocale"
  >
    {{ t("locale.option") }}
  </button>
</template>

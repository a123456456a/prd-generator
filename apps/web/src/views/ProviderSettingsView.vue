<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const presetProviders = [
  { key: "openai", label: "OpenAI" },
  { key: "deepseek", label: "DeepSeek" },
  { key: "zhipu", label: "智谱 GLM" },
  { key: "alibaba", label: "阿里云百炼" },
  { key: "anthropic", label: "Claude" },
  { key: "custom", label: "Custom" },
];
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-semibold uppercase tracking-wider text-accent">
          {{ t("providers.eyebrow") }}
        </p>
        <h1 class="mt-1 text-2xl font-bold text-ink sm:text-3xl">
          {{ t("providers.heading") }}
        </h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          {{ t("providers.description") }}
        </p>
      </div>
      <button
        type="button"
        disabled
        class="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-panel-muted px-4 py-2.5 text-sm font-semibold text-ink-faint"
      >
        <svg viewBox="0 0 24 24" fill="none" class="size-4" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        {{ t("providers.addButton") }}
      </button>
    </header>

    <section class="rounded-2xl border border-line bg-panel p-6 sm:p-8">
      <div class="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span
          class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" fill="none" class="size-6">
            <circle cx="8" cy="15.5" r="4" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M11 12.5L18.5 5M18.5 5v3.5M18.5 5H15"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <div class="min-w-0">
          <p class="flex items-center gap-2 text-base font-semibold text-ink">
            {{ t("providers.comingSoon.title") }}
            <span
              class="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn"
            >
              {{ t("nav.soon") }}
            </span>
          </p>
          <p class="mt-1 text-sm leading-6 text-ink-muted">
            {{ t("providers.comingSoon.description") }}
          </p>
        </div>
      </div>

      <div class="mt-6 flex flex-wrap gap-2">
        <span
          v-for="provider in presetProviders"
          :key="provider.key"
          class="rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-ink-muted"
        >
          {{ provider.label }}
        </span>
      </div>
    </section>

    <section class="pointer-events-none select-none rounded-2xl border border-line bg-panel p-4 opacity-50 sm:p-6">
      <p class="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {{ t("providers.preview.label") }}
      </p>
      <div class="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-panel-muted p-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <p class="flex items-center gap-2 text-sm font-semibold text-ink">
            DeepSeek
            <span class="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              {{ t("providers.preview.default") }}
            </span>
          </p>
          <p class="mt-1 truncate text-xs text-ink-faint">https://api.deepseek.com · deepseek-chat</p>
        </div>
        <p class="text-sm font-mono text-ink-muted">sk-ab********wxyz</p>
      </div>
    </section>
  </div>
</template>

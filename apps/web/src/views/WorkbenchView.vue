<script setup lang="ts">
import { useI18n } from "vue-i18n";
import AppHeader from "@/components/AppHeader.vue";

const { t } = useI18n();
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <AppHeader />
    <main class="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <section
        class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"
      >
        <p class="text-sm font-semibold uppercase tracking-wider text-indigo-600">
          {{ t("workbench.title") }}
        </p>
        <h1 class="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">
          {{ t("workbench.coming") }}
        </h1>
        <p class="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-500 sm:text-base">
          {{ t("workbench.description") }}
        </p>
      </section>
    </main>
  </div>
</template>

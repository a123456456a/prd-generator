<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/api/client";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const username = ref("");
const password = ref("");
const errorCode = ref("");
const submitting = ref(false);

async function submit() {
  errorCode.value = "";
  submitting.value = true;

  try {
    await auth.login(username.value, password.value);
    const requestedRedirect =
      typeof route.query.redirect === "string" ? route.query.redirect : "/";
    const redirect =
      requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")
        ? requestedRedirect
        : "/";
    await router.replace(redirect);
  } catch (error) {
    errorCode.value = error instanceof ApiError ? error.code : "UNKNOWN";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main
    class="flex min-h-screen flex-col bg-slate-50 px-4 py-6 sm:justify-center sm:py-12"
  >
    <div class="mx-auto flex w-full max-w-md justify-end">
      <LocaleSwitch />
    </div>

    <section
      class="mx-auto mt-6 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div
        class="mb-7 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white"
        aria-hidden="true"
      >
        P
      </div>
      <p class="text-sm font-semibold text-indigo-600">{{ t("app.title") }}</p>
      <h1 class="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        {{ t("login.title") }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        {{ t("login.subtitle") }}
      </p>

      <form class="mt-8 space-y-5" @submit.prevent="submit">
        <div>
          <label for="username" class="text-sm font-medium text-slate-700">
            {{ t("login.username") }}
          </label>
          <input
            id="username"
            v-model="username"
            name="username"
            type="text"
            autocomplete="username"
            required
            autofocus
            class="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-3 focus:ring-indigo-100"
            :placeholder="t('login.usernamePlaceholder')"
          />
        </div>

        <div>
          <label for="password" class="text-sm font-medium text-slate-700">
            {{ t("login.password") }}
          </label>
          <input
            id="password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            class="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-3 focus:ring-indigo-100"
            :placeholder="t('login.passwordPlaceholder')"
          />
        </div>

        <p
          v-if="errorCode"
          role="alert"
          class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {{ t(`errors.${errorCode}`, t("errors.UNKNOWN")) }}
        </p>

        <button
          type="submit"
          :disabled="submitting"
          class="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ submitting ? t("login.submitting") : t("login.submit") }}
        </button>
      </form>
    </section>
  </main>
</template>

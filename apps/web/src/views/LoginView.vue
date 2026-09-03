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
    class="flex min-h-screen flex-col bg-canvas px-4 py-6 sm:justify-center sm:py-12"
  >
    <div class="mx-auto flex w-full max-w-md justify-end">
      <LocaleSwitch />
    </div>

    <section
      class="mx-auto mt-6 w-full max-w-md rounded-2xl border border-line bg-panel p-6 sm:p-8"
    >
      <div
        class="mb-7 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white"
        aria-hidden="true"
      >
        P
      </div>
      <p class="text-sm font-semibold text-accent">{{ t("app.title") }}</p>
      <h1 class="mt-2 text-2xl font-bold tracking-tight text-ink">
        {{ t("login.title") }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-ink-muted">
        {{ t("login.subtitle") }}
      </p>

      <form class="mt-8 space-y-5" @submit.prevent="submit">
        <div>
          <label for="username" class="text-sm font-medium text-ink-muted">
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
            class="mt-2 block w-full rounded-xl border border-line-strong bg-panel-muted px-3.5 py-3 text-base text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:ring-3 focus:ring-accent-soft"
            :placeholder="t('login.usernamePlaceholder')"
          />
        </div>

        <div>
          <label for="password" class="text-sm font-medium text-ink-muted">
            {{ t("login.password") }}
          </label>
          <input
            id="password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            class="mt-2 block w-full rounded-xl border border-line-strong bg-panel-muted px-3.5 py-3 text-base text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:ring-3 focus:ring-accent-soft"
            :placeholder="t('login.passwordPlaceholder')"
          />
        </div>

        <p
          v-if="errorCode"
          role="alert"
          class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {{ t(`errors.${errorCode}`, t("errors.UNKNOWN")) }}
        </p>

        <button
          type="submit"
          :disabled="submitting"
          class="flex w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white transition hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ submitting ? t("login.submitting") : t("login.submit") }}
        </button>
      </form>
    </section>
  </main>
</template>

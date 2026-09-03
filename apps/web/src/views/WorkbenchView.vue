<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import {
  useJobStore,
  type ReviewAction,
} from "@/stores/job";

const { t, te } = useI18n();
const job = useJobStore();
const {
  threadId,
  phase,
  progress,
  events,
  prd,
  prdMarkdown,
  prototypeHtml,
  uiError,
  outputLanguage,
  busy,
} = storeToRefs(job);

const selectedFiles = ref<File[]>([]);
const textDescription = ref("");
const enableHumanReview = ref(true);
const skipPrototype = ref(false);
const activePrdTab = ref<"markdown" | "json">("markdown");
const reviewAction = ref<ReviewAction>("approve");
const prdPatch = ref("");
const feedback = ref("");
const formError = ref("");
const reviewError = ref("");

const hasInput = computed(
  () => selectedFiles.value.length > 0 || Boolean(textDescription.value.trim()),
);
const awaitingReview = computed(() => phase.value === "awaiting_review");
const statusLabel = computed(() => {
  const key = `workbench.status.${phase.value}`;
  return te(key) ? t(key) : phase.value;
});
const displayErrorMessage = computed(() => {
  if (!uiError.value) return "";
  const key = `errors.${uiError.value.code}`;
  return te(key) ? t(key) : t("errors.UNKNOWN");
});

const displayErrorDetails = computed(() => uiError.value?.message?.trim() ?? "");

function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedFiles.value = Array.from(input.files ?? []);
}

function formatEventData(data: unknown) {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function startGenerate() {
  formError.value = "";
  if (!hasInput.value) {
    formError.value = t("workbench.inputRequired");
    return;
  }
  try {
    await job.startGenerate({
      files: selectedFiles.value,
      textDescription: textDescription.value,
      enableHumanReview: enableHumanReview.value,
      skipPrototype: skipPrototype.value,
      language: outputLanguage.value,
    });
  } catch {
    // The store exposes a translated error payload to the view.
  }
}

async function submitReview() {
  reviewError.value = "";
  let patch: Record<string, unknown> | undefined;

  if (reviewAction.value === "edit") {
    try {
      const parsed = JSON.parse(prdPatch.value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error();
      }
      patch = parsed as Record<string, unknown>;
      if (Object.keys(patch).length === 0) throw new Error();
    } catch {
      reviewError.value = t("workbench.review.invalidPatch");
      return;
    }
  }
  if (reviewAction.value === "reject" && !feedback.value.trim()) {
    reviewError.value = t("workbench.review.feedbackRequired");
    return;
  }

  try {
    await job.resume(reviewAction.value, {
      prdPatch: patch,
      feedback: feedback.value.trim(),
    });
  } catch {
    // The store exposes a translated error payload to the view.
  }
}

onMounted(() => {
  void job.restore();
});
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
    <header>
      <p class="text-sm font-semibold uppercase tracking-wider text-accent">
        {{ t("workbench.title") }}
      </p>
      <h1 class="mt-1 text-2xl font-bold text-ink sm:text-3xl">
        {{ t("workbench.heading") }}
      </h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        {{ t("workbench.description") }}
      </p>
    </header>

    <div
      v-if="uiError"
      role="alert"
      class="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      {{ displayErrorMessage }}
      <details v-if="displayErrorDetails" class="mt-2">
        <summary class="cursor-pointer font-medium text-danger">
          {{ t("errors.details") }}
        </summary>
        <p class="mt-1 whitespace-pre-wrap break-words text-danger/90">
          {{ displayErrorDetails }}
        </p>
      </details>
    </div>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <section class="rounded-2xl border border-line bg-panel p-4 sm:p-6">
        <h2 class="text-lg font-semibold text-ink">
          {{ t("workbench.input.title") }}
        </h2>
        <form class="mt-5 space-y-5" @submit.prevent="startGenerate">
          <label class="block">
            <span class="text-sm font-medium text-ink-muted">
              {{ t("workbench.input.files") }}
            </span>
            <input
              class="mt-2 block w-full rounded-xl border border-line-strong bg-panel-muted px-3 py-2 text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:font-medium file:text-accent"
              type="file"
              multiple
              @change="selectFiles"
            />
            <span class="mt-2 block text-xs text-ink-faint">
              {{
                selectedFiles.length
                  ? t("workbench.input.selectedFiles", {
                      count: selectedFiles.length,
                    })
                  : t("workbench.input.fileHint")
              }}
            </span>
          </label>

          <label class="block">
            <span class="text-sm font-medium text-ink-muted">
              {{ t("workbench.input.description") }}
            </span>
            <textarea
              v-model="textDescription"
              class="mt-2 min-h-32 w-full rounded-xl border border-line-strong bg-panel-muted px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              :placeholder="t('workbench.input.descriptionPlaceholder')"
            />
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="flex items-start gap-3 rounded-xl border border-line p-3">
              <input
                v-model="enableHumanReview"
                type="checkbox"
                class="mt-1 size-4 rounded border-line-strong" style="accent-color: var(--color-accent)"
              />
              <span>
                <span class="block text-sm font-medium text-ink">
                  {{ t("workbench.options.humanReview") }}
                </span>
                <span class="mt-1 block text-xs text-ink-faint">
                  {{ t("workbench.options.humanReviewHint") }}
                </span>
              </span>
            </label>
            <label class="flex items-start gap-3 rounded-xl border border-line p-3">
              <input
                v-model="skipPrototype"
                type="checkbox"
                class="mt-1 size-4 rounded border-line-strong" style="accent-color: var(--color-accent)"
              />
              <span>
                <span class="block text-sm font-medium text-ink">
                  {{ t("workbench.options.skipPrototype") }}
                </span>
                <span class="mt-1 block text-xs text-ink-faint">
                  {{ t("workbench.options.skipPrototypeHint") }}
                </span>
              </span>
            </label>
          </div>

          <label class="block">
            <span class="text-sm font-medium text-ink-muted">
              {{ t("workbench.options.outputLanguage") }}
            </span>
            <select
              v-model="outputLanguage"
              class="mt-2 w-full rounded-xl border border-line-strong bg-panel-muted px-3 py-2 text-sm text-ink sm:max-w-xs"
            >
              <option value="zh-CN">
                {{ t("workbench.options.zhCN") }}
              </option>
              <option value="en-US">
                {{ t("workbench.options.enUS") }}
              </option>
            </select>
            <span class="mt-2 block text-xs text-ink-faint">
              {{ t("workbench.options.languageHint") }}
            </span>
          </label>

          <p v-if="formError" role="alert" class="text-sm text-danger">
            {{ formError }}
          </p>
          <button
            type="submit"
            :disabled="busy"
            class="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-40"
          >
            {{ busy ? t("workbench.actions.working") : t("workbench.actions.start") }}
          </button>
        </form>
      </section>

      <section class="rounded-2xl border border-line bg-panel p-4 sm:p-6">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-ink">
            {{ t("workbench.progress.title") }}
          </h2>
          <span class="rounded-full bg-panel-muted px-3 py-1 text-xs font-medium text-ink-muted">
            {{ statusLabel }}
          </span>
        </div>
        <div class="mt-4 h-2 overflow-hidden rounded-full bg-panel-muted">
          <div
            class="h-full rounded-full bg-accent transition-all"
            :style="{ width: `${Math.min(100, Math.max(0, progress))}%` }"
          />
        </div>
        <div class="mt-2 flex justify-between text-xs text-ink-faint">
          <span>{{ progress }}%</span>
          <span v-if="threadId">{{ t("workbench.progress.thread", { id: threadId }) }}</span>
        </div>
        <ol
          class="mt-5 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-line bg-black/30 p-3 font-mono text-xs text-ink-muted"
          :aria-label="t('workbench.progress.log')"
        >
          <li v-if="events.length === 0" class="text-ink-faint">
            {{ t("workbench.progress.empty") }}
          </li>
          <li v-for="(item, index) in events" :key="`${item.receivedAt}-${index}`">
            <span class="text-accent">[{{ item.event }}]</span>
            {{ formatEventData(item.data) }}
          </li>
        </ol>
      </section>
    </div>

    <section
      v-if="awaitingReview"
      class="rounded-2xl border border-warn/30 bg-warn-soft p-4 sm:p-6"
    >
      <h2 class="text-lg font-semibold text-ink">
        {{ t("workbench.review.title") }}
      </h2>
      <p class="mt-1 text-sm text-ink-muted">
        {{ t("workbench.review.description") }}
      </p>
      <form class="mt-5 space-y-4" @submit.prevent="submitReview">
        <label class="block">
          <span class="text-sm font-medium text-ink">
            {{ t("workbench.review.action") }}
          </span>
          <select
            v-model="reviewAction"
            class="mt-2 w-full rounded-xl border border-warn/40 bg-panel px-3 py-2 text-sm text-ink sm:max-w-sm"
          >
            <option value="approve">{{ t("workbench.review.approve") }}</option>
            <option value="edit">{{ t("workbench.review.edit") }}</option>
            <option value="reject">{{ t("workbench.review.reject") }}</option>
          </select>
        </label>
        <label v-if="reviewAction === 'edit'" class="block">
          <span class="text-sm font-medium text-ink">
            {{ t("workbench.review.patch") }}
          </span>
          <textarea
            v-model="prdPatch"
            class="mt-2 min-h-36 w-full rounded-xl border border-warn/40 bg-panel px-3 py-2 font-mono text-xs text-ink"
            :placeholder="t('workbench.review.patchPlaceholder')"
          />
        </label>
        <label v-if="reviewAction === 'reject'" class="block">
          <span class="text-sm font-medium text-ink">
            {{ t("workbench.review.feedback") }}
          </span>
          <textarea
            v-model="feedback"
            class="mt-2 min-h-28 w-full rounded-xl border border-warn/40 bg-panel px-3 py-2 text-sm text-ink"
            :placeholder="t('workbench.review.feedbackPlaceholder')"
          />
        </label>
        <p v-if="reviewError" role="alert" class="text-sm text-danger">
          {{ reviewError }}
        </p>
        <button
          type="submit"
          :disabled="busy"
          class="rounded-xl bg-warn px-4 py-2.5 text-sm font-semibold text-canvas hover:brightness-95 disabled:opacity-60"
        >
          {{ t("workbench.review.submit") }}
        </button>
      </form>
    </section>

    <section
      v-if="prd || prdMarkdown"
      class="rounded-2xl border border-line bg-panel p-4 sm:p-6"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-ink">
          {{ t("workbench.result.prd") }}
        </h2>
        <div class="flex rounded-lg bg-panel-muted p-1">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm"
            :class="activePrdTab === 'markdown' ? 'bg-panel-hover font-medium text-ink' : 'text-ink-muted'"
            @click="activePrdTab = 'markdown'"
          >
            {{ t("workbench.result.markdown") }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm"
            :class="activePrdTab === 'json' ? 'bg-panel-hover font-medium text-ink' : 'text-ink-muted'"
            @click="activePrdTab = 'json'"
          >
            {{ t("workbench.result.json") }}
          </button>
        </div>
      </div>
      <pre
        v-if="activePrdTab === 'markdown'"
        class="mt-4 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-black/30 p-4 text-sm leading-6 text-ink-muted"
      >{{ prdMarkdown }}</pre>
      <pre
        v-else
        class="mt-4 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-black/30 p-4 text-sm leading-6 text-ink-muted"
      >{{ JSON.stringify(prd, null, 2) }}</pre>
    </section>

    <section
      v-if="prototypeHtml"
      class="rounded-2xl border border-line bg-panel p-4 sm:p-6"
    >
      <h2 class="text-lg font-semibold text-ink">
        {{ t("workbench.result.prototype") }}
      </h2>
      <iframe
        sandbox="allow-scripts"
        :srcdoc="prototypeHtml"
        :title="t('workbench.result.prototypeFrame')"
        class="mt-4 min-h-[32rem] w-full rounded-xl border border-line bg-white"
      />
    </section>

    <section
      v-if="threadId"
      class="rounded-2xl border border-line bg-panel p-4 sm:p-6"
    >
      <h2 class="text-lg font-semibold text-ink">
        {{ t("workbench.export.title") }}
      </h2>
      <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          :disabled="!prdMarkdown"
          class="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-40"
          @click="job.downloadExport('prd.md')"
        >
          {{ t("workbench.export.markdown") }}
        </button>
        <button
          type="button"
          :disabled="!prd"
          class="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-40"
          @click="job.downloadExport('prd.json')"
        >
          {{ t("workbench.export.json") }}
        </button>
        <button
          type="button"
          :disabled="!prototypeHtml"
          class="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-40"
          @click="job.downloadExport('prototype.html')"
        >
          {{ t("workbench.export.prototype") }}
        </button>
      </div>
    </section>
  </div>
</template>

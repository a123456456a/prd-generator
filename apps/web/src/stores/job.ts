import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError, apiFetch, handleUnauthorized } from "@/api/client";
import { parseSseStream } from "@/api/sse";

export type OutputLanguage = "zh-CN" | "en-US";
export type ReviewAction = "approve" | "edit" | "reject";

export type JobEvent = {
  event: string;
  data: unknown;
  receivedAt: string;
};

export type JobSnapshot = {
  threadId: string;
  status: string;
  progress: number;
  prd?: unknown;
  prdMarkdown?: string;
  prototypeHtml?: string;
  error?: string;
};

export type JobUiError = {
  code: string;
  message: string;
};

export type StartGenerateInput = {
  files: File[];
  textDescription: string;
  enableHumanReview: boolean;
  skipPrototype: boolean;
  language: OutputLanguage;
};

const THREAD_STORAGE_KEY = "prd_thread_id";

async function responseError(response: Response): Promise<ApiError> {
  let body: { code?: unknown; message?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Keep a stable fallback for non-JSON failures.
  }
  return new ApiError(
    typeof body.code === "string" ? body.code : "UNKNOWN",
    typeof body.message === "string" ? body.message : response.statusText,
    response.status,
  );
}

export const useJobStore = defineStore("job", () => {
  const threadId = ref<string | null>(null);
  const phase = ref("idle");
  const progress = ref(0);
  const events = ref<JobEvent[]>([]);
  const prd = ref<unknown>(null);
  const prdMarkdown = ref("");
  const prototypeHtml = ref("");
  const uiError = ref<JobUiError | null>(null);
  const outputLanguage = ref<OutputLanguage>("zh-CN");
  const busy = ref(false);

  function applySnapshot(snapshot: Partial<JobSnapshot>) {
    if (typeof snapshot.threadId === "string") {
      threadId.value = snapshot.threadId;
      localStorage.setItem(THREAD_STORAGE_KEY, snapshot.threadId);
    }
    if (typeof snapshot.status === "string") phase.value = snapshot.status;
    if (typeof snapshot.progress === "number") progress.value = snapshot.progress;
    if (Object.prototype.hasOwnProperty.call(snapshot, "prd")) {
      prd.value = snapshot.prd ?? null;
    }
    if (typeof snapshot.prdMarkdown === "string") {
      prdMarkdown.value = snapshot.prdMarkdown;
    }
    if (typeof snapshot.prototypeHtml === "string") {
      prototypeHtml.value = snapshot.prototypeHtml;
    }
    if (snapshot.error) {
      uiError.value = { code: "GENERATION_FAILED", message: snapshot.error };
    }
  }

  function setError(error: unknown) {
    if (error instanceof ApiError) {
      uiError.value = { code: error.code, message: error.message };
    } else {
      uiError.value = {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function handleEvent(event: string, data: unknown) {
    events.value.push({
      event,
      data,
      receivedAt: new Date().toISOString(),
    });
    if (data && typeof data === "object") {
      applySnapshot(data as Partial<JobSnapshot>);
    }
    if (event === "error") {
      const payload = data as { code?: unknown; error?: unknown };
      uiError.value = {
        code: typeof payload?.code === "string" ? payload.code : "GENERATION_FAILED",
        message: typeof payload?.error === "string" ? payload.error : "",
      };
    }
  }

  async function startGenerate(input: StartGenerateInput) {
    busy.value = true;
    uiError.value = null;
    events.value = [];
    phase.value = "queued";
    progress.value = 0;
    prd.value = null;
    prdMarkdown.value = "";
    prototypeHtml.value = "";
    outputLanguage.value = input.language;

    const form = new FormData();
    for (const file of input.files) form.append("files", file);
    if (input.textDescription.trim()) {
      form.append("textDescription", input.textDescription.trim());
    }
    form.append(
      "options",
      JSON.stringify({
        language: input.language,
        enableHumanReview: input.enableHumanReview,
        skipPrototype: input.skipPrototype,
      }),
    );

    try {
      const response = await fetch("/api/generate/stream", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (response.status === 401) handleUnauthorized();
      if (!response.ok) throw await responseError(response);
      await parseSseStream(response, handleEvent);
    } catch (error) {
      setError(error);
      phase.value = "failed";
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function restore() {
    const savedThreadId = localStorage.getItem(THREAD_STORAGE_KEY);
    if (!savedThreadId) return;
    busy.value = true;
    uiError.value = null;
    try {
      const response = await apiFetch(`/api/thread/${savedThreadId}`);
      applySnapshot((await response.json()) as JobSnapshot);
    } catch (error) {
      setError(error);
      if (error instanceof ApiError && error.status === 404) {
        localStorage.removeItem(THREAD_STORAGE_KEY);
        threadId.value = null;
      }
    } finally {
      busy.value = false;
    }
  }

  async function resume(
    action: ReviewAction,
    options: { prdPatch?: Record<string, unknown>; feedback?: string } = {},
  ) {
    if (!threadId.value) return;
    busy.value = true;
    uiError.value = null;
    const body =
      action === "edit"
        ? { action, prdPatch: options.prdPatch }
        : action === "reject"
          ? { action, feedback: options.feedback }
          : { action };
    try {
      const response = await apiFetch(`/api/thread/${threadId.value}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      applySnapshot((await response.json()) as JobSnapshot);
    } catch (error) {
      setError(error);
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function downloadExport(
    format: "prd.md" | "prd.json" | "prototype.html",
  ) {
    if (!threadId.value) return;
    uiError.value = null;
    try {
      const response = await apiFetch(
        `/api/thread/${threadId.value}/export/${format}`,
      );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = format;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setError(error);
    }
  }

  return {
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
    startGenerate,
    restore,
    resume,
    downloadExport,
  };
});

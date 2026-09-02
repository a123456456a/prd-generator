import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUnauthorizedHandler } from "@/api/client";
import { useJobStore, type ReviewAction } from "./job";

describe("job store API contracts", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.restoreAllMocks();
    setUnauthorizedHandler(null);
  });

  it("serializes generation options into multipart FormData", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const job = useJobStore();

    await job.startGenerate({
      files: [],
      textDescription: "  Build a planner  ",
      language: "en-US",
      enableHumanReview: true,
      skipPrototype: false,
    });

    const [path, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(path).toBe("/api/generate/stream");
    expect(form.get("textDescription")).toBe("Build a planner");
    expect(JSON.parse(String(form.get("options")))).toEqual({
      language: "en-US",
      enableHumanReview: true,
      skipPrototype: false,
    });
  });

  it.each<[
    ReviewAction,
    { prdPatch?: Record<string, unknown>; feedback?: string },
    unknown,
  ]>([
    ["approve", {}, { action: "approve" }],
    ["edit", { prdPatch: { title: "Updated" } }, { action: "edit", prdPatch: { title: "Updated" } }],
    ["reject", { feedback: "Needs work" }, { action: "reject", feedback: "Needs work" }],
  ])("sends the %s review payload", async (action, options, expectedBody) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          threadId: "thread-1",
          status: "completed",
          progress: 100,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const job = useJobStore();
    job.threadId = "thread-1";

    await job.resume(action, options);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/thread/thread-1/resume",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(expectedBody),
      }),
    );
  });

  it("uses the centralized unauthorized handler for SSE 401 responses", async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "AUTH_REQUIRED", message: "Expired" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(
      useJobStore().startGenerate({
        files: [],
        textDescription: "test",
        language: "zh-CN",
        enableHumanReview: false,
        skipPrototype: true,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});

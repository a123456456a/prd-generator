import { describe, expect, it, vi } from "vitest";
import {
  sendSseEvent,
  writeSseHeaders,
  type SseReply,
} from "../../src/services/sse.js";

function createReply() {
  const headers = new Map<string, string>();
  const reply: SseReply = {
    raw: {
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
      flushHeaders: vi.fn(),
      write: vi.fn(),
    },
  };
  return { reply, headers };
}

describe("SSE helpers", () => {
  it("writes streaming headers and flushes them", () => {
    const { reply, headers } = createReply();

    writeSseHeaders(reply);

    expect(headers.get("Content-Type")).toBe("text/event-stream");
    expect(headers.get("Cache-Control")).toBe("no-cache");
    expect(headers.get("Connection")).toBe("keep-alive");
    expect(reply.raw.flushHeaders).toHaveBeenCalledOnce();
  });

  it("serializes a named SSE event", () => {
    const { reply } = createReply();

    sendSseEvent(reply, "progress", { progress: 25 });

    expect(reply.raw.write).toHaveBeenCalledWith(
      'event: progress\ndata: {"progress":25}\n\n',
    );
  });
});

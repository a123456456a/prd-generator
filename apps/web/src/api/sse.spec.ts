import { describe, expect, it } from "vitest";
import { parseSseStream } from "@/api/sse";

describe("parseSseStream", () => {
  it("parses progress and done events", async () => {
    const body =
      'event: progress\ndata: {"progress":10}\n\n' +
      "event: done\ndata: {}\n\n";
    const events: Array<{ event: string; data: unknown }> = [];

    await parseSseStream(new Response(body), (event, data) => {
      events.push({ event, data });
    });

    expect(events).toEqual([
      { event: "progress", data: { progress: 10 } },
      { event: "done", data: {} },
    ]);
  });

  it("parses frames split across stream chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: status\r\ndata: {\"sta"));
        controller.enqueue(encoder.encode('tus":"running"}\r\n\r\n'));
        controller.close();
      },
    });
    const events: Array<{ event: string; data: unknown }> = [];

    await parseSseStream(new Response(stream), (event, data) => {
      events.push({ event, data });
    });

    expect(events).toEqual([
      { event: "status", data: { status: "running" } },
    ]);
  });

  it("handles a CRLF delimiter split between chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: done\r\ndata: {}\r'));
        controller.enqueue(encoder.encode("\n\r"));
        controller.enqueue(
          encoder.encode('\nevent: status\r\ndata: {"status":"completed"}\r\n\r\n'),
        );
        controller.close();
      },
    });
    const events: string[] = [];

    await parseSseStream(new Response(stream), (event) => events.push(event));

    expect(events).toEqual(["done", "status"]);
  });
});

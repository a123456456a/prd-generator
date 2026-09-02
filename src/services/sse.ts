export const SSE_EVENTS = [
  "progress",
  "status",
  "result",
  "error",
  "done",
] as const;

export type SseEvent = (typeof SSE_EVENTS)[number];

export interface SseReply {
  raw: {
    setHeader(name: string, value: string): void;
    flushHeaders(): void;
    write(chunk: string): unknown;
  };
}

export function writeSseHeaders(reply: SseReply): void {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.flushHeaders();
}

export function sendSseEvent(
  reply: SseReply,
  event: SseEvent,
  data: unknown,
): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

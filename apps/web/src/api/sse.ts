export type SseEventHandler = (event: string, data: unknown) => void;

function emitFrame(frame: string, onEvent: SseEventHandler): void {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) return;
  const rawData = dataLines.join("\n");
  let data: unknown = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    // SSE also permits plain-text data.
  }
  onEvent(event, data);
}

export async function parseSseStream(
  response: Response,
  onEvent: SseEventHandler,
): Promise<void> {
  if (!response.body) {
    throw new Error("SSE response body is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      emitFrame(buffer.slice(0, boundary), onEvent);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  if (buffer.trim()) emitFrame(buffer, onEvent);
}

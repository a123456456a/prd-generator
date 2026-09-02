export function parseTextFile(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

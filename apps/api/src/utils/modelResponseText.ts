/** Extracts plain text from either a raw string or a LangChain message-like response. */
export function responseText(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }
  if (!response || typeof response !== "object" || !("content" in response)) {
    return "";
  }

  const content = response.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof part.text === "string" ? part.text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

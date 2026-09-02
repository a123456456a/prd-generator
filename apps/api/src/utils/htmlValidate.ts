export type HtmlValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function assertPrototypeHtml(html: string): HtmlValidationResult {
  if (!/(?:<!doctype\s+html|<html(?:\s|>))/i.test(html)) {
    return { ok: false, reason: "缺少 HTML 文档起始标记" };
  }

  if (!/<\/html\s*>/i.test(html)) {
    return { ok: false, reason: "缺少 </html> 结束标签" };
  }

  return { ok: true };
}

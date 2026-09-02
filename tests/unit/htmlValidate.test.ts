import { describe, expect, it } from "vitest";
import { assertPrototypeHtml } from "../../src/utils/htmlValidate.js";

describe("assertPrototypeHtml", () => {
  it.each([
    "<!DOCTYPE html><html><body>Prototype</body></html>",
    "<HTML><body>Prototype</body></HTML>",
  ])("accepts a complete HTML document", (html) => {
    expect(assertPrototypeHtml(html)).toEqual({ ok: true });
  });

  it.each([
    ["missing opening marker", "<body>Prototype</body></html>"],
    ["missing closing tag", "<!DOCTYPE html><html><body>Prototype</body>"],
  ])("rejects %s", (_case, html) => {
    const result = assertPrototypeHtml(html);

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

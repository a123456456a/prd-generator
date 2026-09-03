import { describe, expect, it, vi } from "vitest";
import { createRevisePrdNode } from "../../src/graph/nodes/revisePrd.js";
import { createRevisePrototypeNode } from "../../src/graph/nodes/revisePrototype.js";
import type { GraphModel } from "../../src/graph/state.js";
import type { PRD } from "../../src/schemas/prdSchema.js";

const currentPrd: PRD = {
  title: "PRD Generator",
  version: "0.1.0",
  date: "2026-09-02",
  language: "zh-CN",
  background: "把零散需求整理为 PRD",
  objectives: ["生成结构化 PRD"],
  targetUsers: ["产品经理"],
  assumptions: [],
  outOfScope: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  userStories: [],
  userFlows: [],
  openQuestions: [],
  technicalConsiderations: [],
  prototypeDescription: "上传与结果页面",
};

describe("createRevisePrdNode", () => {
  it("returns the revised PRD and a change summary on success", async () => {
    const revisedPrd = { ...currentPrd, title: "PRD 生成器" };
    const invoke = vi.fn().mockResolvedValue({
      prd: revisedPrd,
      changeSummary: "已将标题改为「PRD 生成器」",
    });
    const modelFactory = vi.fn(
      (): GraphModel => ({
        invoke: vi.fn(),
        withStructuredOutput: () => ({ invoke }),
      }),
    );
    const node = createRevisePrdNode(modelFactory, "gpt-4o");

    const outcome = await node(currentPrd, "把标题改成「PRD 生成器」", [], "zh-CN");

    expect(outcome).toEqual({
      prd: revisedPrd,
      prdMarkdown: expect.stringContaining("# PRD 生成器"),
      changeSummary: "已将标题改为「PRD 生成器」",
    });
    expect(modelFactory).toHaveBeenCalledWith("gpt-4o");
  });

  it("retries on invalid structured output and surfaces the error after exhausting attempts", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("invalid json"));
    const modelFactory = vi.fn(
      (): GraphModel => ({
        invoke: vi.fn(),
        withStructuredOutput: () => ({ invoke }),
      }),
    );
    const node = createRevisePrdNode(modelFactory, "gpt-4o");

    const outcome = await node(currentPrd, "把标题改一下", [], "zh-CN");

    expect(outcome).toEqual({ error: expect.stringContaining("PRD 修改失败") });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("uses the per-task model override when provided", async () => {
    const invoke = vi.fn().mockResolvedValue({
      prd: currentPrd,
      changeSummary: "无变化",
    });
    const modelFactory = vi.fn(
      (): GraphModel => ({
        invoke: vi.fn(),
        withStructuredOutput: () => ({ invoke }),
      }),
    );
    const node = createRevisePrdNode(modelFactory, "gpt-4o");

    await node(currentPrd, "保持原样", [], "zh-CN", "deepseek-v4-flash");

    expect(modelFactory).toHaveBeenCalledWith("deepseek-v4-flash");
  });
});

describe("createRevisePrototypeNode", () => {
  it("strips the leading change-summary comment and validates the remaining HTML", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(
        "<!-- 已将主色调改为蓝色 -->\n<!doctype html><html><body>Prototype</body></html>",
      );
    const modelFactory = vi.fn((): GraphModel => ({ invoke }));
    const validateHtml = vi.fn().mockReturnValue({ ok: true });
    const node = createRevisePrototypeNode(modelFactory, "gpt-4o", validateHtml);

    const outcome = await node(
      "<!doctype html><html><body>Old</body></html>",
      currentPrd,
      "把主色调改成蓝色",
      [],
    );

    expect(outcome).toEqual({
      prototypeHtml: "<!doctype html><html><body>Prototype</body></html>",
      changeSummary: "已将主色调改为蓝色",
    });
    expect(validateHtml).toHaveBeenCalledWith(
      "<!doctype html><html><body>Prototype</body></html>",
    );
  });

  it("falls back to a default summary when no leading comment is present", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue("<!doctype html><html><body>Prototype</body></html>");
    const modelFactory = vi.fn((): GraphModel => ({ invoke }));
    const node = createRevisePrototypeNode(
      modelFactory,
      "gpt-4o",
      () => ({ ok: true }),
    );

    const outcome = await node(
      "<!doctype html><html></html>",
      currentPrd,
      "随便改改",
      [],
    );

    expect(outcome).toEqual({
      prototypeHtml: "<!doctype html><html><body>Prototype</body></html>",
      changeSummary: "已根据反馈更新原型",
    });
  });

  it("retries once then reports the validation failure", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce("<body>missing html wrapper</body>")
      .mockResolvedValueOnce("<body>still missing</body>");
    const modelFactory = vi.fn((): GraphModel => ({ invoke }));
    const node = createRevisePrototypeNode(
      modelFactory,
      "gpt-4o",
      () => ({ ok: false, reason: "缺少 HTML 文档起始标记" }),
    );

    const outcome = await node(
      "<!doctype html><html></html>",
      currentPrd,
      "改一下",
      [],
    );

    expect(outcome).toEqual({ error: expect.stringContaining("原型修改失败") });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

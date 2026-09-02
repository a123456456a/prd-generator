import { describe, expect, it, vi } from "vitest";
import type { StoredFile } from "../../src/storage/types.js";
import { buildGraph, type GraphModel } from "../../src/graph/workflow.js";

const rawFile: StoredFile = {
  storageKey: "requirements.txt",
  originalName: "requirements.txt",
  mimeType: "text/plain",
  size: 12,
  absolutePath: "D:\\uploads\\requirements.txt",
};

const validPrd = {
  title: "PRD Generator",
  version: "0.1.0",
  date: "2026-09-02",
  language: "zh-CN" as const,
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

const invokeOptions = { configurable: { thread_id: "task-5-test" } };

describe("buildGraph", () => {
  it("short-circuits to failed when parsing yields no text", async () => {
    const parseInputs = vi.fn().mockResolvedValue({
      extractedText: "",
      fragments: [
        {
          sourceId: rawFile.storageKey,
          excerpt: "",
          charCount: 0,
          parseStatus: "failed",
          errorMessage: "unreadable",
        },
      ],
      warnings: ["所有输入均解析失败"],
    });
    const modelFactory = vi.fn<() => GraphModel>();
    const graph = buildGraph({ parseInputs, modelFactory });

    const result = await graph.invoke({ rawFiles: [rawFile] }, invokeOptions);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("解析");
    expect(result.fragments).toHaveLength(1);
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("uses default models, retries invalid generations, and completes", async () => {
    const parseInputs = vi.fn().mockResolvedValue({
      extractedText: "需要一个 PRD 生成器",
      fragments: [],
      warnings: [],
    });
    const extractInvoke = vi.fn().mockResolvedValue({
      structuredRequirements: { goal: "生成 PRD" },
      gaps: [],
    });
    const prdInvoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid structured output"))
      .mockResolvedValue(validPrd);
    const prototypeInvoke = vi
      .fn()
      .mockResolvedValueOnce("<body>missing html wrapper</body>")
      .mockResolvedValue("<!DOCTYPE html><html><body>Prototype</body></html>");
    const modelFactory = vi.fn((model: string): GraphModel => {
      if (model === "gpt-4o-mini") {
        return {
          invoke: vi.fn(),
          withStructuredOutput: () => ({ invoke: extractInvoke }),
        };
      }
      return {
        invoke: prototypeInvoke,
        withStructuredOutput: () => ({ invoke: prdInvoke }),
      };
    });
    const graph = buildGraph({ parseInputs, modelFactory });

    const result = await graph.invoke({ rawFiles: [rawFile] }, invokeOptions);

    expect(result.status).toBe("completed");
    expect(result.prd).toEqual(validPrd);
    expect(result.prdMarkdown).toContain("# PRD Generator");
    expect(result.prototypeHtml).toContain("<!DOCTYPE html>");
    expect(prdInvoke).toHaveBeenCalledTimes(2);
    expect(prototypeInvoke).toHaveBeenCalledTimes(2);
    expect(modelFactory.mock.calls.map(([model]) => model)).toEqual([
      "gpt-4o-mini",
      "gpt-4o",
      "gpt-4o",
    ]);
  });

  it("ends awaiting clarification when required gaps remain", async () => {
    const modelFactory = vi.fn(
      (): GraphModel => ({
        invoke: vi.fn(),
        withStructuredOutput: () => ({
          invoke: vi.fn().mockResolvedValue({
            structuredRequirements: { goal: "生成 PRD" },
            gaps: ["目标用户是谁？"],
          }),
        }),
      }),
    );
    const graph = buildGraph({
      parseInputs: vi.fn().mockResolvedValue({
        extractedText: "生成一个工具",
        fragments: [],
        warnings: [],
      }),
      modelFactory,
    });

    const result = await graph.invoke(
      {
        rawFiles: [],
        config: { requireClarification: true },
      },
      { configurable: { thread_id: "clarification-test" } },
    );

    expect(result.status).toBe("awaiting_clarification");
    expect(result.gaps).toEqual(["目标用户是谁？"]);
    expect(modelFactory).toHaveBeenCalledTimes(1);
  });

  it("ends awaiting review after PRD generation when review is enabled", async () => {
    const modelFactory = vi.fn(
      (model: string): GraphModel =>
        model === "extract-override"
          ? {
              invoke: vi.fn(),
              withStructuredOutput: () => ({
                invoke: vi.fn().mockResolvedValue({
                  structuredRequirements: {},
                  gaps: [],
                }),
              }),
            }
          : {
              invoke: vi.fn(),
              withStructuredOutput: () => ({
                invoke: vi.fn().mockResolvedValue(validPrd),
              }),
            },
    );
    const graph = buildGraph({
      parseInputs: vi.fn().mockResolvedValue({
        extractedText: "生成一个工具",
        fragments: [],
        warnings: [],
      }),
      modelFactory,
    });

    const result = await graph.invoke(
      {
        rawFiles: [],
        config: {
          enableHumanReview: true,
          extractModel: "extract-override",
          prdModel: "prd-override",
        },
      },
      { configurable: { thread_id: "review-test" } },
    );

    expect(result.status).toBe("awaiting_review");
    expect(result.prd).toEqual(validPrd);
    expect(modelFactory.mock.calls.map(([model]) => model)).toEqual([
      "extract-override",
      "prd-override",
    ]);
  });
});

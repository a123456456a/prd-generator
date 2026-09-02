import { describe, it, expect } from "vitest";
import { PRDSchema } from "../../src/schemas/prdSchema.js";

describe("PRDSchema", () => {
  it("accepts a minimal valid PRD", () => {
    const parsed = PRDSchema.parse({
      title: "示例",
      version: "0.1.0",
      date: "2026-09-02",
      language: "zh-CN",
      background: "背景",
      objectives: ["目标1"],
      targetUsers: ["产品经理"],
      assumptions: [],
      outOfScope: [],
      functionalRequirements: [
        {
          id: "FR-001",
          name: "上传",
          description: "上传需求文件",
          priority: "P0",
          userValue: "节省整理时间",
          acceptanceCriteria: ["可上传 docx"],
          sourceIds: ["src-1"],
        },
      ],
      nonFunctionalRequirements: [],
      userStories: [],
      userFlows: [],
      openQuestions: [],
      technicalConsiderations: [],
      prototypeDescription: "首页+上传页",
    });
    expect(parsed.title).toBe("示例");
  });

  it("rejects invalid priority", () => {
    expect(() =>
      PRDSchema.parse({
        title: "x",
        version: "0.1.0",
        date: "2026-09-02",
        language: "zh-CN",
        background: "b",
        objectives: [],
        targetUsers: [],
        assumptions: [],
        outOfScope: [],
        functionalRequirements: [
          {
            id: "FR-001",
            name: "n",
            description: "d",
            priority: "P9",
            userValue: "v",
            acceptanceCriteria: ["a"],
            sourceIds: [],
          },
        ],
        nonFunctionalRequirements: [],
        userStories: [],
        userFlows: [],
        openQuestions: [],
        technicalConsiderations: [],
        prototypeDescription: "p",
      }),
    ).toThrow();
  });
});

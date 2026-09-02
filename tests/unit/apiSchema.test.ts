import { describe, expect, it } from "vitest";
import {
  CreateTaskBodySchema,
  RegenerateBodySchema,
  ResumeTaskBodySchema,
} from "../../src/schemas/apiSchema.js";

describe("Task API schemas", () => {
  it("reuses generate options in create task input", () => {
    const result = CreateTaskBodySchema.parse({
      files: [],
      textDescription: "需求",
      options: { language: "zh-CN", enableHumanReview: true },
    });

    expect(result.options?.language).toBe("zh-CN");
  });

  it("requires edit patches and reject feedback", () => {
    expect(() =>
      ResumeTaskBodySchema.parse({ action: "edit" }),
    ).toThrow();
    expect(() =>
      ResumeTaskBodySchema.parse({ action: "reject" }),
    ).toThrow();
    expect(
      ResumeTaskBodySchema.parse({
        action: "reject",
        feedback: "补充验收标准",
      }),
    ).toEqual({ action: "reject", feedback: "补充验收标准" });
  });

  it("accepts only supported regeneration targets", () => {
    expect(RegenerateBodySchema.parse({ target: "prototype" })).toEqual({
      target: "prototype",
    });
    expect(() => RegenerateBodySchema.parse({ target: "all" })).toThrow();
  });
});

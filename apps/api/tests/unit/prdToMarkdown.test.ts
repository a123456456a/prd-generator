import { describe, expect, it } from "vitest";
import type { PRD } from "../../src/schemas/prdSchema.js";
import { prdToMarkdown } from "../../src/utils/prdToMarkdown.js";

const prd: PRD = {
  title: "Todo App",
  version: "1.0.0",
  date: "2026-09-02",
  language: "en-US",
  background: "Teams need a shared task list.",
  objectives: ["Track work"],
  targetUsers: ["Product teams"],
  assumptions: [],
  outOfScope: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  userStories: [],
  userFlows: [],
  openQuestions: [],
  technicalConsiderations: [],
  prototypeDescription: "A task dashboard.",
};

describe("prdToMarkdown", () => {
  it("renders a valid PRD with stable English section headers", () => {
    const markdown = prdToMarkdown(prd);

    expect(markdown).toContain("# Todo App");
    expect(markdown).toContain("## Background");
    expect(markdown).toContain("Teams need a shared task list.");
  });
});

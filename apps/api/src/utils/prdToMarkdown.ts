import type { PRD } from "../schemas/prdSchema.js";

function list(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"];
}

export function prdToMarkdown(prd: PRD): string {
  return [
    `# ${prd.title}`,
    "",
    `Version: ${prd.version}`,
    `Date: ${prd.date}`,
    "",
    "## Background",
    prd.background,
    "",
    "## Objectives",
    ...list(prd.objectives),
    "",
    "## Target Users",
    ...list(prd.targetUsers),
    "",
    "## Functional Requirements",
    ...(
      prd.functionalRequirements.length > 0
        ? prd.functionalRequirements.map(
            (requirement) =>
              `- **${requirement.id} ${requirement.name}** (${requirement.priority}): ${requirement.description}`,
          )
        : ["- None"]
    ),
    "",
    "## Non-Functional Requirements",
    ...(
      prd.nonFunctionalRequirements.length > 0
        ? prd.nonFunctionalRequirements.map(
            (requirement) =>
              `- **${requirement.category}**: ${requirement.description}`,
          )
        : ["- None"]
    ),
    "",
    "## Open Questions",
    ...list(prd.openQuestions),
  ].join("\n");
}

import { z } from "zod";

export const PrioritySchema = z.enum(["P0", "P1", "P2"]);
export const LanguageSchema = z.enum(["zh-CN", "en-US"]);
export const NfrCategorySchema = z.enum([
  "performance",
  "security",
  "reliability",
  "usability",
  "other",
]);

export const FunctionalRequirementSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  userValue: z.string(),
  acceptanceCriteria: z.array(z.string()),
  sourceIds: z.array(z.string()),
});

export const NonFunctionalRequirementSchema = z.object({
  id: z.string(),
  category: NfrCategorySchema,
  description: z.string(),
});

export const UserStorySchema = z.object({
  id: z.string(),
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
  relatedFrIds: z.array(z.string()),
});

export const UserFlowSchema = z.object({
  name: z.string(),
  steps: z.array(z.string()),
});

export const PRDSchema = z.object({
  title: z.string(),
  version: z.string(),
  date: z.string(),
  language: LanguageSchema,
  background: z.string(),
  objectives: z.array(z.string()),
  targetUsers: z.array(z.string()),
  assumptions: z.array(z.string()),
  outOfScope: z.array(z.string()),
  functionalRequirements: z.array(FunctionalRequirementSchema),
  nonFunctionalRequirements: z.array(NonFunctionalRequirementSchema),
  userStories: z.array(UserStorySchema),
  userFlows: z.array(UserFlowSchema),
  openQuestions: z.array(z.string()),
  technicalConsiderations: z.array(z.string()),
  prototypeDescription: z.string(),
});

export const GenerateOptionsSchema = z.object({
  language: LanguageSchema.optional(),
  model: z.string().optional(),
  requireClarification: z.boolean().optional(),
  enableHumanReview: z.boolean().optional(),
  skipPrototype: z.boolean().optional(),
  async: z.boolean().optional(),
});

export type PRD = z.infer<typeof PRDSchema>;
export type FunctionalRequirement = z.infer<typeof FunctionalRequirementSchema>;
export type NonFunctionalRequirement = z.infer<
  typeof NonFunctionalRequirementSchema
>;
export type UserStory = z.infer<typeof UserStorySchema>;
export type UserFlow = z.infer<typeof UserFlowSchema>;
export type GenerateOptions = z.infer<typeof GenerateOptionsSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type NfrCategory = z.infer<typeof NfrCategorySchema>;

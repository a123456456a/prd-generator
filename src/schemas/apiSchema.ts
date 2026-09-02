import { z } from "zod";
import { GenerateOptionsSchema } from "./prdSchema.js";

export const StoredFileSchema = z.object({
  storageKey: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
  absolutePath: z.string(),
});

export const CreateTaskBodySchema = z.object({
  files: z.array(StoredFileSchema),
  textDescription: z.string().optional(),
  options: GenerateOptionsSchema.optional(),
});

const ApproveResumeSchema = z.object({
  action: z.literal("approve"),
  clarificationText: z.string().min(1).optional(),
});

const EditResumeSchema = z.object({
  action: z.literal("edit"),
  prdPatch: z
    .record(z.string(), z.unknown())
    .refine((patch) => Object.keys(patch).length > 0, "prdPatch 不能为空"),
});

const RejectResumeSchema = z.object({
  action: z.literal("reject"),
  feedback: z.string().min(1),
});

export const ResumeTaskBodySchema = z.discriminatedUnion("action", [
  ApproveResumeSchema,
  EditResumeSchema,
  RejectResumeSchema,
]);

export const RegenerateBodySchema = z.object({
  target: z.enum(["prd", "prototype"]),
});

export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;
export type ResumeTaskBody = z.infer<typeof ResumeTaskBodySchema>;
export type RegenerateBody = z.infer<typeof RegenerateBodySchema>;

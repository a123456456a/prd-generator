import { z } from "zod";
import { PRDSchema } from "./prdSchema.js";

/**
 * Structured output for a natural-language PRD revision: the model returns
 * the complete revised PRD (fields the user did not ask to change stay
 * identical) plus a short human-readable summary used as the chat reply.
 */
export const RevisePrdResultSchema = z.object({
  prd: PRDSchema,
  changeSummary: z.string().min(1),
});

export type RevisePrdResult = z.infer<typeof RevisePrdResultSchema>;

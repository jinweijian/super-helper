import { z } from 'zod';
import { experienceDraftSchema, experienceReviewSchema } from './schema.js';

export const refinementProgressSchema = z.strictObject({
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/), attempt: z.number().int().min(0).max(2),
  draft: experienceDraftSchema.optional(), review: experienceReviewSchema.optional(),
  feedback: z.strictObject({ reason: z.enum(['draft_invalid', 'review_invalid', 'evidence_review_failed']),
    draft: experienceDraftSchema.optional(), review: experienceReviewSchema.optional() }).optional(),
});
export type RefinementProgress = z.infer<typeof refinementProgressSchema>;
export interface RefinementCheckpoint {
  load(): unknown;
  save(value: RefinementProgress): void;
}

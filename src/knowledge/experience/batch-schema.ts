import { z } from 'zod';
import { isSourceDate } from './csv/profile.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const importAuditSchema = z.strictObject({
  recordNumber: z.number().int().positive(),
  outcome: z.enum(['imported', 'skipped', 'quarantined']),
  reason: z.enum(['missing_identity', 'duplicate_identity', 'invalid_date', 'source_invalid', 'sensitive_content', 'revision_conflict']).optional(),
  flags: z.array(z.enum(['history_partial', 'attachments_not_exported', 'privacy_review_required', 'placeholder_present'])),
  sourceRevision: hash.optional(),
});
export const batchReportSchema = z.strictObject({
  batchId: hash, total: z.number().int().nonnegative(), processed: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), quarantined: z.number().int().nonnegative(),
  status: z.enum(['paused', 'complete']),
});
export const batchStateSchema = z.strictObject({
  version: z.literal(1),
  records: z.record(z.string().regex(/^exp-[a-f0-9]{64}$/), z.strictObject({ sourceRevision: hash, updatedAt: z.string().refine(isSourceDate).nullable() })),
  batches: z.record(hash, batchReportSchema),
  audits: z.record(hash, z.array(importAuditSchema)),
});
export type ImportAudit = z.infer<typeof importAuditSchema>;
export type BatchState = z.infer<typeof batchStateSchema>;
export type BatchReport = z.infer<typeof batchReportSchema>;

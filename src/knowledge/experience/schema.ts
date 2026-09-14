import { z } from 'zod';
import { sourceFields } from './csv/mapping.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(12_000);
export const experienceSections = [
  'summary', 'symptom', 'applicability', 'cause', 'action', 'verification',
  'counterevidence', 'unknown', 'next_check',
] as const;
export const sourceCellSchema = z.strictObject({
  column: z.string().min(1).max(200), value: z.string().max(200_000), rawHash: hash,
  completeness: z.enum(['present', 'empty', 'redacted', 'suspected_truncated']),
});
export const experienceSourceSchema = z.strictObject({
  scope: z.string().trim().min(1).max(200), sourceInstance: z.string().trim().min(1).max(200),
  sourceProject: z.string().trim().min(1).max(200), ticketId: z.string().trim().min(1).max(200),
  fileHash: hash, recordNumber: z.number().int().positive(),
  fields: z.partialRecord(z.enum(sourceFields), sourceCellSchema),
});
export const experienceDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['root_cause_case', 'recovery_procedure', 'diagnostic_lead', 'reference']),
  evidenceGrade: z.enum(['source_verified', 'source_reported', 'lead_only']),
  claims: z.array(z.strictObject({
    id: z.string().regex(/^C[1-9]\d*$/), section: z.enum(experienceSections), text,
    attribute: z.enum(['product', 'module', 'affected_version', 'fixed_version', 'symptom_term', 'applicability', 'exclusion']).optional(),
    classification: z.enum(['source_reported', 'inference', 'unknown', 'recommendation']),
    execution: z.enum(['performed', 'proposed', 'not_applicable']),
    citations: z.array(z.strictObject({ field: z.enum(sourceFields), quote: text })).max(8),
  })).min(1).max(60),
});
export const experienceReviewSchema = z.strictObject({
  draftHash: hash, sourceRevision: hash,
  verdict: z.enum(['accepted', 'rejected']),
  privacyPassed: z.boolean(), titleSupported: z.boolean(), kindSupported: z.boolean(), evidenceGradeSupported: z.boolean(),
  claims: z.array(z.strictObject({ claimId: z.string(), verdict: z.enum(['supported', 'unsupported', 'contradicted', 'unknown']) })).max(60),
});

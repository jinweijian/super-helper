import type { z } from 'zod';
import type { experienceDraftSchema, experienceReviewSchema, experienceSourceSchema } from './schema.js';

export type ExperienceSource = z.infer<typeof experienceSourceSchema>;
export type ExperienceDraft = z.infer<typeof experienceDraftSchema>;
export type ExperienceReview = z.infer<typeof experienceReviewSchema>;
export interface ExperienceEvidenceReference {
  id: string;
  field: string;
  quote: string;
  column: string;
  fileHash: string;
  recordNumber: number;
  rawHash: string;
}
export interface ExperienceArtifact {
  experienceId: string;
  revision: number;
  sourceRevision: string;
  markdown: string;
  contentHash: string;
  sidecar: {
    schemaVersion: 'experience/v1';
    experienceId: string;
    revision: number;
    sourceRevision: string;
    reviewRecordId: string;
    claims: Array<ExperienceDraft['claims'][number] & { evidenceIds: string[] }>;
    sources: ExperienceEvidenceReference[];
  };
}

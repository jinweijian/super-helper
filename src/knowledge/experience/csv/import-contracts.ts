import type { ExperienceSource } from '../contracts.js';
import type { CsvFieldMapping } from './contracts.js';

export interface ExperienceImportOptions {
  scope: string;
  sourceInstance: string;
  sourceProject?: string;
  mapping?: CsvFieldMapping;
  redactTerms?: string[];
}
export type ImportReason = 'missing_identity' | 'duplicate_identity' | 'invalid_date' | 'source_invalid' | 'sensitive_content';
export interface NormalizedExperienceRecord {
  recordNumber: number;
  status: 'ready' | 'quarantined';
  reason?: ImportReason;
  source?: ExperienceSource;
  flags: Array<'history_partial' | 'attachments_not_exported' | 'privacy_review_required' | 'placeholder_present'>;
}

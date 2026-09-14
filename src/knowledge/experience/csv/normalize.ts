import { experienceSourceSchema } from '../schema.js';
import { sha256 } from '../provenance.js';
import { hasSensitiveExperienceText } from '../privacy.js';
import { redactExperienceSourceText } from '../source-redaction.js';
import { resolveCsvMapping, sourceFields } from './mapping.js';
import { isPlaceholder, isSourceDate } from './profile.js';
import type { ExperienceSource } from '../contracts.js';
import type { ParsedExperienceCsv } from './contracts.js';
import type { ExperienceImportOptions, NormalizedExperienceRecord } from './import-contracts.js';

const identityColumns = ['作者', '指派给', '最近更新人', '工单处理人', '开发人员', '产品经理'];

export function normalizeExperienceCsv(parsed: ParsedExperienceCsv, options: ExperienceImportOptions): NormalizedExperienceRecord[] {
  if (![options.scope, options.sourceInstance].every((value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200)
      || (options.sourceProject !== undefined && (typeof options.sourceProject !== 'string' || !options.sourceProject.trim()))
      || (options.redactTerms !== undefined && (!Array.isArray(options.redactTerms) || options.redactTerms.some((term) => typeof term !== 'string' || term.trim().length < 2)))) {
    throw new Error('EXPERIENCE_IMPORT_OPTIONS_INVALID');
  }
  const mapping = resolveCsvMapping(parsed.headers, options.mapping);
  const key = (values: Record<string, string>) => JSON.stringify([
    mapping.sourceProject ? values[mapping.sourceProject].trim() : options.sourceProject?.trim() ?? '',
    values[mapping.ticketId!].trim(),
  ]);
  const counts = new Map<string, number>();
  for (const row of parsed.rows) counts.set(key(row.values), (counts.get(key(row.values)) ?? 0) + 1);
  return parsed.rows.map((row) => {
    const flags: NormalizedExperienceRecord['flags'] = ['history_partial', 'privacy_review_required'];
    const ticketId = row.values[mapping.ticketId!].trim();
    const sourceProject = mapping.sourceProject ? row.values[mapping.sourceProject].trim() : options.sourceProject?.trim() ?? '';
    if (!ticketId || !sourceProject || !row.values[mapping.title!].trim()) {
      return { recordNumber: row.recordNumber, status: 'quarantined', reason: 'missing_identity', flags };
    }
    if (counts.get(key(row.values))! > 1) return { recordNumber: row.recordNumber, status: 'quarantined', reason: 'duplicate_identity', flags };
    const terms = [...(options.redactTerms ?? []), ...identityColumns.map((col) => row.values[col]?.trim() ?? '')];
    const fields: ExperienceSource['fields'] = {};
    let invalidDate = false;
    for (const field of sourceFields) {
      const column = mapping[field];
      if (!column || ['ticketId', 'sourceProject', 'relatedIssues'].includes(field)) continue;
      const raw = row.values[column];
      if (field === 'attachments') {
        if (raw.trim()) flags.push('attachments_not_exported');
        continue; // File names and URLs are not evidence content.
      }
      if (isPlaceholder(raw)) flags.push('placeholder_present');
      const value = redactExperienceSourceText(raw, terms);
      fields[field] = { column, value, rawHash: sha256(raw),
        completeness: !raw.trim() ? 'empty' : /(?:\.\.\.|…)$/.test(raw.trim()) ? 'suspected_truncated' : value !== raw ? 'redacted' : 'present' };
      if (['createdAt', 'updatedAt'].includes(field) && raw.trim() && !isSourceDate(raw.trim())) invalidDate = true;
    }
    const source = experienceSourceSchema.safeParse({ scope: options.scope, sourceInstance: options.sourceInstance,
      sourceProject, ticketId, fileHash: parsed.fileHash, recordNumber: row.recordNumber, fields });
    if (!source.success) return { recordNumber: row.recordNumber, status: 'quarantined', reason: 'source_invalid', flags: [...new Set(flags)] };
    const reason = invalidDate ? 'invalid_date' : hasSensitiveExperienceText(JSON.stringify(fields)) ? 'sensitive_content' : undefined;
    return { recordNumber: row.recordNumber, status: reason ? 'quarantined' : 'ready', reason, source: source.data, flags: [...new Set(flags)] };
  });
}

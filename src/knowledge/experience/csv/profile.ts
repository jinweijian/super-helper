import type { CsvFieldMapping, CsvFieldProfile, ExperienceCsvProfile, ParsedExperienceCsv, SourceField } from './contracts.js';
import { resolveCsvMapping, sourceFields } from './mapping.js';

export function isPlaceholder(value: string): boolean {
  return /^(?:无|暂无|未知|未记录|不详|n\/a|null|none)[。.!！]?$/i.test(value.trim());
}

/** Validate a local source calendar value, without inventing a timezone. */
export function isSourceDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return false;
  const [, y, m, d, hh = '0', mm = '0', ss = '0'] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
  return date.getUTCFullYear() === +y && date.getUTCMonth() === +m - 1
    && date.getUTCDate() === +d && date.getUTCHours() === +hh
    && date.getUTCMinutes() === +mm && date.getUTCSeconds() === +ss;
}

export function profileExperienceCsv(parsed: ParsedExperienceCsv, overrides: CsvFieldMapping = {}): ExperienceCsvProfile {
  const mapping = resolveCsvMapping(parsed.headers, overrides);
  const fields = {} as Record<SourceField, CsvFieldProfile>;
  for (const field of sourceFields) {
    const column = mapping[field];
    const values = column ? parsed.rows.map((row) => row.values[column]) : [];
    const nonempty = values.filter((value) => value.trim());
    fields[field] = {
      column: column ?? null,
      completeness: !column ? 'not_exported' : nonempty.length ? 'present' : 'empty',
      nonemptyCount: nonempty.length, emptyCount: column ? values.length - nonempty.length : 0,
      placeholderCount: nonempty.filter(isPlaceholder).length,
      suspectedTruncatedCount: nonempty.filter((value) => /(?:\.\.\.|…)$/.test(value.trim())).length,
      maxLength: values.reduce((max, value) => Math.max(max, [...value].length), 0),
      ...(['createdAt', 'updatedAt'].includes(field)
        ? { invalidDateCount: nonempty.filter((value) => !isSourceDate(value.trim())).length } : {}),
    };
  }
  const identities = new Map<string, number>();
  let missingIdentityRecords = 0;
  for (const row of parsed.rows) {
    const id = row.values[mapping.ticketId!].trim();
    const title = row.values[mapping.title!].trim();
    const project = mapping.sourceProject ? row.values[mapping.sourceProject].trim() : '';
    if (!id || !title || (mapping.sourceProject && !project)) missingIdentityRecords++;
    if (id) {
      const key = JSON.stringify([project, id]);
      identities.set(key, (identities.get(key) ?? 0) + 1);
    }
  }
  return {
    fileHash: parsed.fileHash, encoding: parsed.encoding, delimiter: parsed.delimiter,
    recordCount: parsed.rows.length, columnCount: parsed.headers.length,
    duplicateIdRecords: [...identities.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0),
    missingIdentityRecords,
    multilineRecords: parsed.rows.filter((row) => Object.values(row.values).some((value) => /[\r\n]/.test(value))).length,
    unmappedColumns: parsed.headers.filter((header) => !Object.values(mapping).includes(header)), fields,
  };
}

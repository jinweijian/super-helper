import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { CsvParseOptions, ParsedExperienceCsv } from './contracts.js';

export function validateCsvParseOptions(options: CsvParseOptions = {}): Required<CsvParseOptions> {
  const encoding = options.encoding ?? 'utf-8';
  const delimiter = options.delimiter ?? ',';
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const maxRecords = options.maxRecords ?? 100_000;
  if (!['utf-8', 'gb18030'].includes(encoding) || ![',', ';', '\t'].includes(delimiter)
      || !Number.isSafeInteger(maxBytes) || maxBytes <= 0
      || !Number.isSafeInteger(maxRecords) || maxRecords <= 0) {
    throw new Error('CSV_OPTIONS_INVALID');
  }
  return { encoding, delimiter, maxBytes, maxRecords };
}

export function parseExperienceCsv(input: Uint8Array, options: CsvParseOptions = {}): ParsedExperienceCsv {
  const { encoding, delimiter, maxBytes, maxRecords } = validateCsvParseOptions(options);
  if (input.byteLength > maxBytes) throw new Error('CSV_SIZE_LIMIT');
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(input);
  } catch {
    throw new Error('CSV_ENCODING_INVALID');
  }
  if (!text.trim()) throw new Error('CSV_EMPTY');
  let records: string[][];
  try {
    records = parse(text, {
      bom: true, delimiter, columns: false, skip_empty_lines: true,
      relax_column_count: false, relax_quotes: false,
    }) as string[][];
  } catch {
    // Parser errors can embed customer values. Never propagate their message/cause.
    throw new Error('CSV_STRUCTURE_INVALID');
  }
  if (!records.length) throw new Error('CSV_EMPTY');
  const [headers, ...rows] = records;
  const normalized = headers.map((value) => value.trim());
  if (normalized.some((value) => !value) || new Set(normalized).size !== headers.length) {
    throw new Error('CSV_HEADERS_INVALID');
  }
  if (rows.length > maxRecords) throw new Error('CSV_RECORD_LIMIT');
  return {
    fileHash: createHash('sha256').update(input).digest('hex'), encoding, delimiter, headers,
    rows: rows.map((row, index) => ({
      recordNumber: index + 1,
      values: Object.fromEntries(headers.map((header, col) => [header, row[col]])),
    })),
  };
}

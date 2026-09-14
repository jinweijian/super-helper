export type CsvEncoding = 'utf-8' | 'gb18030';
export interface CsvParseOptions {
  encoding?: CsvEncoding;
  delimiter?: ',' | ';' | '\t';
  maxBytes?: number;
  maxRecords?: number;
}
export interface CsvRecord {
  /** One-based logical record, excluding header; not a physical line. */
  recordNumber: number;
  values: Record<string, string>;
}
export interface ParsedExperienceCsv {
  fileHash: string;
  encoding: CsvEncoding;
  delimiter: string;
  headers: string[];
  rows: CsvRecord[];
}
export type SourceField =
  | 'ticketId' | 'sourceProject' | 'title' | 'description' | 'cause'
  | 'actionAndResult' | 'followUp' | 'latestNote' | 'status'
  | 'product' | 'affectedVersion' | 'targetVersion' | 'fixedVersion'
  | 'createdAt' | 'updatedAt' | 'attachments' | 'relatedIssues';
export type CsvFieldMapping = Partial<Record<SourceField, string>>;
export interface CsvFieldProfile {
  column: string | null;
  completeness: 'present' | 'empty' | 'not_exported';
  nonemptyCount: number;
  emptyCount: number;
  placeholderCount: number;
  suspectedTruncatedCount: number;
  maxLength: number;
  invalidDateCount?: number;
}
export interface ExperienceCsvProfile {
  fileHash: string;
  encoding: CsvEncoding;
  delimiter: string;
  recordCount: number;
  columnCount: number;
  duplicateIdRecords: number;
  missingIdentityRecords: number;
  multilineRecords: number;
  unmappedColumns: string[];
  fields: Record<SourceField, CsvFieldProfile>;
}

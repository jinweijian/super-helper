import type {
  KnowledgeCaseReviewAction,
  KnowledgeConfidence,
  KnowledgeDocumentType,
  KnowledgeFrontmatter,
  KnowledgePipelineStage,
  KnowledgePipelineStatus,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeVisibility,
} from './types.js';

const requiredFields = [
  'id',
  'title',
  'type',
  'module',
  'intent',
  'source_type',
  'confidence',
  'status',
  'visibility',
  'product_versions',
  'related_terms',
  'related_repos',
  'last_verified_at',
  'owner',
] as const;

const documentTypes = new Set<KnowledgeDocumentType>([
  'faq',
  'solved_case',
  'unresolved_case',
  'whitepaper_slice',
  'runbook',
  'module_overview',
  'glossary_term',
]);

const sourceTypes = new Set<KnowledgeSourceType>([
  'faq',
  'runbook',
  'solved_case',
  'unresolved_case',
  'whitepaper',
  'glossary',
  'module_doc',
  'ticket',
]);

const confidences = new Set<KnowledgeConfidence>(['low', 'medium', 'high']);
const statuses = new Set<KnowledgeStatus>(['draft', 'review_required', 'active', 'deprecated', 'archived']);
const visibilities = new Set<KnowledgeVisibility>(['internal', 'support', 'customer_safe', 'restricted']);

export interface ParsedMarkdownDocument {
  frontmatter: KnowledgeFrontmatter;
  body: string;
}

export function parseMarkdownDocument(content: string, pathForError = 'document'): ParsedMarkdownDocument {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${pathForError}: missing YAML frontmatter`);
  }

  const raw = parseSimpleYaml(match[1]);
  const missing = requiredFields.filter((field) => raw[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`${pathForError}: missing required frontmatter fields: ${missing.join(', ')}`);
  }

  const frontmatter: KnowledgeFrontmatter = {
    id: asString(raw.id, 'id', pathForError),
    title: asString(raw.title, 'title', pathForError),
    type: enumValue(raw.type, documentTypes, 'type', pathForError),
    module: asString(raw.module, 'module', pathForError),
    intent: asString(raw.intent, 'intent', pathForError),
    source_type: enumValue(raw.source_type, sourceTypes, 'source_type', pathForError),
    confidence: enumValue(raw.confidence, confidences, 'confidence', pathForError),
    status: enumValue(raw.status, statuses, 'status', pathForError),
    visibility: enumValue(raw.visibility, visibilities, 'visibility', pathForError),
    product_versions: asStringArray(raw.product_versions, 'product_versions', pathForError),
    related_terms: asStringArray(raw.related_terms, 'related_terms', pathForError),
    related_repos: asStringArray(raw.related_repos, 'related_repos', pathForError),
    last_verified_at: asString(raw.last_verified_at, 'last_verified_at', pathForError),
    owner: asString(raw.owner, 'owner', pathForError),
    source_document: optionalString(raw.source_document),
    source_document_id: optionalString(raw.source_document_id),
    source_pages: optionalNumberArray(raw.source_pages, 'source_pages', pathForError),
    section_path: optionalStringArray(raw.section_path, 'section_path', pathForError),
    chunking_strategy: optionalString(raw.chunking_strategy),
    tags: optionalStringArray(raw.tags, 'tags', pathForError),
    review_cycle_days: optionalNumber(raw.review_cycle_days, 'review_cycle_days', pathForError),
    // Optional pipeline and review fields
    quality_status: optionalQualityStatus(raw.quality_status),
    source_block_ids: optionalStringArray(raw.source_block_ids, 'source_block_ids', pathForError),
    pipeline_stage: optionalPipelineStage(raw.pipeline_stage),
    pipeline_status: optionalPipelineStatus(raw.pipeline_status),
    review_id: optionalString(raw.review_id),
    publish_id: optionalString(raw.publish_id),
    repair_plan_ids: optionalStringArray(raw.repair_plan_ids, 'repair_plan_ids', pathForError),
    // Solved case review fields
    reviewer: optionalString(raw.reviewer),
    reviewed_at: optionalString(raw.reviewed_at),
    review_notes: optionalString(raw.review_notes),
    review_status: optionalReviewStatus(raw.review_status),
    review_action: optionalReviewAction(raw.review_action),
    review_source: optionalReviewSource(raw.review_source),
  };

  return { frontmatter, body: match[2] ?? '' };
}

export function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentArrayKey: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) {
      continue;
    }

    const arrayItem = line.match(/^\s*-\s*(.*)$/);
    if (arrayItem && currentArrayKey) {
      const existing = result[currentArrayKey];
      if (!Array.isArray(existing)) {
        result[currentArrayKey] = [];
      }
      (result[currentArrayKey] as unknown[]).push(parseScalar(arrayItem[1] ?? ''));
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyValue) {
      currentArrayKey = undefined;
      continue;
    }

    const key = keyValue[1]!;
    const value = keyValue[2] ?? '';
    if (value.trim() === '') {
      result[key] = [];
      currentArrayKey = key;
    } else {
      result[key] = parseScalar(value);
      currentArrayKey = undefined;
    }
  }

  return result;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '[]') {
    return [];
  }
  if (trimmed === 'null') {
    return undefined;
  }
  if (/^\[.*\]$/.test(trimmed)) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
      .filter((item) => item !== '');
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function asString(value: unknown, field: string, pathForError: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${pathForError}: frontmatter field ${field} must be a non-empty string`);
  }
  return value.trim();
}

function asStringArray(value: unknown, field: string, pathForError: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${pathForError}: frontmatter field ${field} must be an array`);
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, field: string, pathForError: string): T {
  const stringValue = asString(value, field, pathForError) as T;
  if (!allowed.has(stringValue)) {
    throw new Error(`${pathForError}: frontmatter field ${field} has unsupported value ${stringValue}`);
  }
  return stringValue;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown, field: string, pathForError: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asStringArray(value, field, pathForError);
}

function optionalNumberArray(value: unknown, field: string, pathForError: string): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathForError}: frontmatter field ${field} must be an array`);
  }
  return value.map((item) => {
    const numberValue = Number(item);
    if (!Number.isFinite(numberValue)) {
      throw new Error(`${pathForError}: frontmatter field ${field} must contain numbers`);
    }
    return numberValue;
  });
}

function optionalNumber(value: unknown, field: string, pathForError: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${pathForError}: frontmatter field ${field} must be a number`);
  }
  return numberValue;
}

const pipelineStatuses = new Set<KnowledgePipelineStatus>([
  'imported',
  'extracted',
  'normalized',
  'draft',
  'quality_warn',
  'quality_error',
  'review_required',
  'approved',
  'rejected',
  'published',
]);

const pipelineStages = new Set<KnowledgePipelineStage>([
  'intake',
  'extract',
  'normalize',
  'slice',
  'audit',
  'repair',
  'review',
  'publish',
  'index',
  'eval',
]);

const reviewStatuses = new Set<NonNullable<KnowledgeFrontmatter['review_status']>>(['pending', 'approved', 'rejected', 'request_edits']);
const reviewActions = new Set<KnowledgeCaseReviewAction>(['approve', 'reject', 'request_edits', 'convert_to_unresolved', 'accept_warnings']);
const qualityStatuses = new Set<NonNullable<KnowledgeFrontmatter['quality_status']>>(['unchecked', 'ok', 'warn', 'error']);

function optionalPipelineStatus(value: unknown): KnowledgePipelineStatus | undefined {
  if (value === undefined) return undefined;
  const str = String(value).trim();
  if (!pipelineStatuses.has(str as KnowledgePipelineStatus)) return undefined;
  return str as KnowledgePipelineStatus;
}

function optionalPipelineStage(value: unknown): KnowledgePipelineStage | undefined {
  if (value === undefined) return undefined;
  const str = String(value).trim();
  if (!pipelineStages.has(str as KnowledgePipelineStage)) return undefined;
  return str as KnowledgePipelineStage;
}

function optionalQualityStatus(value: unknown): KnowledgeFrontmatter['quality_status'] {
  if (value === undefined) return undefined;
  const str = String(value).trim();
  if (!qualityStatuses.has(str as NonNullable<KnowledgeFrontmatter['quality_status']>)) return undefined;
  return str as NonNullable<KnowledgeFrontmatter['quality_status']>;
}

function optionalReviewStatus(value: unknown): KnowledgeFrontmatter['review_status'] {
  if (value === undefined) return undefined;
  const str = String(value).trim();
  if (!reviewStatuses.has(str as NonNullable<KnowledgeFrontmatter['review_status']>)) return undefined;
  return str as NonNullable<KnowledgeFrontmatter['review_status']>;
}

function optionalReviewAction(value: unknown): KnowledgeFrontmatter['review_action'] {
  if (value === undefined) return undefined;
  const str = String(value).trim();
  if (!reviewActions.has(str as KnowledgeCaseReviewAction)) return undefined;
  return str as KnowledgeFrontmatter['review_action'];
}

function optionalReviewSource(value: unknown): 'cli' | 'runtime' | 'api' | undefined {
  if (value === undefined) return undefined;
  const str = String(value).trim();
  if (str !== 'cli' && str !== 'runtime' && str !== 'api') return undefined;
  return str;
}

import * as z from 'zod/v4';
import type { HistoricalCaseMcpServerCapability } from './contracts.js';
import { boundCaseDetails } from '../mcp-servers/redmine/redmine-api/bounding.js';
import type { RedmineIssueCaseDetails } from '../mcp-servers/redmine/contracts.js';

const MAX_MCP_RESULT_CHARS = 20_000;
const MAX_HISTORICAL_CASE_RESULT_CHARS = 48_000;

export interface McpContentLocator {
  kind: 'image' | 'audio' | 'blob';
  locator: string;
  mimeType?: string;
  sizeBytes: number;
}

export interface NormalizedMcpResult {
  text: string;
  structuredContent?: string;
  locators: McpContentLocator[];
  truncated: boolean;
}

export function normalizeMcpResult(
  value: unknown,
  capability?: HistoricalCaseMcpServerCapability,
): NormalizedMcpResult {
  if (capability?.type === 'historical_case' && capability.provider === 'redmine') {
    return normalizeHistoricalCaseMcpResult(value);
  }
  const result = objectValue(value);
  const content = Array.isArray(result.content) ? result.content : [];
  const textParts: string[] = [];
  const locators: McpContentLocator[] = [];

  for (const [index, itemValue] of content.entries()) {
    const item = objectValue(itemValue);
    if (item.type === 'text' && typeof item.text === 'string') {
      textParts.push(item.text);
      continue;
    }
    if ((item.type === 'image' || item.type === 'audio') && typeof item.data === 'string') {
      locators.push({
        kind: item.type,
        locator: `mcp://content/${index}`,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        sizeBytes: base64Size(item.data),
      });
      continue;
    }
    if (item.type === 'resource') {
      const resource = objectValue(item.resource);
      if (typeof resource.text === 'string') {
        textParts.push(resource.text);
      } else if (typeof resource.blob === 'string') {
        locators.push({
          kind: 'blob',
          locator: typeof resource.uri === 'string' ? resource.uri : `mcp://content/${index}`,
          mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : undefined,
          sizeBytes: base64Size(resource.blob),
        });
      }
    }
  }

  const text = redactMcpText(textParts.join('\n'));
  const structured = result.structuredContent === undefined
    ? undefined
    : redactMcpText(safeJson(result.structuredContent));
  const textBudget = structured ? Math.floor(MAX_MCP_RESULT_CHARS * 0.75) : MAX_MCP_RESULT_CHARS;
  const boundedText = text.slice(0, textBudget);
  const remaining = MAX_MCP_RESULT_CHARS - boundedText.length;
  const boundedStructured = structured?.slice(0, remaining);
  return {
    text: boundedText,
    structuredContent: boundedStructured,
    locators,
    truncated: text.length > boundedText.length || Boolean(structured && structured.length > (boundedStructured?.length ?? 0)),
  };
}

const HistoricalCandidateSchema = z.object({
  issueId: z.number().int().positive(),
  subject: z.string().max(300),
  descriptionExcerpt: z.string().max(1_000),
  tracker: z.string().max(120).optional(),
  status: z.string().max(120).optional(),
  priority: z.string().max(120).optional(),
  fixedVersion: z.string().max(120).optional(),
  updatedAt: z.string().max(40).optional(),
  sourceLocator: z.string().regex(/^redmine:issue:\d+$/u),
}).strict();

const HistoricalBlockSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(['description', 'custom_field', 'journal', 'status_change', 'relation', 'attachment_metadata']),
  label: z.string().max(120).optional(),
  text: z.string().max(8_000).optional(),
  occurredAt: z.string().max(40).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const HistoricalDetailSchema = z.object({
  issueId: z.number().int().positive(),
  subject: z.string().max(300),
  tracker: z.string().max(120).optional(),
  status: z.string().max(120).optional(),
  priority: z.string().max(120).optional(),
  fixedVersion: z.string().max(120).optional(),
  updatedAt: z.string().max(40).optional(),
  sourceLocator: z.string().regex(/^redmine:issue:\d+$/u),
  evidenceBlocks: z.array(HistoricalBlockSchema).max(200),
}).strict();

const HistoricalSearchResultSchema = z.union([
  z.object({
    status: z.literal('completed'),
    searchId: z.string().min(1).max(128),
    candidates: z.array(HistoricalCandidateSchema).max(10),
  }).strict(),
  z.object({ status: z.literal('no_hit'), candidates: z.tuple([]) }).strict(),
  z.object({
    status: z.enum(['timeout', 'failed']),
    candidates: z.tuple([]),
    safeErrorCode: z.string().min(1).max(80),
  }).strict(),
]);

const HistoricalDetailResultSchema = z.union([
  z.object({
    status: z.literal('completed'),
    details: z.array(HistoricalDetailSchema).max(3),
    omittedBlocks: z.number().int().nonnegative(),
    truncated: z.boolean(),
    originalCharacters: z.number().int().nonnegative(),
    outputCharacters: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    status: z.enum(['timeout', 'failed']),
    details: z.tuple([]),
    safeErrorCode: z.string().min(1).max(80),
  }).strict(),
]);

function normalizeHistoricalCaseMcpResult(value: unknown): NormalizedMcpResult {
  const result = objectValue(value);
  const content = Array.isArray(result.content) ? result.content : [];
  const text = redactMcpText(content.flatMap((itemValue) => {
    const item = objectValue(itemValue);
    return item.type === 'text' && typeof item.text === 'string' ? [item.text] : [];
  }).join('\n')).slice(0, 1_000);
  const structuredValue = result.structuredContent;
  const search = HistoricalSearchResultSchema.safeParse(structuredValue);
  if (search.success) {
    return {
      text,
      structuredContent: JSON.stringify(search.data),
      locators: [],
      truncated: false,
    };
  }
  const detail = HistoricalDetailResultSchema.safeParse(structuredValue);
  if (!detail.success) {
    return { text, locators: [], truncated: true };
  }
  if (detail.data.status !== 'completed') {
    return {
      text,
      structuredContent: JSON.stringify(detail.data),
      locators: [],
      truncated: false,
    };
  }
  let budget = MAX_HISTORICAL_CASE_RESULT_CHARS - 256;
  let bounded = boundCaseDetails(
    detail.data.details as RedmineIssueCaseDetails[],
    budget,
  );
  let structured = JSON.stringify({ status: 'completed', ...bounded });
  while (Array.from(structured).length > MAX_HISTORICAL_CASE_RESULT_CHARS && budget > 512) {
    budget -= Math.max(256, Array.from(structured).length - MAX_HISTORICAL_CASE_RESULT_CHARS);
    bounded = boundCaseDetails(detail.data.details as RedmineIssueCaseDetails[], budget);
    structured = JSON.stringify({ status: 'completed', ...bounded });
  }
  if (Array.from(structured).length > MAX_HISTORICAL_CASE_RESULT_CHARS) {
    return { text, locators: [], truncated: true };
  }
  return {
    text,
    structuredContent: structured,
    locators: [],
    truncated: bounded.truncated || detail.data.truncated,
  };
}

export function redactMcpText(value: string): string {
  return value
    .replace(/authorization\s*[:=]\s*(?:bearer\s+)?[^;,\n]+/gi, '[redacted]')
    .replace(/"?(?:token|password|passwd|cookie|secret|api[_-]?key)"?\s*[:=]\s*"?[^",;\s}]+"?/gi, '[redacted]')
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, '[path]');
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable structured content]';
  }
}

function base64Size(value: string): number {
  try {
    return Buffer.from(value, 'base64').length;
  } catch {
    return 0;
  }
}

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dirtyFlagPath,
  pipelinePublishRoot,
  pipelineReviewRoot,
  publishReportPath,
  qualityReportPath,
  sourceReviewRecordPath,
  knowledgeRoot,
} from './paths.js';
import { parseMarkdownDocument } from './frontmatter.js';
import { readKnowledgeQualityReport, type KnowledgeQualityGate } from './quality.js';
import { readDraftSlices } from './slicer.js';
import type {
  KnowledgeFrontmatter,
  KnowledgePipelineStatus,
  KnowledgePublishReport,
  KnowledgeSliceReviewRecord,
  KnowledgeStatus,
} from './types.js';

export interface ReviewDraftSlicesInput {
  workspaceRoot: string;
  sourceDocumentId: string;
  action: 'approve' | 'reject' | 'request_edits' | 'accept_warnings';
  reviewer: string;
  notes: string;
  ids?: string[];
}

export function reviewDraftSlices(input: ReviewDraftSlicesInput): KnowledgeSliceReviewRecord {
  if (!input.reviewer || input.reviewer.trim() === '') {
    throw new Error('reviewer is required');
  }
  if (!['approve', 'reject', 'request_edits', 'accept_warnings'].includes(input.action)) {
    throw new Error(`invalid review action: ${input.action}`);
  }
  if (input.action === 'accept_warnings' && input.notes.trim() === '') {
    throw new Error('accept_warnings requires explicit notes or quality issue id');
  }

  const draftRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts', input.sourceDocumentId);
  if (!existsSync(draftRoot)) {
    throw new Error(`No draft slices found for source ${input.sourceDocumentId}`);
  }

  const slices = readDraftSlices(input.workspaceRoot, input.sourceDocumentId);
  const targetSlices = input.ids?.length
    ? slices.filter((s) => input.ids?.some((id) => s.content.includes(`id: ${id}`)))
    : slices;

  const reviewedIds: string[] = [];
  const previousStatuses: string[] = [];
  const nextStatuses: string[] = [];
  const reviewId = `rev_${Date.now()}`;

  for (const slice of targetSlices) {
    const parsed = parseMarkdownDocument(slice.content, slice.path);
    const previousStatus = parsed.frontmatter.pipeline_status ?? 'draft';
    const nextStatus = computeNextStatus(previousStatus, input.action);
    parsed.frontmatter.pipeline_status = nextStatus as KnowledgePipelineStatus;
    if (input.action === 'reject') {
      parsed.frontmatter.quality_status = 'error';
    } else if (input.action === 'accept_warnings') {
      parsed.frontmatter.quality_status = 'warn';
    }
    if (input.action === 'approve' || input.action === 'accept_warnings') {
      parsed.frontmatter.status = 'draft' as KnowledgeStatus;
    } else if (input.action === 'reject') {
      parsed.frontmatter.status = 'review_required' as KnowledgeStatus;
    } else {
      parsed.frontmatter.status = 'review_required' as KnowledgeStatus;
    }
    parsed.frontmatter.review_id = reviewId;
    parsed.frontmatter.reviewer = input.reviewer;
    parsed.frontmatter.reviewed_at = new Date().toISOString().slice(0, 10);
    parsed.frontmatter.review_notes = input.notes;
    parsed.frontmatter.review_status = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'pending';
    parsed.frontmatter.review_action = input.action;
    parsed.frontmatter.review_source = 'runtime';
    const serialized = serializeFrontmatter(parsed.frontmatter as unknown as Record<string, unknown>, parsed.body);
    writeFileSync(slice.path, serialized, 'utf8');
    reviewedIds.push(parsed.frontmatter.id);
    previousStatuses.push(previousStatus);
    nextStatuses.push(nextStatus);
  }

  const record: KnowledgeSliceReviewRecord = {
    reviewId,
    sourceDocumentId: input.sourceDocumentId,
    reviewer: input.reviewer,
    action: input.action,
    notes: input.notes,
    reviewedIds,
    previousStatuses,
    nextStatuses,
    qualityIssueIds: input.action === 'accept_warnings' ? ['manual_note'] : [],
    reviewedAt: new Date().toISOString(),
  };

  mkdirSync(pipelineReviewRoot(input.workspaceRoot), { recursive: true });
  writeFileSync(
    sourceReviewRecordPath(input.workspaceRoot, input.sourceDocumentId),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
  return record;
}

function computeNextStatus(current: string, action: string): string {
  if (action === 'approve') return 'approved';
  if (action === 'reject') return 'rejected';
  if (action === 'request_edits') return 'review_required';
  if (action === 'accept_warnings') return 'approved';
  return current;
}

export interface PublishApprovedDraftSlicesInput {
  workspaceRoot: string;
  sourceDocumentId?: string;
  qualityGate?: KnowledgeQualityGate;
}

export function publishApprovedDraftSlices(input: PublishApprovedDraftSlicesInput): KnowledgePublishReport {
  const gate: KnowledgeQualityGate = input.qualityGate ?? 'warn';
  const quality = readKnowledgeQualityReport(input.workspaceRoot);
  const publishId = `pub_${Date.now()}`;
  const publishedIds: string[] = [];
  const rejectedIds: string[] = [];
  const warningOverrides: KnowledgePublishReport['warningOverrides'] = [];
  const sourceDocumentIds: string[] = [];
  const outputPaths: string[] = [];

  const draftsRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) {
    return writePublishReport(input.workspaceRoot, {
      version: 1,
      generatedAt: new Date().toISOString(),
      publishId,
      publishedIds,
      rejectedIds,
      warningOverrides,
      sourceDocumentIds,
      outputPaths,
      indexDirty: false,
      qualityReportPath: quality ? qualityReportPath(input.workspaceRoot) : undefined,
      qualityReportGeneratedAt: quality?.generatedAt,
    });
  }

  const sourceDirs = readdirSync(draftsRoot).filter((name: string) => {
    const fullPath = join(draftsRoot, name);
    return statSync(fullPath).isDirectory();
  });

  for (const sourceDir of sourceDirs) {
    if (input.sourceDocumentId && sourceDir !== input.sourceDocumentId) continue;
    sourceDocumentIds.push(sourceDir);
    const slices = readDraftSlices(input.workspaceRoot, sourceDir);
    for (const slice of slices) {
      const parsed = parseMarkdownDocument(slice.content, slice.path);
      if (parsed.frontmatter.pipeline_status === 'approved') {
        const blockReason = publishBlockReason(parsed.frontmatter, quality, gate);
        if (blockReason) {
          rejectedIds.push(parsed.frontmatter.id);
          warningOverrides.push({ documentId: parsed.frontmatter.id, issueId: 'quality_gate', reason: blockReason });
          continue;
        }
        const published = publishOneDraft(input.workspaceRoot, sourceDir, parsed.frontmatter, parsed.body, publishId, Boolean(quality));
        if (published) {
          publishedIds.push(parsed.frontmatter.id);
          outputPaths.push(published.outputPath);
        }
      } else {
        // Not approved: not yet publishable
      }
    }
  }

  const indexDirty = publishedIds.length > 0;
  if (indexDirty) {
    // Mark dirty so next update rebuilds indexes
    mkdirSync(join(input.workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
    writeFileSync(dirtyFlagPath(input.workspaceRoot), new Date().toISOString(), 'utf8');
  }

  return writePublishReport(input.workspaceRoot, {
    version: 1,
    generatedAt: new Date().toISOString(),
    publishId,
    publishedIds,
    rejectedIds,
    warningOverrides,
    sourceDocumentIds,
    outputPaths,
    indexDirty,
    qualityReportPath: quality ? qualityReportPath(input.workspaceRoot) : undefined,
    qualityReportGeneratedAt: quality?.generatedAt,
  });
}

function publishBlockReason(
  frontmatter: KnowledgeFrontmatter,
  quality: ReturnType<typeof readKnowledgeQualityReport>,
  gate: KnowledgeQualityGate,
): string | undefined {
  if (frontmatter.quality_status === 'error') return 'quality_status=error blocks publish';
  if (!quality && gate !== 'off') return 'quality audit report is required before publish';
  if (!quality || gate === 'off') return undefined;
  const issues = quality.issues.filter((i) => i.documentId === frontmatter.id);
  const hasError = issues.some((i) => i.severity === 'error');
  if (hasError) return 'error severity quality issue blocks publish';
  const hasWarn = issues.some((i) => i.severity === 'warn');
  if (gate === 'strict' && (frontmatter.quality_status === 'warn' || hasWarn)) {
    return 'strict quality gate blocks warning quality issues';
  }
  return undefined;
}

interface PublishedSliceResult {
  outputPath: string;
}

function publishOneDraft(
  workspaceRoot: string,
  sourceDocumentId: string,
  frontmatter: KnowledgeFrontmatter,
  body: string,
  publishId: string,
  auditWasAvailable: boolean,
): PublishedSliceResult | null {
  const moduleName = String(frontmatter.module ?? 'general');
  const sourceTitle = String(frontmatter.title ?? 'slice');
  const slug = safeSlug(sourceTitle);
  const targetDir = join(knowledgeRoot(workspaceRoot), 'whitepapers', moduleName, sourceDocumentId);
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `${slug}.md`);
  const updated: KnowledgeFrontmatter = {
    ...frontmatter,
    status: 'active',
    pipeline_status: 'published',
    publish_id: publishId,
    quality_status: frontmatter.quality_status === 'unchecked' && auditWasAvailable ? 'ok' : frontmatter.quality_status ?? 'unchecked',
  };
  const serialized = serializeFrontmatter(updated as unknown as Record<string, unknown>, body);
  writeFileSync(targetPath, serialized, 'utf8');
  return { outputPath: targetPath.replace(`${workspaceRoot}/`, '') };
}

function writePublishReport(workspaceRoot: string, report: KnowledgePublishReport): KnowledgePublishReport {
  mkdirSync(pipelinePublishRoot(workspaceRoot), { recursive: true });
  writeFileSync(publishReportPath(workspaceRoot), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  return `---\n${toYaml(fm)}\n---\n\n${body.trim()}\n`;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    return /[:#\[\]{},"']|\s$|^\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((item) => `${pad}- ${toYaml(item, indent + 1)}`).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => {
      if (Array.isArray(v) || (v && typeof v === 'object')) {
        return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${toYaml(v, indent + 1)}`;
    }).join('\n');
  }
  return String(value);
}

function safeSlug(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || createHash('sha1').update(value).digest('hex').slice(0, 12);
}

// Re-export helper for tests
export const __testing = { computeNextStatus, serializeFrontmatter, toYaml };

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  pipelineRepairPlansRoot,
  qualityReportPath,
  repairPlanPath,
  repairResultPath,
  sourceDraftRoot,
} from './paths.js';
import { parseMarkdownDocument } from './frontmatter.js';
import { readKnowledgeQualityReport, writeKnowledgeQualityReport } from './quality.js';
import { readDraftSlices } from './slicer.js';
import type {
  KnowledgeRepairAction,
  KnowledgeRepairActionType,
  KnowledgeRepairPlan,
  KnowledgeRepairResult,
  KnowledgeRepairSafety,
} from './types.js';

interface GeneratePlanInput {
  workspaceRoot: string;
  qualityReportPath?: string;
}

export function generateKnowledgeRepairPlan(input: GeneratePlanInput): KnowledgeRepairPlan {
  const reportPath = input.qualityReportPath ?? qualityReportPath(input.workspaceRoot);
  const quality = existsSync(reportPath) ? readKnowledgeQualityReport(input.workspaceRoot) : undefined;
  if (!quality) {
    return emptyPlan(reportPath);
  }

  const actions: KnowledgeRepairAction[] = [];
  const issueToAction = new Map<string, KnowledgeRepairAction>();
  let counter = 0;
  const nextActionId = (): string => `act_${Date.now()}_${String(++counter).padStart(4, '0')}`;

  for (const issue of quality.issues) {
    if (!issue.documentId) {
      continue;
    }
    const mapping = mapIssueToAction(issue);
    if (!mapping) {
      continue;
    }
    const existing = issueToAction.get(`${issue.documentId}:${mapping.actionType}`);
    if (existing) {
      existing.issueIds.push(issue.code);
      continue;
    }
    const action: KnowledgeRepairAction = {
      actionId: nextActionId(),
      issueIds: [issue.code],
      actionType: mapping.actionType,
      targetPaths: issue.source ? [issue.source] : [],
      targetIds: [issue.documentId],
      beforeSummary: mapping.beforeSummary(issue),
      afterSummary: mapping.afterSummary(issue),
      safety: mapping.safety,
      requiresHumanReview: mapping.safety === 'review_required',
      details: mapping.details(issue),
    };
    actions.push(action);
    issueToAction.set(`${issue.documentId}:${mapping.actionType}`, action);
  }

  return {
    version: 1,
    planId: `plan_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    sourceReportPaths: [reportPath],
    qualityReportPath: reportPath,
    actions,
    summary: {
      safe: actions.filter((a) => a.safety === 'safe').length,
      reviewRequired: actions.filter((a) => a.safety === 'review_required').length,
      total: actions.length,
    },
    safetySummary: {
      safe: actions.filter((a) => a.safety === 'safe').length,
      reviewRequired: actions.filter((a) => a.safety === 'review_required').length,
    },
  };
}

function emptyPlan(reportPath: string): KnowledgeRepairPlan {
  return {
    version: 1,
    planId: `plan_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    sourceReportPaths: reportPath ? [reportPath] : [],
    qualityReportPath: reportPath,
    actions: [],
    summary: { safe: 0, reviewRequired: 0, total: 0 },
    safetySummary: { safe: 0, reviewRequired: 0 },
  };
}

function mapIssueToAction(issue: { code: string; documentId?: string }): {
  actionType: KnowledgeRepairActionType;
  safety: KnowledgeRepairSafety;
  beforeSummary: (i: { code: string; documentId?: string }) => string;
  afterSummary: (i: { code: string; documentId?: string }) => string;
  details: (i: { code: string; documentId?: string }) => Record<string, unknown>;
} | undefined {
  switch (issue.code) {
    case 'too_short':
      return {
        actionType: 'merge_adjacent_short_slices',
        safety: 'safe',
        beforeSummary: () => 'Two adjacent short slices in the same section.',
        afterSummary: () => 'Merge adjacent short slices when source block order allows.',
        details: () => ({}),
      };
    case 'too_long':
      return {
        actionType: 'split_oversized_slice',
        safety: 'review_required',
        beforeSummary: () => 'Slice exceeds parent char limit; needs split on heading/list/table boundary.',
        afterSummary: () => 'Mark slice as manual_review_required for splitting.',
        details: () => ({}),
      };
    case 'duplicate_content':
      return {
        actionType: 'remove_duplicate_draft',
        safety: 'review_required',
        beforeSummary: () => 'Draft slice content duplicates another draft slice.',
        afterSummary: () => 'Mark for review; do not auto-delete published slices.',
        details: () => ({}),
      };
    case 'missing_section_path':
      return {
        actionType: 'add_section_path',
        safety: 'safe',
        beforeSummary: () => 'Section path is missing.',
        afterSummary: () => 'Inherit section path from source heading block provenance.',
        details: () => ({}),
      };
    case 'low_signal_terms':
      return {
        actionType: 'add_related_terms',
        safety: 'safe',
        beforeSummary: () => 'Related terms are too few to be searchable.',
        afterSummary: () => 'Backfill related_terms from title, section path, and module aliases.',
        details: () => ({}),
      };
    case 'multi_topic_slice':
    case 'broken_coreference':
    case 'table_lost':
    case 'missing_source_block_ids':
    case 'missing_source_blocks':
    case 'duplicate_paragraphs':
    case 'heading_structure_broken':
    case 'too_many_unknown_blocks':
    case 'toc_not_removed':
    case 'header_footer_noise':
    case 'list_structure_lost':
    case 'parser_empty':
    case 'source_provenance_missing':
      return {
        actionType: 'manual_review_required',
        safety: 'review_required',
        beforeSummary: () => 'Issue requires human review before any structural fix.',
        afterSummary: () => 'Mark slice as review_required; do not auto-apply.',
        details: () => ({}),
      };
    case 'empty_body':
    case 'heading_only':
    case 'toc_like':
    case 'not_answer_bearing':
      return {
        actionType: 'mark_review_required',
        safety: 'safe',
        beforeSummary: () => 'Slice content cannot justify a direct answer.',
        afterSummary: () => 'Set pipeline_status=review_required and skip from publish gate.',
        details: () => ({}),
      };
    default:
      return undefined;
  }
}

export function writeKnowledgeRepairPlan(input: { workspaceRoot: string; plan: KnowledgeRepairPlan; timestamp?: string }): string {
  const ts = input.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(pipelineRepairPlansRoot(input.workspaceRoot), { recursive: true });
  const path = repairPlanPath(input.workspaceRoot, ts);
  writeFileSync(path, `${JSON.stringify(input.plan, null, 2)}\n`, 'utf8');
  return path;
}

export function readKnowledgeRepairPlan(planPath: string): KnowledgeRepairPlan | undefined {
  if (!existsSync(planPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(planPath, 'utf8')) as KnowledgeRepairPlan;
  } catch {
    return undefined;
  }
}

export function applyKnowledgeRepairPlan(input: { workspaceRoot: string; planPath: string }): KnowledgeRepairResult {
  const plan = readKnowledgeRepairPlan(input.planPath);
  if (!plan) {
    return {
      planId: 'unknown',
      appliedActions: [],
      skippedActions: [],
      changedFiles: [],
      rollbackNotes: ['plan missing or malformed'],
      generatedAt: new Date().toISOString(),
    };
  }

  const applied: KnowledgeRepairAction[] = [];
  const skipped: KnowledgeRepairAction[] = [];
  const changedFiles: KnowledgeRepairResult['changedFiles'] = [];
  const rollbackNotes: string[] = [];

  for (const action of plan.actions) {
    if (action.safety !== 'safe') {
      skipped.push(action);
      continue;
    }

    for (const target of action.targetPaths) {
      if (!isUnderKnowledge(input.workspaceRoot, target)) {
        skipped.push(action);
        rollbackNotes.push(`Skipped ${action.actionId}: path ${target} is outside knowledge/`);
        continue;
      }
      const fullPath = join(input.workspaceRoot, target);
      if (!existsSync(fullPath)) {
        skipped.push(action);
        continue;
      }
      const previousHash = sha256File(fullPath);
      if (action.actionType === 'merge_adjacent_short_slices') {
        const mergeResult = applyMergeAdjacentShortSlices(input.workspaceRoot, target, action);
        if (mergeResult.changedFiles.length === 0) {
          skipped.push(action);
          if (mergeResult.reason) {
            rollbackNotes.push(`Skipped ${action.actionId}: ${mergeResult.reason}`);
          }
          continue;
        }
        changedFiles.push(...mergeResult.changedFiles);
        applied.push(action);
        continue;
      }
      const newContent = applyActionToFile(fullPath, action);
      if (newContent === null) {
        skipped.push(action);
        continue;
      }
      writeFileSync(fullPath, newContent, 'utf8');
      const newHash = sha256File(fullPath);
      changedFiles.push({ path: target, previousHash, newHash });
      applied.push(action);
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const result: KnowledgeRepairResult = {
    planId: plan.planId,
    appliedActions: applied,
    skippedActions: skipped,
    changedFiles,
    rollbackNotes,
    generatedAt: new Date().toISOString(),
  };

  mkdirSync(pipelineRepairPlansRoot(input.workspaceRoot), { recursive: true });
  writeFileSync(repairResultPath(input.workspaceRoot, ts), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function applyMergeAdjacentShortSlices(
  workspaceRoot: string,
  target: string,
  action: KnowledgeRepairAction,
): { changedFiles: KnowledgeRepairResult['changedFiles']; reason?: string } {
  if (!target.includes('knowledge/_pipeline/drafts/')) {
    return { changedFiles: [], reason: 'merge_adjacent_short_slices only applies to draft slices' };
  }

  const fullPath = join(workspaceRoot, target);
  if (!existsSync(fullPath)) {
    return { changedFiles: [], reason: `target ${target} does not exist` };
  }

  const parsed = parseMarkdownDocument(readFileSync(fullPath, 'utf8'), fullPath);
  if (parsed.frontmatter.status === 'archived') {
    return { changedFiles: [], reason: `target ${target} is already archived` };
  }

  const candidate = findAdjacentMergeCandidate(fullPath, parsed.frontmatter.source_document_id);
  if (!candidate) {
    return { changedFiles: [], reason: `no adjacent draft candidate found for ${target}` };
  }

  const neighbor = parseMarkdownDocument(readFileSync(candidate, 'utf8'), candidate);
  if (neighbor.frontmatter.status === 'archived') {
    return { changedFiles: [], reason: `adjacent candidate ${candidate} is archived` };
  }

  const targetPreviousHash = sha256File(fullPath);
  const neighborPreviousHash = sha256File(candidate);
  const repairPlanIds = Array.from(new Set([...(parsed.frontmatter.repair_plan_ids ?? []), action.actionId]));
  parsed.frontmatter.repair_plan_ids = repairPlanIds;
  parsed.frontmatter.quality_status = parsed.frontmatter.quality_status === 'error' ? 'error' : 'warn';
  const mergedBody = [
    parsed.body.trim(),
    '## 合并的相邻短切片',
    neighbor.body.trim(),
  ].filter(Boolean).join('\n\n');

  neighbor.frontmatter.status = 'archived';
  neighbor.frontmatter.pipeline_status = 'review_required';
  neighbor.frontmatter.quality_status = 'warn';
  neighbor.frontmatter.repair_plan_ids = Array.from(new Set([...(neighbor.frontmatter.repair_plan_ids ?? []), action.actionId]));
  neighbor.frontmatter.review_notes = [
    neighbor.frontmatter.review_notes,
    `Merged into ${parsed.frontmatter.id} by ${action.actionId}.`,
  ].filter(Boolean).join(' ');

  writeFileSync(fullPath, serializeFrontmatter(parsed.frontmatter as unknown as Record<string, unknown>, mergedBody), 'utf8');
  writeFileSync(candidate, serializeFrontmatter(neighbor.frontmatter as unknown as Record<string, unknown>, neighbor.body), 'utf8');

  return {
    changedFiles: [
      { path: target, previousHash: targetPreviousHash, newHash: sha256File(fullPath) },
      { path: candidate.replace(`${workspaceRoot}/`, ''), previousHash: neighborPreviousHash, newHash: sha256File(candidate) },
    ],
  };
}

function findAdjacentMergeCandidate(fullPath: string, sourceDocumentId?: string): string | undefined {
  const dir = dirname(fullPath);
  const files = readdirSync(dir)
    .map((file) => join(dir, file))
    .filter((path) => path.endsWith('.md') && statSync(path).isFile())
    .sort();
  const index = files.indexOf(fullPath);
  if (index === -1) {
    return undefined;
  }
  const candidates = [files[index + 1], files[index - 1]].filter((path): path is string => Boolean(path));
  for (const candidate of candidates) {
    try {
      const parsed = parseMarkdownDocument(readFileSync(candidate, 'utf8'), candidate);
      if (parsed.frontmatter.status === 'archived') {
        continue;
      }
      if (!sourceDocumentId || parsed.frontmatter.source_document_id === sourceDocumentId) {
        return candidate;
      }
    } catch {
      // Ignore malformed adjacent drafts.
    }
  }
  return undefined;
}

function applyActionToFile(path: string, action: KnowledgeRepairAction): string | null {
  const original = readFileSync(path, 'utf8');
  switch (action.actionType) {
    case 'mark_review_required': {
      const parsed = parseMarkdownDocument(original, path);
      parsed.frontmatter.pipeline_status = 'review_required';
      parsed.frontmatter.quality_status = 'error';
      return serializeFrontmatter(parsed.frontmatter as unknown as Record<string, unknown>, parsed.body);
    }
    case 'add_section_path': {
      const parsed = parseMarkdownDocument(original, path);
      if (!parsed.frontmatter.section_path || parsed.frontmatter.section_path.length === 0) {
        parsed.frontmatter.section_path = [parsed.frontmatter.title];
      }
      return serializeFrontmatter(parsed.frontmatter as unknown as Record<string, unknown>, parsed.body);
    }
    case 'add_related_terms': {
      const parsed = parseMarkdownDocument(original, path);
      const terms = new Set(parsed.frontmatter.related_terms ?? []);
      terms.add(parsed.frontmatter.title);
      terms.add(parsed.frontmatter.module);
      parsed.frontmatter.related_terms = Array.from(terms);
      return serializeFrontmatter(parsed.frontmatter as unknown as Record<string, unknown>, parsed.body);
    }
    default:
      return null;
  }
}

function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  const yaml = toYaml(fm);
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return /[:#\[\]{},"']|\s$|^\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value.map((item) => `${pad}- ${toYaml(item, indent + 1)}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.map(([k, v]) => {
      if (Array.isArray(v) || (v && typeof v === 'object')) {
        return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${toYaml(v, indent + 1)}`;
    }).join('\n');
  }
  return String(value);
}

function isUnderKnowledge(workspaceRoot: string, target: string): boolean {
  const knowledgeRoot = join(workspaceRoot, 'knowledge');
  const fullPath = join(workspaceRoot, target);
  return fullPath.startsWith(knowledgeRoot + '/') || fullPath === knowledgeRoot;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Helpers exposed for tests
export const __testing = { isUnderKnowledge, applyActionToFile, serializeFrontmatter, toYaml };

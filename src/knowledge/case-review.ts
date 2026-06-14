import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { dirtyFlagPath, knowledgeRoot } from './paths.js';
import { parseMarkdownDocument } from './frontmatter.js';
import type { KnowledgeCaseReviewAction, KnowledgeCaseReviewRecord } from './types.js';

const SOLVED_CASES_PREFIX = 'knowledge/tickets/solved-cases/';
const UNRESOLVED_CASES_PREFIX = 'knowledge/tickets/unresolved-cases/';

export interface LoadSolvedCaseInput {
  workspaceRoot: string;
  pathOrId: string;
}

export interface SolvedCaseDraft {
  path: string;
  relativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function loadSolvedCaseDraft(input: LoadSolvedCaseInput): SolvedCaseDraft {
  const fullPath = resolveSolvedCasePath(input.workspaceRoot, input.pathOrId);
  if (!fullPath) {
    throw new Error(`Solved case path must be under ${SOLVED_CASES_PREFIX}`);
  }
  if (!existsSync(fullPath)) {
    throw new Error(`Solved case file not found: ${input.pathOrId}`);
  }
  const content = readFileSync(fullPath, 'utf8');
  const parsed = parseMarkdownDocument(content, fullPath);
  return {
    path: fullPath,
    relativePath: fullPath.replace(`${input.workspaceRoot}${sep}`, '').replaceAll(sep, '/'),
    frontmatter: parsed.frontmatter as unknown as Record<string, unknown>,
    body: parsed.body,
  };
}

export function approveSolvedCase(input: LoadSolvedCaseInput & { reviewer: string; notes: string }): KnowledgeCaseReviewRecord {
  return applyReviewAction({ ...input, action: 'approve' });
}

export function rejectSolvedCase(input: LoadSolvedCaseInput & { reviewer: string; notes: string }): KnowledgeCaseReviewRecord {
  return applyReviewAction({ ...input, action: 'reject' });
}

export function requestSolvedCaseEdits(input: LoadSolvedCaseInput & { reviewer: string; notes: string }): KnowledgeCaseReviewRecord {
  return applyReviewAction({ ...input, action: 'request_edits' });
}

export function convertSolvedToUnresolved(input: LoadSolvedCaseInput & { reviewer: string; notes: string }): KnowledgeCaseReviewRecord {
  return applyReviewAction({ ...input, action: 'convert_to_unresolved' });
}

function applyReviewAction(input: LoadSolvedCaseInput & { reviewer: string; notes: string; action: KnowledgeCaseReviewAction }): KnowledgeCaseReviewRecord {
  if (!input.reviewer || input.reviewer.trim() === '') {
    throw new Error('reviewer is required');
  }
  const draft = loadSolvedCaseDraft(input);
  const previousStatus = String(draft.frontmatter.status ?? 'review_required');
  const now = new Date().toISOString();
  const reviewedAt = now.slice(0, 10);
  const targetPath = computeTargetPath(draft.path, input.action, draft.frontmatter);

  // Update frontmatter
  const updated: Record<string, unknown> = { ...draft.frontmatter };
  updated.reviewer = input.reviewer;
  updated.reviewed_at = reviewedAt;
  updated.review_notes = input.notes;
  updated.review_status = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'pending';
  updated.review_action = input.action;
  updated.review_source = 'cli';

  if (input.action === 'approve') {
    updated.status = 'active';
    updated.type = 'solved_case';
    updated.source_type = 'solved_case';
    writeCaseFile(draft.path, updated, draft.body);
  } else if (input.action === 'reject') {
    updated.status = 'review_required';
    updated.type = 'solved_case';
    writeCaseFile(draft.path, updated, draft.body);
  } else if (input.action === 'request_edits') {
    updated.status = 'review_required';
    updated.type = 'solved_case';
    writeCaseFile(draft.path, updated, draft.body);
  } else if (input.action === 'convert_to_unresolved') {
    // Move to unresolved-cases/<module>/<filename>
    updated.type = 'unresolved_case';
    updated.source_type = 'unresolved_case';
    updated.status = 'active';
    const newPath = ensureUnresolvedPath(targetPath ?? draft.path, draft.path);
    if (!newPath) {
      throw new Error('Unable to compute unresolved path within knowledge root.');
    }
    mkdirSync(dirname(newPath), { recursive: true });
    const serialized = serializeFrontmatter(updated as unknown as Record<string, unknown>, draft.body);
    if (newPath !== draft.path) {
      // Write the unresolved-case content to the new path, then unlink the original.
      // Do NOT use renameSync here: that would move the old solved-case file over
      // the freshly written unresolved content and lose the status/type change.
      writeFileSync(newPath, serialized, 'utf8');
      try {
        unlinkSync(draft.path);
      } catch {
        // If the old file is already gone or on a different device, ignore.
      }
    } else {
      // Same path; just rewrite with the unresolved content.
      writeFileSync(newPath, serialized, 'utf8');
    }
  }

  // Mark index dirty
  mkdirSync(join(input.workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
  writeFileSync(dirtyFlagPath(input.workspaceRoot), now, 'utf8');

  const documentId = String(draft.frontmatter.id ?? basename(draft.path) ?? 'unknown');
  const record: KnowledgeCaseReviewRecord = {
    documentId,
    action: input.action,
    reviewer: input.reviewer,
    reviewedAt: now,
    notes: input.notes,
    previousStatus,
    nextStatus: String(updated.status ?? previousStatus),
    sourcePath: draft.relativePath,
    targetPath: targetPath && targetPath !== draft.path ? targetPath.replace(`${input.workspaceRoot}${sep}`, '').replaceAll(sep, '/') : undefined,
    createdAt: now,
  };

  // Write sidecar
  const sidecarPath = sidecarReviewPath(draft.path, input.action);
  mkdirSync(dirname(sidecarPath), { recursive: true });
  writeFileSync(sidecarPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  return record;
}

function resolveSolvedCasePath(workspaceRoot: string, pathOrId: string): string | undefined {
  const knowledge = knowledgeRoot(workspaceRoot);
  const fullPath = resolve(workspaceRoot, pathOrId);
  // Path traversal guard
  if (!fullPath.startsWith(knowledge + sep) && fullPath !== knowledge) {
    return undefined;
  }
  // Must be under solved-cases; use relative() to normalize leading separators.
  const rel = relative(knowledge, fullPath).replaceAll(sep, '/');
  if (!rel.startsWith('tickets/solved-cases/')) {
    return undefined;
  }
  return fullPath;
}

function computeTargetPath(currentPath: string, action: KnowledgeCaseReviewAction, frontmatter: Record<string, unknown>): string | undefined {
  if (action !== 'convert_to_unresolved') {
    return currentPath;
  }
  const moduleId = String(frontmatter.module ?? 'general');
  const fileName = basename(currentPath);
  const unresolvedRoot = dirname(currentPath).replace(/solved-cases.*$/, 'unresolved-cases');
  return join(unresolvedRoot, moduleId, fileName);
}

function ensureUnresolvedPath(targetPath: string, fallback: string): string | undefined {
  if (!targetPath) return undefined;
  // Ensure the target stays under knowledge/tickets/unresolved-cases
  if (targetPath.includes('tickets/unresolved-cases/')) {
    return targetPath;
  }
  return fallback;
}

function writeCaseFile(path: string, frontmatter: Record<string, unknown>, body: string): void {
  const serialized = serializeFrontmatter(frontmatter, body);
  writeFileSync(path, serialized, 'utf8');
}

function sidecarReviewPath(casePath: string, action: KnowledgeCaseReviewAction): string {
  const dir = dirname(casePath);
  const base = basename(casePath, '.md');
  const hash = createHash('sha1').update(`${base}:${Date.now()}:${action}`).digest('hex').slice(0, 8);
  return join(dir, `${base}.${action}.${hash}.review.json`);
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

// Re-export constants
export const __caseReviewPaths = { SOLVED_CASES_PREFIX, UNRESOLVED_CASES_PREFIX };

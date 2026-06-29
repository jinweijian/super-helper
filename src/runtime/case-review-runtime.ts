import {
  approveSolvedCase,
  convertSolvedToUnresolved,
  loadSolvedCaseDraft,
  rejectSolvedCase,
  requestSolvedCaseEdits,
} from '../knowledge/case-review.js';
import type { KnowledgeCaseReviewAction, KnowledgeCaseReviewRecord } from '../knowledge/types.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/storage-scope.js';
import type { SuperHelperConfig } from '../config.js';
import type { CaseRuntimeEventRecorder } from './event-recorder.js';
import type { StoredCase } from '../sessions/file-memory-store.js';

export interface ReviewSolvedCaseInput {
  config: SuperHelperConfig;
  caseSession: StoredCase;
  workspaceId: string;
  workspaceRoot?: string;
  documentPath: string;
  action: KnowledgeCaseReviewAction;
  reviewer: string;
  notes: string;
}

export interface ReviewSolvedCaseResult {
  record: KnowledgeCaseReviewRecord;
}

export function reviewSolvedCase(input: ReviewSolvedCaseInput & { events: CaseRuntimeEventRecorder }): ReviewSolvedCaseResult {
  if (!input.action || !['approve', 'reject', 'request_edits', 'convert_to_unresolved'].includes(input.action)) {
    throw new Error(`Invalid review action: ${input.action}`);
  }
  if (!input.reviewer || input.reviewer.trim() === '') {
    throw new Error('reviewer is required');
  }
  if (!input.documentPath) {
    throw new Error('documentPath is required');
  }
  const workspaceRoot = input.workspaceRoot ?? resolveKnowledgeWorkspaceRoot(input.config, input.workspaceId);
  const events = input.events;
  events.caseReviewStarted(input.caseSession, {
    documentId: input.documentPath,
    action: input.action,
    reviewer: input.reviewer,
  });
  try {
    let record: KnowledgeCaseReviewRecord;
    if (input.action === 'approve') {
      record = approveSolvedCase({ workspaceRoot, pathOrId: input.documentPath, reviewer: input.reviewer, notes: input.notes });
    } else if (input.action === 'reject') {
      record = rejectSolvedCase({ workspaceRoot, pathOrId: input.documentPath, reviewer: input.reviewer, notes: input.notes });
    } else if (input.action === 'request_edits') {
      record = requestSolvedCaseEdits({ workspaceRoot, pathOrId: input.documentPath, reviewer: input.reviewer, notes: input.notes });
    } else {
      record = convertSolvedToUnresolved({ workspaceRoot, pathOrId: input.documentPath, reviewer: input.reviewer, notes: input.notes });
    }
    events.caseReviewResult(input.caseSession, {
      documentId: record.documentId,
      action: record.action,
      reviewer: record.reviewer,
      nextStatus: record.nextStatus,
      targetPath: record.targetPath,
    });
    return { record };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    events.caseReviewFailed(input.caseSession, { documentId: input.documentPath, reason });
    throw error;
  }
}

export const __testing = { validate: (input: { action: string; reviewer: string; documentPath: string }) => {
  if (!['approve', 'reject', 'request_edits', 'convert_to_unresolved'].includes(input.action)) {
    throw new Error('invalid action');
  }
  if (!input.reviewer?.trim()) {
    throw new Error('reviewer required');
  }
  if (!input.documentPath) {
    throw new Error('documentPath required');
  }
  return { ok: true };
} };

// Re-export for callers
export { loadSolvedCaseDraft };

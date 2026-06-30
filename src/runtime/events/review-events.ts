import type { DiagnosticLogEvent, DiagnosticResult, DiagnosticRun } from '../../domain.js';
import type { StoredCase } from '../../sessions/file-memory-store.js';
import type { ValidatedDiagnosticResult } from '../result-validator.js';
import { decisionFromDiagnosticResult } from '../review-gate.js';
import type { EventRecorderWriter } from './common.js';
import { evidenceIdsFromResult } from './common.js';
import { agentIdentities } from './identities.js';

export function recordFollowUpDiagnosticRequested(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  run: DiagnosticRun,
  result: DiagnosticResult,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.outputReview, {
    actor: 'agent',
    phase: 'follow_up_diagnostic_requested',
    label: '输出审核',
    severity: 'warn',
    summary: 'Agent 审核认为证据仍不足，自动追查一轮 Claude Code',
    detail: {
      previousRunId: run.id,
      reason: result.summary,
    },
  });
}

export function recordEvidenceReviewStarted(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  run: DiagnosticRun,
  result: DiagnosticResult,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.outputReview, {
    actor: 'agent',
    phase: 'evidence_review_started',
    label: '输出审核',
    severity: 'ok',
    summary: evidenceReviewStartedSummary(run, result),
    detail: {
      runId: run.id,
      status: result.status,
      summary: result.summary,
      missingInfo: result.missingInfo,
      recommendedNextAction: result.recommendedNextAction,
      evidenceIds: evidenceIdsFromResult(result),
      claimCount: result.claims.length,
      evidenceCount: result.evidence.length,
    },
  });
}

function evidenceReviewStartedSummary(run: DiagnosticRun, result: DiagnosticResult): string {
  if (run.workerTrace) {
    return 'Agent 开始审核 Claude Code 返回结果';
  }
  if (result.evidence.length > 0 && result.evidence.every((item) => item.kind === 'knowledge')) {
    return 'Agent 开始审核知识库直答结果';
  }
  return 'Agent 开始审核结构化证据结果';
}

export function recordEvidenceValidationResult(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  runId: string,
  validation: ValidatedDiagnosticResult,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.outputReview, {
    actor: 'agent',
    phase: 'evidence_validation_result',
    label: '确定性审核',
    severity: validation.issues.length > 0 ? 'warn' : 'ok',
    summary: `确定性审核冻结结果：接受 ${validation.acceptedClaimIds.length} 条，拒绝 ${validation.rejectedClaimIds.length} 条`,
    detail: {
      runId,
      frozenDecision: decisionFromDiagnosticResult(validation.result),
      issues: validation.issues,
      acceptedClaimIds: validation.acceptedClaimIds,
      rejectedClaimIds: validation.rejectedClaimIds,
    },
  });
}

export function recordCaseReviewStarted(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  detail: { documentId: string; action: string; reviewer: string },
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.caseCurator, {
    actor: 'agent',
    phase: 'case_review_started',
    label: 'Case 审核',
    severity: 'info',
    summary: `审核 ${detail.documentId} (${detail.action})`,
    detail,
  });
}

export function recordCaseReviewResult(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  detail: { documentId: string; action: string; reviewer: string; nextStatus: string; targetPath?: string },
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.caseCurator, {
    actor: 'agent',
    phase: 'case_review_result',
    label: 'Case 审核结果',
    severity: 'ok',
    summary: `${detail.documentId} 审核完成: ${detail.nextStatus}`,
    detail,
  });
}

export function recordCaseReviewFailed(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  detail: { documentId: string; reason: string },
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.caseCurator, {
    actor: 'agent',
    phase: 'case_review_failed',
    label: 'Case 审核失败',
    severity: 'error',
    summary: `${detail.documentId} 审核失败: ${detail.reason}`,
    detail,
  });
}

export function recordCaseResolutionConfirmed(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  message: string,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.caseCurator, {
    actor: 'agent',
    phase: 'resolution_confirmed',
    label: 'Case 沉淀',
    severity: 'ok',
    summary: '用户确认问题已解决，准备沉淀 solved case',
    detail: { message },
  });
}

export function recordCaseCuratorStarted(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.caseCurator, {
    actor: 'agent',
    phase: 'case_curator_started',
    label: 'Case 沉淀',
    severity: 'ok',
    summary: 'Case Curator 开始生成 solved case 草稿',
  });
}

export function recordCaseCuratorResult(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  detail: { documentId: string; path: string; moduleId: string; status: string; confidence: string },
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.caseCurator, {
    actor: 'agent',
    phase: 'case_curator_result',
    label: 'Case 沉淀',
    severity: 'ok',
    summary: 'Case Curator 已保存 review_required solved case 草稿并标记索引脏',
    detail,
  });
}

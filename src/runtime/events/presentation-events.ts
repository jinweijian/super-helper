import type { DiagnosticLogEvent } from '../../domain.js';
import { redactProviderErrorMessage } from '../../providers/redaction.js';
import type { StoredCase } from '../../sessions/file-memory-store.js';
import type { EventRecorderWriter } from './common.js';
import { agentIdentities } from './identities.js';

export interface ModelReviewParsed {
  answerTarget?: string;
  directAnswer?: string;
  reply?: string;
  claimIds?: string[];
  evidenceIds?: string[];
  directAnswerClaimIds?: string[];
}

export function recordModelReviewFailed(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  error: string,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.presentation, {
    actor: 'agent',
    phase: 'model_review_failed',
    label: '美化输出',
    severity: 'warn',
    summary: 'Presentation 模型回复未通过校验，降级到本地事实兜底',
    detail: { error },
  });
}

export function recordModelReviewResult(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  raw: string,
  parsed: ModelReviewParsed,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.presentation, {
    actor: 'agent',
    phase: 'model_review_result',
    label: '美化输出',
    severity: 'ok',
    summary: 'Presentation 模型完成 Answer Contract 回复整理',
    detail: {
      raw: redactProviderErrorMessage(raw).slice(0, 2000),
      parsed,
    },
  });
}

export function recordPresentationPrepared(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  decision: string,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.presentation, {
    actor: 'agent',
    phase: 'presentation_agent_result',
    label: '美观输出',
    severity: 'ok',
    summary: '美观输出 agent 完成最终回复整理',
    detail: {
      userPersona: caseSession.userPersona,
      decision,
    },
  });
}

export function recordPreflightReplyCreated(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  reply: string,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.presentation, {
    actor: 'agent',
    phase: 'user_reply',
    label: '最终输出',
    severity: 'warn',
    summary: 'Agent 向用户发起追问',
    detail: { reply, tag: '最终回答' },
  });
}

export function recordFinalReplyCreated(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  reply: string,
  decision: string,
): DiagnosticLogEvent {
  return recorder.recordAgent(caseSession, agentIdentities.presentation, {
    actor: 'agent',
    phase: 'user_reply',
    label: '最终输出',
    severity: decision === 'final' ? 'ok' : 'warn',
    summary: 'Agent 完成证据审核并回复用户',
    detail: { reply, decision, evidenceIds: [], tag: '最终回答' },
  });
}

import type { DiagnosticResult, DiagnosticRun, Evidence, UserPersona } from '../domain.js';
import type { FileMemoryStore, StoredCase } from '../storage.js';
import { validateDiagnosticResult } from './result-validator.js';

export interface ExperienceMatch {
  sourceCaseId: string;
  sourceMessageId: string;
  sourceReplyId: string;
  sourceRunId: string;
  question: string;
  reply: string;
  score: number;
  result: DiagnosticResult;
}

export interface RejectedExperienceCandidate {
  sourceCaseId: string;
  sourceMessageId: string;
  sourceReplyId?: string;
  sourceRunId?: string;
  score: number;
  rejectionReason: string;
}

export function findExperienceMatch(input: {
  store: FileMemoryStore;
  currentCase: StoredCase;
  userMessage: string;
}): ExperienceMatch | undefined {
  const normalized = normalizeQuestion(input.userMessage);
  if (normalized.length < 6) return undefined;

  return input.store
    .listCases(200)
    .filter((caseSession) => caseSession.id !== input.currentCase.id)
    .filter((caseSession) => caseSession.tenantId === input.currentCase.tenantId)
    .filter((caseSession) => caseSession.userId === input.currentCase.userId)
    .filter((caseSession) => caseSession.workspaceId === input.currentCase.workspaceId)
    .flatMap((caseSession) => pairsFromCase(caseSession, input.currentCase.userPersona, normalized))
    .sort((left, right) => right.score - left.score)[0];
}

export function findRejectedExperienceCandidates(input: {
  store: FileMemoryStore;
  currentCase: StoredCase;
  userMessage: string;
}): RejectedExperienceCandidate[] {
  const normalized = normalizeQuestion(input.userMessage);
  if (normalized.length < 6) return [];
  const candidates: RejectedExperienceCandidate[] = [];
  for (const caseSession of input.store.listCases(200)) {
    if (
      caseSession.id === input.currentCase.id ||
      caseSession.tenantId !== input.currentCase.tenantId ||
      caseSession.userId !== input.currentCase.userId ||
      caseSession.workspaceId !== input.currentCase.workspaceId
    ) continue;
    for (const message of caseSession.messages) {
      if (message.role !== 'user') continue;
      const score = similarity(normalized, normalizeQuestion(message.body));
      if (score < 0.92) continue;
      const reply = caseSession.messages.find((item) => item.role === 'helper' && item.replyToMessageId === message.id);
      if (!reply) {
        candidates.push({
          sourceCaseId: caseSession.id,
          sourceMessageId: message.id,
          score,
          rejectionReason: 'reply_not_attributable',
        });
        continue;
      }
      const sourceRun = findSourceRun(caseSession.runs, message.id, message.body);
      const rejectionReason = sourceRun
        ? reusabilityIssue(sourceRun, input.currentCase.userPersona)
        : 'run_not_attributable';
      if (rejectionReason) {
        candidates.push({
          sourceCaseId: caseSession.id,
          sourceMessageId: message.id,
          sourceReplyId: reply.id,
          sourceRunId: sourceRun?.id,
          score,
          rejectionReason,
        });
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score).slice(0, 5);
}

function pairsFromCase(
  caseSession: StoredCase,
  persona: UserPersona,
  normalizedQuestion: string,
): ExperienceMatch[] {
  const matches: ExperienceMatch[] = [];
  for (const message of caseSession.messages) {
    if (message.role !== 'user') continue;
    const score = similarity(normalizedQuestion, normalizeQuestion(message.body));
    if (score < 0.92) continue;
    const reply = caseSession.messages.find((item) => (
      item.role === 'helper' && item.replyToMessageId === message.id
    ));
    if (!reply) continue;
    const sourceRun = findSourceRun(caseSession.runs, message.id, message.body);
    if (!sourceRun?.result || !isReusableRun(sourceRun, persona)) continue;
    const evidence = sourceRun.result.evidence.slice(0, 6);
    matches.push({
      sourceCaseId: caseSession.id,
      sourceMessageId: message.id,
      sourceReplyId: reply.id,
      sourceRunId: sourceRun.id,
      question: message.body,
      reply: reply.body,
      score,
      result: {
        status: 'concluded',
        summary: `历史经验命中：${reply.body.slice(0, 240)}`,
        missingInfo: [],
        evidence: [
          {
            id: 'ev_history_match',
            kind: 'history',
            source: `${caseSession.id}/${message.id}/${sourceRun.id}`,
            summary: `历史会话中存在已验证的同问题回复，匹配分 ${score.toFixed(2)}。`,
            confidence: score >= 0.98 ? 'high' : 'medium',
            validation: {
              status: 'active',
              visibility: 'customer_safe',
              lastVerifiedAt: new Date().toISOString(),
              quality: 'ok',
            },
          },
          ...evidence.filter((item) => item.id !== 'ev_history_match'),
        ],
        claims: [
          {
            id: 'claim_history_reply',
            type: 'inference',
            text: reply.body,
            evidenceIds: evidence.map((item) => item.id),
          },
          {
            id: 'claim_history_match',
            type: 'fact',
            text: `历史会话 ${caseSession.id} 的 run ${sourceRun.id} 已回答高度相同的问题。`,
            evidenceIds: ['ev_history_match'],
          },
        ],
        recommendedNextAction: 'final_answer',
      },
    });
  }
  return matches;
}

function findSourceRun(runs: DiagnosticRun[], sourceMessageId: string, question: string): DiagnosticRun | undefined {
  const normalized = normalizeQuestion(question);
  const attributed = runs.filter((run) => (
    run.result && run.request?.context?.resolvedTurn?.sourceMessageIds.includes(sourceMessageId)
  ));
  if (attributed.length === 1) return attributed[0];
  if (attributed.length > 1) return undefined;
  const legacyMatches = runs.filter((run) => (
    run.result && run.request && similarity(normalized, normalizeQuestion(run.request.userGoal)) >= 0.92
  ));
  return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
}

function isReusableRun(run: DiagnosticRun, persona: UserPersona): boolean {
  return reusabilityIssue(run, persona) === undefined;
}

function reusabilityIssue(run: DiagnosticRun, persona: UserPersona): string | undefined {
  const result = run.result;
  if (!result || run.status !== 'concluded' || result.status !== 'concluded' || result.recommendedNextAction !== 'final_answer') {
    return 'run_not_final';
  }
  if (result.evidence.length === 0) return 'evidence_missing';
  if (result.evidence.some((evidence) => !isReusableEvidence(evidence, persona))) {
    return 'evidence_not_current_or_visible';
  }
  const validation = validateDiagnosticResult(result);
  if (validation.issues.length > 0 || validation.result.status !== 'concluded' || validation.result.recommendedNextAction !== 'final_answer') {
    return 'strict_review_failed';
  }
  return undefined;
}

function isReusableEvidence(evidence: Evidence, persona: UserPersona): boolean {
  if (evidence.confidence === 'low') return false;
  const validation = evidence.validation;
  if (!validation || validation.status !== 'active' || !validation.lastVerifiedAt || !validation.quality) return false;
  if (validation.quality && validation.quality !== 'ok' && validation.quality !== 'info') return false;
  if (validation.lastVerifiedAt) {
    const verifiedAt = Date.parse(validation.lastVerifiedAt);
    if (!Number.isFinite(verifiedAt) || (Date.now() - verifiedAt) / 86_400_000 > 180) return false;
  }
  const allowed = visibilityForPersona(persona);
  return !validation.visibility || allowed.includes(validation.visibility);
}

function visibilityForPersona(persona: UserPersona): Array<NonNullable<Evidence['validation']>['visibility']> {
  if (persona === 'customer') return ['customer_safe'];
  if (persona === 'operations') return ['customer_safe', 'internal'];
  return ['customer_safe', 'internal', 'support'];
}

function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aSet = bigrams(a);
  const bSet = bigrams(b);
  const intersection = [...aSet].filter((item) => bSet.has(item)).length;
  return intersection / (new Set([...aSet, ...bSet]).size || 1);
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

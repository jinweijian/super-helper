import type { DiagnosticResult, WorkerTrace } from '../domain.js';
import type { StoredCase } from '../storage.js';

export type AgentDecision = 'ask_user' | 'dispatched' | 'final' | 'partial' | 'escalate';

export function decisionFromReviewOutcome(
  outcome: 'ask_user' | 'partial' | 'final_answer' | 'escalate_to_human' | undefined,
  result: DiagnosticResult,
): AgentDecision {
  if (outcome === 'ask_user') {
    return 'ask_user';
  }
  if (outcome === 'final_answer') {
    return 'final';
  }
  if (outcome === 'escalate_to_human') {
    return 'escalate';
  }
  if (outcome === 'partial') {
    return 'partial';
  }
  return result.recommendedNextAction === 'final_answer' || result.status === 'concluded' ? 'final' : 'partial';
}

export function decisionFromDiagnosticResult(result: DiagnosticResult): AgentDecision {
  if (result.recommendedNextAction === 'final_answer' || result.status === 'concluded') {
    return 'final';
  }
  if (result.recommendedNextAction === 'escalate_to_human') {
    return 'escalate';
  }
  return 'partial';
}

export function caseStatusFromDiagnosticResult(result: DiagnosticResult): StoredCase['status'] {
  if (result.status === 'concluded') {
    return 'concluded';
  }
  if (result.status === 'need_input') {
    return 'need_input';
  }
  return 'partial';
}

export function shouldRunFollowUp(
  review: { reply: string; decision: AgentDecision },
  result: DiagnosticResult,
  trace: WorkerTrace,
): boolean {
  return review.decision === 'partial' && result.recommendedNextAction === 'continue_diagnosis' && !trace.error;
}

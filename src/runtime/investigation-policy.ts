import type { DiagnosticRequest, DiagnosticResult } from '../domain.js';
import type { InvestigationExecution, InvestigationPreference } from '../contracts/investigation.js';

export type InvestigationReason = 'manual_fast' | 'manual_deep' | 'bounded_candidates' | 'cross_module' | 'evidence_conflict' | 'historical_verification' | 'unbounded_search' | 'fast_review_incomplete';

export function resolveInvestigation(
  preference: InvestigationPreference,
  request: DiagnosticRequest,
  historical = false,
): { execution: InvestigationExecution; reasonCode: InvestigationReason } {
  let profile: 'fast' | 'deep' = 'fast';
  let reasonCode: InvestigationReason = 'bounded_candidates';
  if (preference !== 'auto') {
    profile = preference;
    reasonCode = preference === 'fast' ? 'manual_fast' : 'manual_deep';
  } else if (historical) {
    profile = 'deep';
    reasonCode = 'historical_verification';
  } else if (request.context?.knowledge?.judge?.conflicts?.length) {
    profile = 'deep';
    reasonCode = 'evidence_conflict';
  } else if ((request.context?.knowledge?.route?.moduleCandidates?.length ?? 0) > 1) {
    profile = 'deep';
    reasonCode = 'cross_module';
  } else if (!request.context?.deepQuery?.artifactTargets?.length) {
    profile = 'deep';
    reasonCode = 'unbounded_search';
  }
  return {
    execution: { requestedMode: preference, resolvedProfile: profile, attempt: 1, escalationAllowed: preference === 'auto' && profile === 'fast' },
    reasonCode,
  };
}

export function nextInvestigation(
  execution: InvestigationExecution,
  decision: string,
): InvestigationExecution | undefined {
  if (decision === 'final' || decision === 'escalate') return undefined;
  if (execution.requestedMode !== 'auto' || execution.resolvedProfile !== 'fast' || !execution.escalationAllowed || execution.attempt !== 1) return undefined;
  return { requestedMode: 'auto', resolvedProfile: 'deep', attempt: 2, escalationAllowed: false };
}

/** 仅消费 Review 冻结后的 evidence，ID 的变化不视作调查进展。 */
export function hasEvidenceProgress(request: DiagnosticRequest, reviewed: DiagnosticResult): boolean {
  const key = (evidence: DiagnosticResult['evidence'][number]) => JSON.stringify([evidence.kind, evidence.source, evidence.summary]);
  const previous = new Set((request.context?.previousRuns ?? []).flatMap(run => run.evidence.map(key)));
  return reviewed.evidence.some(evidence =>
    (evidence.kind === 'workspace' || evidence.kind === 'log') &&
    evidence.confidence !== 'low' && !previous.has(key(evidence)),
  );
}

import type { AnswerGoal, DiagnosticClaim, DiagnosticResult, Evidence } from '../../domain.js';
import type { HistoricalGateDecision, HistoricalGateResult } from './historical-case-gate.js';

export function buildCaseInvestigationResult(input: {
  answerGoal: AnswerGoal;
  gate: HistoricalGateResult;
  evidence: Evidence[];
  fallbackResult?: DiagnosticResult;
}): DiagnosticResult {
  const meaningful = input.gate.decisions.filter((item) => item.classification !== 'irrelevant');
  if (meaningful.length === 0 && input.fallbackResult) return structuredClone(input.fallbackResult);
  if (meaningful.length === 0) return unknownResult(input.answerGoal);

  const primary = [...meaningful].sort((left, right) => priority(right) - priority(left))[0];
  const claims = meaningful.map((decision, index) => claimFromDecision(
    decision,
    input.answerGoal,
    decision === primary,
    index,
  ));
  const usedEvidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
  const evidence = input.evidence.filter((item) => usedEvidenceIds.has(item.id));
  const confirmed = primary.classification === 'same_root_cause_likely' && input.gate.blockers.length === 0;
  return {
    status: confirmed ? 'concluded' : 'partial',
    summary: claims.find((claim) => claim.role === 'primary_answer')?.text ?? '历史案例未形成可验证结论。',
    missingInfo: confirmed ? [] : ['仍需当前项目证据确认最终根因。'],
    evidence,
    claims,
    recommendedNextAction: confirmed ? 'final_answer' : 'continue_diagnosis',
  };
}

function claimFromDecision(
  decision: HistoricalGateDecision,
  answerGoal: AnswerGoal,
  primary: boolean,
  index: number,
): DiagnosticClaim {
  const text = decision.classification === 'same_root_cause_likely'
    ? `当前项目证据与历史工单的关键特征一致，较可能属于同一根因：${decision.hypothesis}`
    : decision.classification === 'same_symptom_different_cause'
      ? `当前证据与相似历史工单存在关键差异，不能沿用该工单的根因结论；可继续核对：${decision.hypothesis}`
      : `初步排查方向：${decision.hypothesis}。当前证据不足，不能作为最终根因结论。`;
  return {
    id: `historical_claim_${index + 1}`,
    type: 'inference',
    role: primary ? 'primary_answer' : 'supporting_context',
    text,
    evidenceIds: decision.evidenceIds,
    answers: primary ? [...answerGoal.mustAnswerItems] : [],
  };
}

function unknownResult(answerGoal: AnswerGoal): DiagnosticResult {
  return {
    status: 'partial',
    summary: '本轮历史工单没有形成可验证的当前结论。',
    missingInfo: [...answerGoal.mustAnswerItems],
    evidence: [],
    claims: [{
      id: 'historical_unknown_1',
      type: 'unknown',
      role: 'unknown',
      text: '历史工单未提供足以确认当前问题的证据。',
      evidenceIds: [],
      answers: [],
    }],
    recommendedNextAction: 'continue_diagnosis',
  };
}

function priority(decision: HistoricalGateDecision): number {
  if (decision.classification === 'same_root_cause_likely') return 4;
  if (decision.classification === 'same_symptom_different_cause') return 3;
  if (decision.classification === 'diagnostic_lead_only') return 2;
  return 1;
}

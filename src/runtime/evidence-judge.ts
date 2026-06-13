import type { KnowledgeEvidencePack, KnowledgeEvidenceResult, KnowledgeRoute } from '../knowledge/index.js';

export interface EvidenceJudgeResult {
  answerable: boolean;
  confidence: 'low' | 'medium' | 'high';
  need_code_escalation: boolean;
  reason: string;
  evidence: string[];
  risks: string[];
  missing_info: string[];
  conflicts: string[];
  recommended_next_action: 'final_answer' | 'dispatch_code_diagnosis' | 'ask_user' | 'escalate_to_human';
  answer_score: number;
}

const sourceAuthority: Record<string, number> = {
  runbook: 0.9,
  faq: 0.9,
  whitepaper: 0.85,
  module_doc: 0.8,
  solved_case: 0.75,
  glossary: 0.45,
  unresolved_case: 0.25,
};

export function judgeKnowledgeEvidence(input: {
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  question: string;
}): EvidenceJudgeResult {
  const results = input.evidencePack.results;
  const risks = Array.from(new Set([...input.route.risks]));
  const conflicts = detectConflicts(results);
  const stale = results.filter((result) => isStale(result));
  const active = results.filter((result) => result.status === 'active');
  const nonActive = results.filter((result) => result.status !== 'active');
  const implementationSignals = input.route.codeEscalationSignals;

  if (implementationSignals.length > 0) {
    return {
      answerable: false,
      confidence: 'low',
      need_code_escalation: true,
      reason: `用户问题包含当前实现或错误线索：${implementationSignals.join('、')}，需要升级到只读代码调查。`,
      evidence: results.slice(0, 5).map((result) => result.evidence_id),
      risks: Array.from(new Set([...risks, 'implementation_detail'])),
      missing_info: ['当前实现证据'],
      conflicts,
      recommended_next_action: 'dispatch_code_diagnosis',
      answer_score: scoreResults(results, { conflicts, risks, stale }),
    };
  }

  if (results.length === 0) {
    return {
      answerable: false,
      confidence: 'low',
      need_code_escalation: true,
      reason: '知识库没有找到可用证据，需要升级到代码或其他证据源查询。',
      evidence: [],
      risks,
      missing_info: ['知识库命中证据'],
      conflicts: [],
      recommended_next_action: 'dispatch_code_diagnosis',
      answer_score: 0,
    };
  }

  const answerScore = scoreResults(results, { conflicts, risks, stale });
  if (conflicts.length > 0) {
    return {
      answerable: false,
      confidence: 'low',
      need_code_escalation: true,
      reason: '知识库命中的文档之间存在冲突，不能直接回答。',
      evidence: results.slice(0, 5).map((result) => result.evidence_id),
      risks,
      missing_info: ['冲突文档复核'],
      conflicts,
      recommended_next_action: 'dispatch_code_diagnosis',
      answer_score: answerScore,
    };
  }

  if (risks.length > 0) {
    return {
      answerable: false,
      confidence: answerScore >= 0.7 ? 'medium' : 'low',
      need_code_escalation: true,
      reason: `问题涉及高风险域：${risks.join('、')}，不能只依赖知识库直接回答。`,
      evidence: results.slice(0, 5).map((result) => result.evidence_id),
      risks,
      missing_info: ['高风险证据复核'],
      conflicts,
      recommended_next_action: 'escalate_to_human',
      answer_score: answerScore,
    };
  }

  if (stale.length > 0 && active.length === 0) {
    return {
      answerable: false,
      confidence: 'low',
      need_code_escalation: true,
      reason: '命中的知识文档已过期或待复核，不能作为高置信答案。',
      evidence: results.slice(0, 5).map((result) => result.evidence_id),
      risks: ['stale_knowledge'],
      missing_info: ['当前版本证据'],
      conflicts,
      recommended_next_action: 'dispatch_code_diagnosis',
      answer_score: answerScore,
    };
  }

  if (nonActive.length > 0 && (active.length === 0 || results[0]?.status !== 'active')) {
    return {
      answerable: false,
      confidence: 'low',
      need_code_escalation: true,
      reason: `命中的知识文档不是 active 状态：${Array.from(new Set(nonActive.map((result) => result.status))).join('、')}，不能作为直接回答证据。`,
      evidence: active.slice(0, 5).map((result) => result.evidence_id),
      risks: Array.from(new Set([...risks, 'non_active_knowledge'])),
      missing_info: ['active 知识证据'],
      conflicts,
      recommended_next_action: 'dispatch_code_diagnosis',
      answer_score: answerScore,
    };
  }

  const answerable = answerScore >= directAnswerThreshold(results);
  return {
    answerable,
    confidence: answerScore >= 0.78 ? 'high' : answerScore >= 0.6 ? 'medium' : 'low',
    need_code_escalation: !answerable,
    reason: answerable
      ? '知识库命中 active FAQ/runbook/whitepaper 证据，内容可支撑直接回答。'
      : '知识库有命中但分数不足，需要补充证据或升级查询。',
    evidence: results.slice(0, 5).map((result) => result.evidence_id),
    risks,
    missing_info: answerable ? [] : ['更高置信证据'],
    conflicts,
    recommended_next_action: answerable ? 'final_answer' : 'dispatch_code_diagnosis',
    answer_score: answerScore,
  };
}

function scoreResults(results: KnowledgeEvidenceResult[], state: {
  conflicts: string[];
  risks: string[];
  stale: KnowledgeEvidenceResult[];
}): number {
  if (results.length === 0) {
    return 0;
  }
  const top = results[0]!;
  const relevance = Math.min(1, Math.max(0.15, top.matched_terms.length / 4));
  const coverage = /faq|runbook|whitepaper|solved_case/.test(top.source_type) ? 0.85 : 0.45;
  const authority = sourceAuthority[top.source_type] ?? 0.4;
  const freshness = isStale(top) ? 0.35 : 0.9;
  const versionMatch = top.status === 'active' ? 0.8 : 0.45;
  const agreement = state.conflicts.length > 0 ? 0.2 : results.length > 1 ? 0.9 : 0.75;
  const actionability = /faq|runbook|solved_case/.test(top.source_type) ? 0.9 : 0.65;
  const conflictPenalty = state.conflicts.length > 0 ? 0.25 : 0;
  const riskPenalty = state.risks.length > 0 ? 0.2 : 0;
  const stalePenalty = state.stale.length > 0 ? 0.12 : 0;
  const score =
    0.25 * relevance +
    0.20 * coverage +
    0.15 * authority +
    0.10 * freshness +
    0.10 * versionMatch +
    0.10 * agreement +
    0.10 * actionability -
    conflictPenalty -
    riskPenalty -
    stalePenalty;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function directAnswerThreshold(results: KnowledgeEvidenceResult[]): number {
  const top = results[0];
  if (!top) {
    return 1;
  }
  if (top.source_type === 'faq' || top.source_type === 'runbook') {
    return 0.7;
  }
  return top.intent === 'troubleshooting' ? 0.78 : 0.68;
}

function detectConflicts(results: KnowledgeEvidenceResult[]): string[] {
  const activeByModule = new Map<string, Set<string>>();
  for (const result of results) {
    const key = `${result.module}:${result.intent}`;
    activeByModule.set(key, new Set([...(activeByModule.get(key) ?? []), result.status]));
  }
  return Array.from(activeByModule.entries())
    .filter(([, statuses]) => statuses.has('active') && (statuses.has('deprecated') || statuses.has('archived')))
    .map(([key]) => key);
}

function isStale(result: KnowledgeEvidenceResult): boolean {
  if (result.status === 'deprecated' || result.status === 'archived' || result.status === 'review_required') {
    return true;
  }
  const verifiedAt = Date.parse(result.last_verified_at);
  if (!Number.isFinite(verifiedAt)) {
    return true;
  }
  const days = (Date.now() - verifiedAt) / 86_400_000;
  return days > 180;
}

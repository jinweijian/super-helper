import assert from 'node:assert/strict';
import test from 'node:test';
import { gateHistoricalCases } from '../dist/runtime/case-investigation/historical-case-gate.js';
import { buildCaseInvestigationResult } from '../dist/runtime/case-investigation/result-builder.js';

const historicalEvidence = [{ id: 'redmine_ev_01', kind: 'mcp', source: 'mcp:redmine/1', summary: '历史转码队列故障', confidence: 'medium' }];
const currentEvidence = [{ id: 'worker_ev_01', kind: 'workspace', source: 'worker', summary: '当前队列配置命中', confidence: 'high' }];
const verification = {
  leadId: 'lead-1',
  classification: 'same_root_cause_likely',
  historicalEvidenceIds: ['redmine_ev_01'],
  currentEvidenceIds: ['worker_ev_01'],
  supportingEvidenceIds: ['redmine_ev_01', 'worker_ev_01'],
  conflictingEvidenceIds: [],
};
const lead = {
  id: 'lead-1',
  issueId: 101,
  hypothesis: '转码队列配置与历史故障相同',
  evidenceIds: ['redmine_ev_01'],
  conflicts: [],
  checks: [{
    id: 'check-1', action: 'inspect_config', target: 'transcode', expectedMatch: '配置命中', expectedMismatch: '配置不同', evidenceIds: ['redmine_ev_01'],
  }],
};

function input(overrides = {}) {
  return {
    currentRunId: 'run-1',
    redmineStatus: 'completed',
    workerStatus: 'completed',
    knowledgeConflicts: false,
    leads: [lead],
    verifications: [verification],
    evidence: [...historicalEvidence, ...currentEvidence],
    coverageEvidenceEnvelopes: [
      { evidenceId: 'redmine_ev_01', kind: 'mcp', safeText: '历史转码队列故障', freshness: 'current_mcp_call', validated: true, runId: 'run-1', readOnly: true, allowlisted: true, completed: true },
      { evidenceId: 'worker_ev_01', kind: 'workspace', safeText: '当前队列配置命中', freshness: 'current_worker_run', validated: true, runId: 'run-1' },
    ],
    ...overrides,
  };
}

test('same-root requires current workspace/log evidence and current read-only Redmine evidence', () => {
  const result = gateHistoricalCases(input());
  assert.equal(result.decisions[0].classification, 'same_root_cause_likely');
  assert.deepEqual(result.decisions[0].evidenceIds, ['redmine_ev_01', 'worker_ev_01']);
  assert.deepEqual(result.blockers, []);
});

for (const [name, mutate, blocker] of [
  ['history only', (value) => ({ ...value, evidence: historicalEvidence, coverageEvidenceEnvelopes: value.coverageEvidenceEnvelopes.slice(0, 1) }), 'current_evidence_missing'],
  ['old envelope', (value) => ({ ...value, coverageEvidenceEnvelopes: value.coverageEvidenceEnvelopes.map((item) => ({ ...item, runId: 'old-run' })) }), 'current_run_provenance_missing'],
  ['user claim as current evidence', (value) => ({ ...value, evidence: [...historicalEvidence, { ...currentEvidence[0], kind: 'manual' }], coverageEvidenceEnvelopes: [value.coverageEvidenceEnvelopes[0]] }), 'current_evidence_missing'],
  ['source failed', (value) => ({ ...value, redmineStatus: 'failed' }), 'historical_source_incomplete'],
  ['worker contradiction', (value) => ({ ...value, verifications: [{ ...verification, conflictingEvidenceIds: ['worker_ev_01'] }] }), 'current_evidence_conflict'],
  ['knowledge conflict', (value) => ({ ...value, knowledgeConflicts: true }), 'knowledge_conflict'],
]) {
  test(`same-root degrades for ${name}`, () => {
    const gated = gateHistoricalCases(mutate(input()));
    assert.equal(gated.decisions[0].classification, 'diagnostic_lead_only');
    assert.equal(gated.blockers.includes(blocker), true);
  });
}

test('same-symptom-different-cause remains explicit and result builder never promotes it to a resolved root cause', () => {
  const gated = gateHistoricalCases(input({
    verifications: [{ ...verification, classification: 'same_symptom_different_cause', conflictingEvidenceIds: ['worker_ev_01'] }],
  }));
  assert.equal(gated.decisions[0].classification, 'same_symptom_different_cause');
  const result = buildCaseInvestigationResult({
    answerGoal: {
      rawUserQuestion: '视频为什么加载失败？', resolvedQuestion: '视频为什么加载失败？', answerObject: '原因', mustAnswerItems: ['原因'], diagnosticObjective: '定位', sourceMessageIds: ['msg-1'],
    },
    gate: gated,
    evidence: [...historicalEvidence, ...currentEvidence],
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.recommendedNextAction, 'continue_diagnosis');
  assert.doesNotMatch(result.summary, /已经确认|根因相同/);
});

test('diagnostic lead produces an evidence-bound preliminary direction, not a final conclusion', () => {
  const gated = gateHistoricalCases(input({ evidence: historicalEvidence, coverageEvidenceEnvelopes: input().coverageEvidenceEnvelopes.slice(0, 1) }));
  const result = buildCaseInvestigationResult({
    answerGoal: {
      rawUserQuestion: '视频为什么加载失败？', resolvedQuestion: '视频为什么加载失败？', answerObject: '原因', mustAnswerItems: ['原因'], diagnosticObjective: '定位', sourceMessageIds: ['msg-1'],
    },
    gate: gated,
    evidence: historicalEvidence,
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.claims[0].role, 'primary_answer');
  assert.match(result.claims[0].text, /初步排查方向/);
  assert.match(result.claims[0].text, /不能作为最终根因结论/);
  assert.deepEqual(result.claims[0].evidenceIds, ['redmine_ev_01']);
});

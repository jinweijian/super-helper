import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAgentRegistry, resolveAgentConfig } from '../dist/runtime/agent-configs.js';
import { CandidateRerankerService } from '../dist/runtime/case-investigation/candidate-reranker-service.js';
import { HistoricalCaseAnalyzerService } from '../dist/runtime/case-investigation/historical-case-analyzer-service.js';
import { HistoricalCaseVerifierService } from '../dist/runtime/case-investigation/historical-case-verifier-service.js';
import { QueryPlannerService } from '../dist/runtime/case-investigation/query-planner-service.js';

function modelReturning(value) {
  return { async complete() { return typeof value === 'string' ? value : JSON.stringify(value); } };
}

function throwingModel() {
  return { async complete() { throw new Error('model fixture failed with private payload'); } };
}

const answerGoal = {
  rawUserQuestion: '视频为什么加载失败？',
  resolvedQuestion: '视频为什么加载失败？',
  answerObject: '视频加载失败的原因和处理方式',
  mustAnswerItems: ['原因', '处理方式'],
  diagnosticObjective: '定位视频链路',
  sourceMessageIds: ['msg-1'],
};

const candidates = [1, 2, 3, 4].map((issueId) => ({
  issueId,
  subject: `Issue ${issueId}`,
  descriptionExcerpt: `Description ${issueId}`,
  sourceLocator: `redmine:issue:${issueId}`,
}));

test('registry exposes exactly four non-visible historical-case model agents and no assessor', () => {
  const registry = loadAgentRegistry();
  const stages = [
    'historical_search_query_planner',
    'historical_case_reranker',
    'historical_case_analyzer',
    'historical_case_verifier',
  ];
  for (const stage of stages) {
    const entry = registry.agents.find((agent) => agent.stage === stage);
    assert.equal(entry?.mayProduceUserFacingText, false);
    assert.equal(entry?.executionMode, 'model_assisted');
    assert.match(resolveAgentConfig(stage).content, /may_produce_user_facing_text: false/);
  }
  assert.equal(registry.agents.some((agent) => /current.*evidence.*assessor/iu.test(`${agent.id} ${agent.role} ${agent.stage}`)), false);
});

test('query planner returns fixed budgets and falls back to the resolved question on invalid or failed model output', async () => {
  const valid = await new QueryPlannerService(modelReturning({
    query: '视频 加载 失败',
    signals: ['转码', '播放器'],
    status: 'all',
    candidateLimit: 10,
    detailLimit: 3,
  }), 'planner spec').plan({ answerGoal });
  assert.deepEqual(valid, {
    query: '视频 加载 失败',
    signals: ['转码', '播放器'],
    status: 'all',
    candidateLimit: 10,
    detailLimit: 3,
    degraded: false,
  });

  for (const model of [modelReturning('not-json'), modelReturning({ query: '', signals: [], candidateLimit: 99 }), throwingModel()]) {
    const fallback = await new QueryPlannerService(model, 'planner spec').plan({ answerGoal });
    assert.deepEqual(fallback, {
      query: answerGoal.resolvedQuestion,
      signals: [],
      status: 'all',
      candidateLimit: 10,
      detailLimit: 3,
      degraded: true,
    });
    assert.doesNotMatch(JSON.stringify(fallback), /private payload/);
  }
});

test('reranker only returns at most three unique IDs from the supplied candidate set', async () => {
  const selected = await new CandidateRerankerService(modelReturning({ issueIds: [3, 1] }), 'reranker spec')
    .select({ query: 'video', candidates });
  assert.deepEqual(selected, { issueIds: [3, 1], degraded: false });

  for (const response of ['not-json', { issueIds: [1, 1] }, { issueIds: [99] }, { issueIds: [1, 2, 3, 4] }]) {
    const fallback = await new CandidateRerankerService(modelReturning(response), 'reranker spec')
      .select({ query: 'video', candidates });
    assert.deepEqual(fallback, { issueIds: [1, 2, 3], degraded: true });
  }
  const failed = await new CandidateRerankerService(throwingModel(), 'reranker spec')
    .select({ query: 'video', candidates });
  assert.deepEqual(failed, { issueIds: [1, 2, 3], degraded: true });
});

const details = [{
  issueId: 1,
  subject: '视频加载失败',
  sourceLocator: 'redmine:issue:1',
  evidenceBlocks: [{ id: 'redmine:1:description', kind: 'description', text: '检查转码队列' }],
}];
const historicalEvidence = [{
  id: 'redmine_ev_01',
  kind: 'mcp',
  source: 'mcp:redmine/redmine:issue:1',
  summary: '检查转码队列',
  confidence: 'medium',
}];

test('analyzer accepts only evidence-bound leads with allowlisted read-only checks', async () => {
  const validResponse = {
    leads: [{
      id: 'lead-1',
      issueId: 1,
      hypothesis: '转码队列状态可能相关',
      evidenceIds: ['redmine_ev_01'],
      conflicts: [],
      checks: [{
        id: 'check-1',
        action: 'search_workspace',
        target: 'transcode queue configuration',
        expectedMatch: '存在相同队列配置',
        expectedMismatch: '配置与历史案例不同',
        evidenceIds: ['redmine_ev_01'],
      }],
    }],
  };
  const valid = await new HistoricalCaseAnalyzerService(modelReturning(validResponse), 'analyzer spec')
    .analyze({ details, evidence: historicalEvidence });
  assert.equal(valid.degraded, false);
  assert.equal(valid.leads[0].checks[0].action, 'search_workspace');

  for (const response of [
    'not-json',
    { leads: [{ ...validResponse.leads[0], issueId: 99 }] },
    { leads: [{ ...validResponse.leads[0], evidenceIds: ['unknown'] }] },
    { leads: [{ ...validResponse.leads[0], checks: [{ ...validResponse.leads[0].checks[0], action: 'write_file' }] }] },
  ]) {
    const result = await new HistoricalCaseAnalyzerService(modelReturning(response), 'analyzer spec')
      .analyze({ details, evidence: historicalEvidence });
    assert.deepEqual(result, { leads: [], degraded: true });
  }
  assert.deepEqual(
    await new HistoricalCaseAnalyzerService(throwingModel(), 'analyzer spec').analyze({ details, evidence: historicalEvidence }),
    { leads: [], degraded: true },
  );
});

const leads = [{
  id: 'lead-1',
  issueId: 1,
  hypothesis: '转码队列状态可能相关',
  evidenceIds: ['redmine_ev_01'],
  conflicts: [],
  checks: [{
    id: 'check-1',
    action: 'inspect_config',
    target: 'transcode config',
    expectedMatch: '配置相同',
    expectedMismatch: '配置不同',
    evidenceIds: ['redmine_ev_01'],
  }],
}];

test('verifier cannot introduce facts, lead IDs, or evidence IDs and degrades conservatively', async () => {
  const currentEvidence = [{ id: 'worker_ev_01', kind: 'workspace', source: 'worker', summary: '配置相同', confidence: 'high' }];
  const valid = await new HistoricalCaseVerifierService(modelReturning({
    verifications: [{
      leadId: 'lead-1',
      classification: 'same_root_cause_likely',
      historicalEvidenceIds: ['redmine_ev_01'],
      currentEvidenceIds: ['worker_ev_01'],
      supportingEvidenceIds: ['redmine_ev_01', 'worker_ev_01'],
      conflictingEvidenceIds: [],
    }],
  }), 'verifier spec').verify({ leads, historicalEvidence, currentEvidence });
  assert.equal(valid.degraded, false);
  assert.equal(valid.verifications[0].classification, 'same_root_cause_likely');

  for (const response of [
    'not-json',
    { verifications: [{ leadId: 'unknown', classification: 'irrelevant', historicalEvidenceIds: [], currentEvidenceIds: [], supportingEvidenceIds: [], conflictingEvidenceIds: [] }] },
    { verifications: [{ leadId: 'lead-1', classification: 'same_root_cause_likely', historicalEvidenceIds: ['invented'], currentEvidenceIds: [], supportingEvidenceIds: [], conflictingEvidenceIds: [] }] },
  ]) {
    const fallback = await new HistoricalCaseVerifierService(modelReturning(response), 'verifier spec')
      .verify({ leads, historicalEvidence, currentEvidence });
    assert.equal(fallback.degraded, true);
    assert.deepEqual(fallback.verifications.map((item) => item.classification), ['diagnostic_lead_only']);
  }
  const failed = await new HistoricalCaseVerifierService(throwingModel(), 'verifier spec')
    .verify({ leads, historicalEvidence, currentEvidence });
  assert.equal(failed.degraded, true);
  assert.doesNotMatch(JSON.stringify(failed), /private payload/);
});

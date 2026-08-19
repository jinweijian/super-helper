import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLogBlocks, formatLogSection } from '../dist/observability/log-blocks.js';
import { CaseRuntimeEventRecorder } from '../dist/runtime/event-recorder.js';
import { sessionSummary } from '../dist/gateway/dto.js';

const forbidden = /secret-query|private-body|Alice Smith|https:\/\/private\.example|api-key-value|model-reason|raw-stack|write-plan/;

function fixture() {
  const caseSession = {
    id: 'case-observe', tenantId: 'tenant', userId: 'user', workspaceId: 'current', claudeSessionId: 'session',
    title: 'fixture', status: 'diagnosing', userPersona: 'developer', messages: [], runs: [], logs: [],
    createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  };
  let sequence = 0;
  const recorder = new CaseRuntimeEventRecorder({
    addLogEvent(target, value) {
      const event = { id: `log-${++sequence}`, createdAt: `2026-08-20T00:00:0${sequence}.000Z`, ...value };
      target.logs.push(event);
      return event;
    },
  });
  return { caseSession, recorder };
}

test('case investigation events expose only bounded status/count/id metadata with correct actors', () => {
  const { caseSession, recorder } = fixture();
  const poison = {
    query: 'secret-query', signals: ['Alice Smith'], body: 'private-body', url: 'https://private.example',
    key: 'api-key-value', reason: 'model-reason', plan: 'write-plan', error: 'raw-stack',
  };

  recorder.historicalCaseSearchStarted(caseSession, { runId: 'run-1' });
  recorder.historicalCaseSearchCompleted(caseSession, {
    runId: 'run-1', status: 'completed', candidateCount: 3, detailCount: 2,
    evidenceIds: ['redmine_ev_01'], durationMs: 12, degraded: false, ...poison,
  });
  recorder.historicalCaseAnalysisStarted(caseSession, { runId: 'run-1', detailCount: 2 });
  recorder.historicalCaseAnalysisCompleted(caseSession, {
    runId: 'run-1', status: 'completed', leadCount: 1, leadIds: ['lead-1'],
    evidenceIds: ['redmine_ev_01'], durationMs: 8, degraded: false, ...poison,
  });
  recorder.currentProjectVerificationStarted(caseSession, { runId: 'run-1', workerInvoked: true, leadCount: 1 });
  recorder.currentProjectVerificationCompleted(caseSession, {
    runId: 'run-1', status: 'completed', workerInvoked: true, evidenceCount: 1,
    evidenceIds: ['worker_ev_01'], durationMs: 20, ...poison,
  });
  recorder.historicalCrossReviewStarted(caseSession, { runId: 'run-1', leadCount: 1 });
  recorder.historicalCrossReviewCompleted(caseSession, {
    runId: 'run-1', verificationCount: 1,
    classificationCounts: { sameRootCauseLikely: 1, sameSymptomDifferentCause: 0, diagnosticLeadOnly: 0, irrelevant: 0 },
    evidenceIds: ['redmine_ev_01', 'worker_ev_01'], durationMs: 6, degraded: false, ...poison,
  });

  const byPhase = new Map(caseSession.logs.map((event) => [event.phase, event]));
  assert.equal(byPhase.get('historical_case_search_started').actor, 'mcp');
  assert.equal(byPhase.get('historical_case_analysis_started').actor, 'agent');
  assert.equal(byPhase.get('historical_case_analysis_started').agentId, 'historical-case-analyzer');
  assert.equal(byPhase.get('current_project_verification_started').actor, 'claude');
  assert.equal(byPhase.get('historical_cross_review_started').actor, 'agent');
  assert.equal(byPhase.get('historical_cross_review_started').agentId, 'historical-case-verifier');

  const caseJson = JSON.stringify(caseSession);
  const logsJson = JSON.stringify({
    blocks: buildLogBlocks(caseSession),
    logs: [
      formatLogSection('Agent 工作链路', caseSession.logs.filter((event) => event.actor === 'agent')),
      formatLogSection('Claude Code 工作链路', caseSession.logs.filter((event) => event.actor === 'claude')),
      formatLogSection('MCP 工作链路', caseSession.logs.filter((event) => event.actor === 'mcp')),
    ],
  });
  assert.doesNotMatch(caseJson, forbidden);
  assert.doesNotMatch(logsJson, forbidden);
  assert.deepEqual(buildLogBlocks(caseSession).map((block) => block.label).filter((label, index, all) => all.indexOf(label) === index).sort(),
    ['交叉审核', '分析案例', '查询工单', '验证当前项目'].sort());

  const activity = sessionSummary(caseSession).agentActivity;
  assert.equal(activity.some((item) => item.phase === 'historical_case_search_started'), true);
  assert.equal(activity.some((item) => item.phase === 'current_project_verification_started'), true);
});

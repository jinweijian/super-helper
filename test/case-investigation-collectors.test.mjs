import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { ExperienceTurnService } from '../dist/runtime/experience-turn.js';
import { KnowledgeTurnService } from '../dist/runtime/knowledge-turn.js';
import { WorkerDiagnosisService } from '../dist/runtime/worker-diagnosis.js';

function request() {
  return {
    caseId: 'case-1',
    runId: 'run-1',
    workspaceId: 'current',
    claudeSessionId: 'session-1',
    answerGoal: {
      rawUserQuestion: '视频为什么加载失败？',
      resolvedQuestion: '视频为什么加载失败？',
      answerObject: '视频加载失败的原因',
      mustAnswerItems: ['原因'],
      diagnosticObjective: '定位视频链路',
      sourceMessageIds: ['msg-1'],
    },
    userGoal: '视频为什么加载失败？',
    knownFacts: [],
    unknowns: [],
    constraints: [],
    allowedMcpToolIds: [],
  };
}

function caseSession(root) {
  return {
    id: 'case-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'current',
    title: 'fixture',
    status: 'ready_for_diagnosis',
    userPersona: 'developer',
    messages: [],
    runs: [],
    logs: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    root,
  };
}

function noOpEvents() {
  return new Proxy({}, { get: () => () => undefined });
}

test('Knowledge and Experience collect return evidence outcomes without Run, Review, Presentation, reply, or request mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-collectors-'));
  const counters = { addRun: 0, review: 0, reply: 0 };
  const store = {
    listCases: () => [],
    addRun: () => { counters.addRun += 1; },
    addMessage: () => { counters.reply += 1; },
  };
  const reviewer = { reviewAndFormat: async () => { counters.review += 1; throw new Error('must not review'); } };
  try {
    const config = defaultConfig();
    config.knowledge.rootDir = join(root, 'knowledge');
    config.knowledge.isolateByWorkspace = false;
    config.workspaces[0].rootPath = root;
    const session = caseSession(root);
    const originalRequest = request();
    const before = structuredClone(originalRequest);

    const knowledge = new KnowledgeTurnService(config, store, noOpEvents(), reviewer);
    const knowledgeOutcome = await knowledge.collect(session, originalRequest.userGoal, originalRequest);
    assert.equal(knowledgeOutcome.status, 'no_hit');

    const experience = new ExperienceTurnService(store, noOpEvents(), reviewer);
    const experienceOutcome = await experience.collect(session, originalRequest);
    assert.equal(experienceOutcome.status, 'no_hit');

    assert.deepEqual(originalRequest, before);
    assert.deepEqual(counters, { addRun: 0, review: 0, reply: 0 });
    assert.equal('reply' in knowledgeOutcome, false);
    assert.equal('reply' in experienceOutcome, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Worker collectEvidence executes once with ephemeral checks and returns a sanitized persisted request', async () => {
  const counters = { worker: 0, addRun: 0, review: 0, reply: 0 };
  let receivedRequest;
  const worker = {
    async diagnose(workerRequest) {
      counters.worker += 1;
      receivedRequest = workerRequest;
      return {
        result: {
          status: 'partial',
          summary: '找到当前配置证据',
          missingInfo: [],
          evidence: [{ id: 'worker_ev_01', kind: 'workspace', source: 'worker', summary: '配置命中', confidence: 'high' }],
          claims: [],
          recommendedNextAction: 'continue_diagnosis',
        },
        trace: {
          command: 'claude', cwd: '/workspace', stdout: '', stderr: '',
          startedAt: '2026-08-20T00:00:00.000Z', finishedAt: '2026-08-20T00:00:01.000Z', exitCode: 0,
        },
        coverageEvidence: [{ evidenceId: 'worker_ev_01', kind: 'workspace', safeText: '配置命中', runId: 'run-1', validated: true }],
      };
    },
  };
  const store = {
    addRun: () => { counters.addRun += 1; },
    addMessage: () => { counters.reply += 1; },
  };
  const reviewer = { reviewAndFormat: async () => { counters.review += 1; throw new Error('must not review'); } };
  const service = new WorkerDiagnosisService(store, worker, noOpEvents(), reviewer);
  const originalRequest = request();
  const outcome = await service.collectEvidence({
    request: originalRequest,
    leads: [{
      id: 'lead-1',
      issueId: 101,
      hypothesis: '转码配置可能相关',
      evidenceIds: ['redmine_ev_01'],
      conflicts: [],
      checks: [{
        id: 'check-1',
        action: 'inspect_config',
        target: 'transcode.yaml',
        expectedMatch: '队列配置一致',
        expectedMismatch: '队列配置不同',
        evidenceIds: ['redmine_ev_01'],
      }],
    }],
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(counters.worker, 1);
  assert.match(receivedRequest.constraints.join('\n'), /transcode\.yaml|队列配置一致|队列配置不同/);
  assert.doesNotMatch(JSON.stringify(outcome.persistedRequest), /transcode\.yaml|转码配置可能相关|队列配置一致/);
  assert.equal('workerRequest' in outcome, false);
  assert.deepEqual(originalRequest, request());
  assert.deepEqual(counters, { worker: 1, addRun: 0, review: 0, reply: 0 });

  const rejected = await service.collectEvidence({
    request: originalRequest,
    leads: [{
      id: 'unsafe', issueId: 102, hypothesis: 'unsafe', evidenceIds: ['redmine_ev_02'], conflicts: [],
      checks: [{
        id: 'unsafe-check', action: 'write_file', target: 'x', expectedMatch: 'x', expectedMismatch: 'y', evidenceIds: ['redmine_ev_02'],
      }],
    }],
  });
  assert.deepEqual(rejected, { status: 'rejected', safeErrorCode: 'unsafe_worker_action' });
  assert.equal(counters.worker, 1);
});

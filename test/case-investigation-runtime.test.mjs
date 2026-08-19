import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { ParallelSourceCollector } from '../dist/runtime/case-investigation/parallel-source-collector.js';
import { RedmineBranch } from '../dist/runtime/case-investigation/redmine-branch.js';
import { CaseInvestigationTurnService } from '../dist/runtime/case-investigation/case-investigation-turn-service.js';
import { FileMemoryStore } from '../dist/sessions/file-memory-store.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function request() {
  return {
    caseId: 'case-1', runId: 'run-1', workspaceId: 'current', claudeSessionId: 'session-1',
    answerGoal: {
      rawUserQuestion: '视频为什么加载失败？', resolvedQuestion: '视频为什么加载失败？', answerObject: '原因', mustAnswerItems: ['原因'], diagnosticObjective: '定位', sourceMessageIds: ['msg-1'],
    },
    userGoal: '视频为什么加载失败？', knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: ['company-redmine'],
  };
}

const session = {
  id: 'case-1', tenantId: 'tenant', userId: 'user', workspaceId: 'current', title: 'fixture', status: 'ready_for_diagnosis',
  userPersona: 'developer', messages: [], runs: [], logs: [], createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
};

test('parallel collector starts Knowledge, Experience, and full Redmine branches together and waits for the barrier', async () => {
  const knowledge = deferred();
  const experience = deferred();
  const redmine = deferred();
  const started = [];
  let settled = false;
  const collector = new ParallelSourceCollector({
    knowledge: { collect: async () => { started.push('knowledge'); return knowledge.promise; } },
    experience: { collect: async () => { started.push('experience'); return experience.promise; } },
    redmine: { collect: async () => { started.push('redmine'); return redmine.promise; } },
  });

  const pending = collector.collect(session, request()).then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.deepEqual(started.sort(), ['experience', 'knowledge', 'redmine']);
  knowledge.resolve({ status: 'completed', coverageEvidenceEnvelopes: [] });
  await Promise.resolve();
  assert.equal(settled, false);
  experience.resolve({ status: 'no_hit', rejectedCandidates: [] });
  await Promise.resolve();
  assert.equal(settled, false);
  redmine.resolve({ status: 'timeout', leads: [], evidence: [], coverageEvidenceEnvelopes: [], safeErrorCode: 'timeout' });
  const result = await pending;
  assert.equal(result.knowledge.status, 'completed');
  assert.equal(result.experience.status, 'no_hit');
  assert.equal(result.redmine.status, 'timeout');
});

test('Redmine branch always plans and searches once, then analyzes at most one detail response', async () => {
  const counts = { planner: 0, investigate: 0, rerank: 0, analyze: 0 };
  const branch = new RedmineBranch({
    planner: { async plan() { counts.planner += 1; return { query: 'video', signals: [], status: 'all', candidateLimit: 10, detailLimit: 3, degraded: false }; } },
    evidence: {
      async investigate(input) {
        counts.investigate += 1;
        const candidates = [{ issueId: 1, subject: 'video', descriptionExcerpt: 'queue', sourceLocator: 'redmine:issue:1' }];
        const selected = await input.selectIssueIds(candidates);
        assert.deepEqual(selected, [1]);
        return {
          status: 'completed', candidates, details: [{ issueId: 1, subject: 'video', sourceLocator: 'redmine:issue:1', evidenceBlocks: [] }],
          evidence: [{ id: 'redmine_ev_01', kind: 'mcp', source: 'mcp:redmine/redmine:issue:1', summary: 'queue', confidence: 'medium' }],
          coverageEvidenceEnvelopes: [],
        };
      },
    },
    reranker: { async select() { counts.rerank += 1; return { issueIds: [1], degraded: false }; } },
    analyzer: { async analyze() { counts.analyze += 1; return { leads: [], degraded: false }; } },
  });
  const result = await branch.collect(request());
  assert.equal(result.status, 'completed');
  assert.deepEqual(counts, { planner: 1, investigate: 1, rerank: 1, analyze: 1 });
});

test('turn service creates one sanitized Run, one review, and one helper reply after all evidence is collected', async () => {
  const counters = { addRun: 0, review: 0, reply: 0, save: 0, worker: 0, verifier: 0 };
  const storedRuns = [];
  const store = {
    addRun(_case, run) { counters.addRun += 1; storedRuns.push(run); return run; },
    addMessage(_case, value) { counters.reply += 1; return { id: 'reply-1', createdAt: 'now', ...value }; },
    saveCase() { counters.save += 1; },
    appendDailyMemory() {},
  };
  const historical = [{ id: 'redmine_ev_01', kind: 'mcp', source: 'mcp:redmine/redmine:issue:1', summary: '历史线索', confidence: 'medium' }];
  const current = [{ id: 'worker_ev_01', kind: 'workspace', source: 'worker', summary: '当前证据', confidence: 'high' }];
  const lead = {
    id: 'lead-1', issueId: 1, hypothesis: '配置与历史一致', evidenceIds: ['redmine_ev_01'], conflicts: [],
    checks: [{ id: 'check-1', action: 'inspect_config', target: 'config', expectedMatch: '一致', expectedMismatch: '不同', evidenceIds: ['redmine_ev_01'] }],
  };
  const turn = new CaseInvestigationTurnService({
    store,
    events: new Proxy({}, { get: () => () => undefined }),
    reviewer: { async reviewAndFormat() { counters.review += 1; return { reply: '已完成交叉验证', decision: 'final', caseStatus: 'concluded' }; } },
    collector: {
      async collect() {
        return {
          knowledge: { status: 'no_hit', coverageEvidenceEnvelopes: [] },
          experience: { status: 'no_hit', rejectedCandidates: [] },
          redmine: {
            status: 'completed', leads: [lead], evidence: historical,
            coverageEvidenceEnvelopes: [{ evidenceId: 'redmine_ev_01', kind: 'mcp', safeText: '历史线索', freshness: 'current_mcp_call', validated: true, runId: 'run-1', readOnly: true, allowlisted: true, completed: true }],
          },
        };
      },
    },
    workerVerification: {
      async collect() {
        counters.worker += 1;
        return {
          status: 'completed', persistedRequest: request(),
          response: {
            result: { status: 'partial', summary: 'current', missingInfo: [], evidence: current, claims: [], recommendedNextAction: 'continue_diagnosis' },
            trace: { command: 'claude', cwd: '/workspace', stdout: 'private', stderr: '', startedAt: 'now', finishedAt: 'now', exitCode: 0 },
            coverageEvidence: [{ evidenceId: 'worker_ev_01', kind: 'workspace', safeText: '当前证据', runId: 'run-1', validated: true }],
          },
          coverageEvidenceEnvelopes: [{ evidenceId: 'worker_ev_01', kind: 'workspace', safeText: '当前证据', freshness: 'current_worker_run', validated: true, runId: 'run-1' }],
        };
      },
    },
    verifier: {
      async verify() {
        counters.verifier += 1;
        return { degraded: false, verifications: [{
          leadId: 'lead-1', classification: 'same_root_cause_likely', historicalEvidenceIds: ['redmine_ev_01'], currentEvidenceIds: ['worker_ev_01'], supportingEvidenceIds: ['redmine_ev_01', 'worker_ev_01'], conflictingEvidenceIds: [],
        }] };
      },
    },
  });

  const result = await turn.answer(session, request(), 'msg-1');
  assert.equal(result.assistantMessage, '已完成交叉验证');
  assert.deepEqual(counters, { addRun: 1, review: 1, reply: 1, save: 1, worker: 1, verifier: 1 });
  assert.equal(storedRuns.length, 1);
  assert.doesNotMatch(JSON.stringify(storedRuns[0]), /private/);
});

test('production DiagnosticRuntime routes a configured workspace through one Redmine search before one fallback worker run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'case-investigation-runtime-'));
  const config = defaultConfig();
  config.storage.rootDir = join(root, 'storage');
  config.storage.isolateByWorkspace = false;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.knowledge.isolateByWorkspace = false;
  config.agent.modelProvider = undefined;
  config.agent.useModelForPreflight = false;
  config.agent.useModelForRagAnswerability = false;
  config.claude.commandWhitelist = ['node'];
  config.workspaces = [{
    id: 'current', name: 'Current', rootPath: root,
    mcpToolIds: ['company-redmine'], historicalCaseSources: [{ serverId: 'company-redmine' }],
  }];
  config.mcpTools = [{
    id: 'company-redmine', name: 'Company Redmine', protocol: 'stdio', permission: 'read_only', enabled: true,
    allowedToolNames: ['redmine_search_issues', 'redmine_get_issue_case_details'],
    capability: { type: 'historical_case', provider: 'redmine' },
    config: { command: 'node', args: ['fixture.mjs'], env: {} },
  }];
  let searchCalls = 0;
  let workerCalls = 0;
  const model = { async complete() { throw new Error('intentional model degradation'); } };
  const worker = {
    async diagnose(input) {
      workerCalls += 1;
      return {
        result: {
          status: 'partial', summary: '已完成当前项目只读排查。', missingInfo: ['仍需运行时日志'],
          evidence: [{ id: 'worker_ev_01', kind: 'workspace', source: 'worker', summary: 'package.json 已完成只读检查', confidence: 'high' }],
          claims: [{
            id: 'worker_claim_01', type: 'fact', role: 'primary_answer', text: '当前项目配置需要结合运行时日志继续确认。',
            evidenceIds: ['worker_ev_01'], answers: [],
          }],
          recommendedNextAction: 'continue_diagnosis',
        },
        trace: {
          command: 'fixture', cwd: root, stdout: 'must-not-persist', stderr: '', exitCode: 0,
          startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        },
        coverageEvidence: [{ evidenceId: 'worker_ev_01', kind: 'workspace', safeText: 'package.json 已完成只读检查', runId: input.runId, validated: true }],
      };
    },
  };
  try {
    const store = new FileMemoryStore(config.storage.rootDir);
    const runtime = new DiagnosticRuntime(config, store, worker, {
      model,
      mcp: {
        createClient: async () => ({
          async listTools() {
            return [{ name: 'redmine_search_issues' }, { name: 'redmine_get_issue_case_details' }];
          },
          async callTool(name) {
            assert.equal(name, 'redmine_search_issues');
            searchCalls += 1;
            return {
              content: [{ type: 'text', text: '没有匹配工单' }],
              structuredContent: { status: 'no_hit', candidates: [] },
            };
          },
          async close() {},
        }),
      },
    });
    const response = await runtime.handleUserMessage({
      workspaceId: 'current',
      message: '请排查当前项目 package.json 中的版本配置为什么与故障描述不一致。',
    });
    const stored = store.loadCase(response.caseSession.id);
    assert.equal(searchCalls, 1);
    assert.equal(workerCalls, 1);
    assert.equal(stored.runs.length, 1);
    assert.equal(stored.messages.filter((item) => item.role === 'helper').length, 1);
    for (const phase of [
      'historical_case_search_started', 'historical_case_search_completed',
      'current_project_verification_started', 'current_project_verification_completed',
      'historical_cross_review_started', 'historical_cross_review_completed',
    ]) assert.equal(stored.logs.some((item) => item.phase === phase), true, phase);
    assert.equal(JSON.stringify(stored).includes('must-not-persist'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

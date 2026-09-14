import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../dist/config.js';
import { FileMemoryStore } from '../dist/sessions/file-memory-store.js';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { createModelClient } from '../dist/providers/model/adapter.js';
import { AnswerGoalCompletenessReviewService } from '../dist/runtime/answer-goal-completeness-review-service.js';
import { QueryPlannerService } from '../dist/runtime/case-investigation/query-planner-service.js';
import { CandidateRerankerService } from '../dist/runtime/case-investigation/candidate-reranker-service.js';
import { HistoricalCaseAnalyzerService } from '../dist/runtime/case-investigation/historical-case-analyzer-service.js';
import { HistoricalCaseVerifierService } from '../dist/runtime/case-investigation/historical-case-verifier-service.js';
import { RagAnswerabilityService } from '../dist/runtime/rag-answerability-service.js';
import { RedmineBranch } from '../dist/runtime/case-investigation/redmine-branch.js';
import { ParallelSourceCollector } from '../dist/runtime/case-investigation/parallel-source-collector.js';
import { AnswerCoverageService } from '../dist/runtime/answer-coverage-service.js';
import { VisiblePromptSafetyService } from '../dist/runtime/visible-prompt-safety.js';
import { EvidenceCoverageService } from '../dist/runtime/evidence-coverage-service.js';

test('historical collector passes one signal and cancellation blocks search after planning', async () => {
  const controller = new AbortController();
  let searches = 0;
  let knowledgeSignal;
  const branch = new RedmineBranch({
    planner: { async plan(_input, signal) {
      assert.equal(signal, controller.signal);
      controller.abort();
      return { query: 'fixture', signals: [] };
    } },
    evidence: { async investigate() { searches++; throw new Error('unexpected'); } },
    reranker: {}, analyzer: {},
  });
  const collector = new ParallelSourceCollector({
    knowledge: { async collect(_case, _query, _request, signal) { knowledgeSignal = signal; return {}; } },
    experience: { async collect() { return {}; } },
    redmine: branch,
  });
  await assert.rejects(collector.collect({}, { answerGoal: goal, userGoal: 'fixture' }, controller.signal), /investigation_cancelled/);
  assert.equal(knowledgeSignal, controller.signal);
  assert.equal(searches, 0);
});

const goal = { resolvedQuestion: '检查入口', mustAnswerItems: ['检查入口'] };

test('runtime concurrent cases and next turn keep distinct model cancellation ownership', async t => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = defaultConfig();
  config.storage = { rootDir: root, isolateByWorkspace: false };
  config.knowledge.rootDir = join(root, 'knowledge');
  config.agent.modelProvider = 'fixture';
  config.agent.useModelForPreflight = true;
  const pending = [];
  let onStarted = () => {};
  const waitForCalls = count => pending.length >= count ? Promise.resolve() : new Promise(resolve => {
    onStarted = () => { if (pending.length >= count) resolve(); };
  });
  const model = { async complete(_messages, options) {
    if (!JSON.parse(_messages[1].content).caseId) return '{}';
    return new Promise(resolve => {
      const finish = () => resolve('{"action":"ask_user","question":"请补充说明"}');
      pending.push({ signal: options.signal, finish });
      onStarted();
      options.signal.addEventListener('abort', finish, { once: true });
    });
  } };
  const runtime = new DiagnosticRuntime(config, new FileMemoryStore(root), {
    async diagnose() { return {
      result: { status: 'partial', summary: '证据不足', claims: [], evidence: [], missingInfo: [], recommendedNextAction: 'escalate_to_human' },
      trace: { command: 'fixture', cwd: '', stdout: '', stderr: '', exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
    }; },
  }, { model });
  const first = runtime.startUserTurn({ message: '你好' });
  const second = runtime.startUserTurn({ message: '你好' });
  const a = runtime.completeUserTurn(first.caseSession.id, first.userMessageId);
  const b = runtime.completeUserTurn(second.caseSession.id, second.userMessageId);
  await waitForCalls(2);
  assert.equal(pending.length, 2);
  assert.notEqual(pending[0].signal, pending[1].signal);
  runtime.cancelInvestigation(first.caseSession.id, first.userMessageId);
  const cancelled = await a;
  assert.equal(cancelled.decision, 'partial');
  assert.equal(pending[1].signal.aborted, false);
  pending[1].finish();
  const normal = await b;
  assert.doesNotMatch(normal.assistantMessage, /排查已停止/);
  const next = runtime.startUserTurn({ caseId: first.caseSession.id, message: '你好' });
  const c = runtime.completeUserTurn(next.caseSession.id, next.userMessageId);
  await waitForCalls(3);
  assert.equal(runtime.cancelInvestigation(first.caseSession.id, first.userMessageId), false);
  assert.equal(pending[2].signal.aborted, false);
  pending[2].finish();
  await c;
  assert.equal(runtime.investigationProgress(next.caseSession.id, next.userMessageId), undefined);
  for (const turn of [first, second, next]) {
    const session = runtime.loadCase(turn.caseSession.id);
    assert.equal(session.messages.filter(m => m.role === 'helper' && m.replyToMessageId === turn.userMessageId).length, 1);
  }
});
for (const [Service, method, input] of [
  [QueryPlannerService, 'plan', { answerGoal: goal }],
  [CandidateRerankerService, 'select', { query: '入口', candidates: [] }],
  [HistoricalCaseAnalyzerService, 'analyze', { details: [], evidence: [] }],
  [HistoricalCaseVerifierService, 'verify', { leads: [], historicalEvidence: [], currentEvidence: [] }],
  [RagAnswerabilityService, 'evaluate', { answerGoal: goal, evidence: [] }],
  [AnswerCoverageService, 'review', {}],
  [VisiblePromptSafetyService, 'review', [{ id: 'missing:1', text: '请提供版本', source: 'missing' }]],
  [EvidenceCoverageService, 'evaluate', { question: '入口', evidence: [] }],
]) test(`${Service.name} preserves cancellation instead of model fallback`, async () => {
  const controller = new AbortController();
  let calls = 0;
  let seen;
  const service = new Service({ async complete(_messages, options) {
    calls++; seen = options.signal; controller.abort(); return '{}';
  } }, 'fixture');
  await assert.rejects(service[method](input, controller.signal), /investigation_cancelled/);
  assert.equal(seen, controller.signal);
  await assert.rejects(service[method](input, controller.signal), /investigation_cancelled/);
  assert.equal(calls, 1);
});

test('runtime cancellation aborts preflight HTTP body and creates no subsequent work', async t => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-cancel-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  let bodySent = false;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    entered();
    const timer = setTimeout(() => {
      bodySent = true;
      res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"ask_user","question":"测试"}' } }] }));
    }, 1000);
    res.on('close', () => clearTimeout(timer));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  const config = defaultConfig();
  config.storage = { rootDir: root, isolateByWorkspace: false };
  config.knowledge.rootDir = join(root, 'knowledge');
  config.agent.modelProvider = 'fixture';
  config.agent.useModelForPreflight = true;
  let workerCalls = 0;
  const runtime = new DiagnosticRuntime(config, new FileMemoryStore(root), {
    async diagnose() { workerCalls++; throw new Error('unexpected worker'); },
  }, { model: createModelClient({ type: 'openai-compatible', model: 'fixture', apiKey: 'synthetic-key',
    baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 5000 }) });
  const turn = runtime.startUserTurn({ message: '检查当前项目入口代码' });
  const completion = runtime.completeUserTurn(turn.caseSession.id, turn.userMessageId);
  await started;
  assert.equal(runtime.cancelInvestigation(turn.caseSession.id, turn.userMessageId), true);
  const result = await completion;
  assert.equal(bodySent, false, 'stop must complete before the delayed body is sent');
  assert.equal(calls, 1);
  assert.equal(workerCalls, 0);
  assert.equal(result.decision, 'partial');
  assert.equal(result.caseSession.messages.filter(m => m.role === 'helper').length, 1);
  assert.equal(runtime.investigationProgress(turn.caseSession.id, turn.userMessageId), undefined);
});

test('completeness review refuses pre-cancelled and late model results', async () => {
  const controller = new AbortController();
  let calls = 0;
  const service = new AnswerGoalCompletenessReviewService({ async complete(_messages, options) {
    calls++;
    assert.equal(options.signal, controller.signal);
    controller.abort();
    return '{"status":"complete","missingElements":[],"reason":"fixture"}';
  } }, 'fixture');
  const input = { resolvedQuestion: '检查入口', proposedItems: ['检查入口'] };
  await assert.rejects(service.review(input, controller.signal), /investigation_cancelled/);
  await assert.rejects(service.review(input, controller.signal), /investigation_cancelled/);
  assert.equal(calls, 1);
});

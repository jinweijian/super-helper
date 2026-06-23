import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SuperHelperAgent } from '../dist/agent.js';
import { defaultConfig } from '../dist/config.js';
import { preflight } from '../dist/preflight.js';
import { findExperienceMatch, findRejectedExperienceCandidates } from '../dist/runtime/experience-agent.js';
import { decisionFromReviewOutcome } from '../dist/runtime/review-gate.js';
import { formatReviewFailureFallback, ruleBasedReviewAndFormat } from '../dist/runtime/presenter.js';
import { buildResolvedTurnContext, reconcileResolvedTurnContext } from '../dist/runtime/resolved-turn.js';
import { validateDiagnosticResult } from '../dist/runtime/result-validator.js';
import { sanitizeWorkerTrace } from '../dist/observability/worker-trace.js';
import { FileMemoryStore } from '../dist/storage.js';

function agentConfig() {
  return {
    id: 'test',
    name: 'test',
    language: 'zh-CN',
    tone: 'calm_professional',
    defaultPermission: 'read_only',
    rules: {
      noGuessing: true,
      requireEvidenceForConclusion: true,
      askWhenMissingRequiredInfo: true,
      allowUnknownAnswer: true,
      distinguishFactInferenceAssumption: true,
    },
  };
}

function caseSession(overrides = {}) {
  return {
    id: 'case_current',
    claudeSessionId: 'session',
    tenantId: 'tenant_a',
    userId: 'user_a',
    workspaceId: 'current',
    title: 'test',
    status: 'need_input',
    userPersona: 'operations',
    messages: [],
    runs: [],
    logs: [],
    ...overrides,
  };
}

test('resolved preflight keeps unknown and hypotheses out of confirmed known facts', () => {
  const current = caseSession({
    messages: [
      { id: 'msg_question', role: 'user', body: '课程发布后学员为什么看不到入口？', createdAt: '2026-06-20T00:00:00Z' },
      { id: 'msg_helper', role: 'helper', body: '缺少具体账号，请补充。', createdAt: '2026-06-20T00:00:01Z', replyToMessageId: 'msg_question' },
      { id: 'msg_unknown', role: 'user', body: '不清楚', createdAt: '2026-06-20T00:00:02Z' },
    ],
  });
  const unknown = preflight({ caseSession: current, userMessage: '不清楚', agentConfig: agentConfig() });
  assert.equal(unknown.action, 'dispatch');
  assert.equal(unknown.request.userGoal, '课程发布后学员为什么看不到入口？');
  assert.equal(unknown.request.knownFacts.includes('不清楚'), false);
  assert.equal(unknown.request.context?.resolvedTurn?.unknowns.some((item) => item.text === '不清楚'), true);

  const hypothesisCase = caseSession({
    messages: [{ id: 'msg_hypothesis', role: 'user', body: '是不是数据库字段问题？', createdAt: '2026-06-20T00:00:00Z' }],
  });
  const hypothesis = preflight({ caseSession: hypothesisCase, userMessage: '是不是数据库字段问题？', agentConfig: agentConfig() });
  assert.equal(hypothesis.action, 'dispatch');
  assert.equal(hypothesis.request.knownFacts.includes('是不是数据库字段问题？'), false);
  assert.equal(hypothesis.request.context?.resolvedTurn?.hypotheses[0].sourceMessageId, 'msg_hypothesis');
});

test('resolved context is bounded, source-bound, and model reconciliation cannot promote facts', () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    id: `msg_${index + 1}`,
    role: 'user',
    body: index === 15 ? '是不是缓存导致课程入口不显示？' : `第 ${index + 1} 条历史描述`,
    createdAt: `2026-06-20T00:00:${String(index).padStart(2, '0')}Z`,
  }));
  const local = buildResolvedTurnContext({
    caseSession: caseSession({ messages }),
    latestUserMessage: messages.at(-1).body,
  });
  assert.equal(local.sourceMessageIds.length, 12);
  assert.equal(local.sourceMessageIds.includes('msg_1'), false);
  assert.equal(local.hypotheses[0].sourceMessageId, 'msg_16');

  const reconciled = reconcileResolvedTurnContext({
    local,
    model: {
      confirmedFacts: [{ text: '是不是缓存导致课程入口不显示？', sourceMessageId: 'msg_16' }],
      userClaims: [{ text: '模型补充主张', sourceMessageId: 'msg_16' }],
    },
  });
  assert.equal(reconciled.confirmedFacts.some((item) => item.text.includes('缓存')), false);
  assert.equal(reconciled.userClaims.some((item) => item.text === '模型补充主张'), true);
  assert.equal(reconciled.resolvedQuery, local.resolvedQuery);
});

test('a concrete clarification is incorporated into the unresolved query', () => {
  const current = caseSession({
    messages: [
      { id: 'msg_question', role: 'user', body: '课程保存为什么失败？', createdAt: '2026-06-20T00:00:00Z' },
      { id: 'msg_helper', role: 'helper', body: '还需要补充接口报错。', createdAt: '2026-06-20T00:00:01Z', replyToMessageId: 'msg_question' },
      { id: 'msg_detail', role: 'user', body: '接口 /course/save 返回 500', createdAt: '2026-06-20T00:00:02Z' },
    ],
  });
  const resolved = buildResolvedTurnContext({ caseSession: current, latestUserMessage: '接口 /course/save 返回 500' });
  assert.match(resolved.resolvedQuery, /课程保存为什么失败/);
  assert.match(resolved.resolvedQuery, /接口 \/course\/save 返回 500/);
  assert.equal(resolved.confirmedFacts.some((item) => item.sourceMessageId === 'msg_detail'), true);
});

test('experience binds the matching reply to its source run instead of the latest unrelated run', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-binding-'));
  try {
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'tenant_a', userId: 'user_a', workspaceId: 'current', title: 'source' });
    const firstUser = store.addMessage(source, { role: 'user', body: '课程发布后学员为什么看不到入口？' });
    store.addMessage(source, { role: 'helper', body: '第一条已验证回复', replyToMessageId: firstUser.id });
    store.addRun(source, {
      id: 'run_first', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_first', workspaceId: 'current', claudeSessionId: source.claudeSessionId, userGoal: firstUser.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '第一条', missingInfo: [],
        evidence: [{ id: 'ev_first', kind: 'workspace', source: 'first.ts', summary: '第一条证据', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' } }],
        claims: [{ type: 'fact', text: '第一条事实', evidenceIds: ['ev_first'] }], recommendedNextAction: 'final_answer',
      },
    });
    const secondUser = store.addMessage(source, { role: 'user', body: '完全不同的账单问题是什么？' });
    store.addMessage(source, { role: 'helper', body: '第二条回复', replyToMessageId: secondUser.id });
    store.addRun(source, {
      id: 'run_latest', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_latest', workspaceId: 'current', claudeSessionId: source.claudeSessionId, userGoal: secondUser.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '第二条', missingInfo: [],
        evidence: [{ id: 'ev_latest', kind: 'workspace', source: 'latest.ts', summary: '错误的最新证据', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' } }],
        claims: [{ type: 'fact', text: '第二条事实', evidenceIds: ['ev_latest'] }], recommendedNextAction: 'final_answer',
      },
    });
    source.status = 'concluded';
    store.saveCase(source);

    const match = findExperienceMatch({
      store,
      currentCase: { ...caseSession(), createdAt: '', updatedAt: '' },
      userMessage: firstUser.body,
    });
    assert.equal(match.sourceRunId, 'run_first');
    assert.equal(match.result.evidence.some((item) => item.id === 'ev_first'), true);
    assert.equal(match.result.evidence.some((item) => item.id === 'ev_latest'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('experience records stale or invisible same-scope history as rejected context', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-freshness-'));
  try {
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'tenant_a', userId: 'user_a', workspaceId: 'current', title: 'stale source' });
    const user = store.addMessage(source, { role: 'user', body: '课程发布后学员为什么看不到入口？' });
    store.addMessage(source, { role: 'helper', body: '历史回复', replyToMessageId: user.id });
    store.addRun(source, {
      id: 'run_stale', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_stale', workspaceId: 'current', claudeSessionId: source.claudeSessionId, userGoal: user.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '历史结论', missingInfo: [],
        evidence: [{ id: 'ev_stale', kind: 'knowledge', source: 'faq.md', summary: '旧知识', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: '2020-01-01T00:00:00Z', quality: 'ok' } }],
        claims: [{ type: 'fact', text: '历史事实', evidenceIds: ['ev_stale'] }], recommendedNextAction: 'final_answer',
      },
    });
    source.status = 'concluded';
    store.saveCase(source);
    const current = { ...caseSession(), createdAt: '', updatedAt: '' };

    assert.equal(findExperienceMatch({ store, currentCase: current, userMessage: user.body }), undefined);
    const rejected = findRejectedExperienceCandidates({ store, currentCase: current, userMessage: user.body });
    assert.equal(rejected[0].sourceRunId, 'run_stale');
    assert.equal(rejected[0].rejectionReason, 'evidence_not_current_or_visible');

    source.runs[0].result.evidence[0].validation.lastVerifiedAt = new Date().toISOString();
    store.saveCase(source);
    assert.equal(findExperienceMatch({ store, currentCase: current, userMessage: user.body }).sourceRunId, 'run_stale');
    assert.equal(findExperienceMatch({ store, currentCase: { ...current, userPersona: 'customer' }, userMessage: user.body }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('experience matching is isolated by tenant and user', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-isolation-'));
  try {
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'tenant_b', userId: 'user_b', workspaceId: 'current', title: 'other scope' });
    const user = store.addMessage(source, { role: 'user', body: '课程发布后学员为什么看不到入口？' });
    store.addMessage(source, { role: 'helper', body: '跨租户回复', replyToMessageId: user.id });
    store.addRun(source, {
      id: 'run_other', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_other', workspaceId: 'current', claudeSessionId: source.claudeSessionId, userGoal: user.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: { status: 'concluded', summary: 'other', missingInfo: [], evidence: [{ id: 'ev_other', kind: 'workspace', source: 'other', summary: 'other', confidence: 'high' }], claims: [{ type: 'fact', text: 'other', evidenceIds: ['ev_other'] }], recommendedNextAction: 'final_answer' },
    });
    source.status = 'concluded';
    store.saveCase(source);
    const match = findExperienceMatch({ store, currentCase: { ...caseSession(), createdAt: '', updatedAt: '' }, userMessage: user.body });
    assert.equal(match, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('presentation cannot promote partial outcome or render nonexistent evidence claims', () => {
  const partial = {
    status: 'partial', summary: '尚未确认', missingInfo: ['日志'], evidence: [],
    claims: [{ type: 'fact', text: '不存在证据的事实', evidenceIds: ['ev_missing'] }],
    recommendedNextAction: 'ask_user',
  };
  assert.equal(decisionFromReviewOutcome('final_answer', partial), 'ask_user');
  const reply = ruleBasedReviewAndFormat(partial, 'operations');
  assert.doesNotMatch(reply, /不存在证据的事实/);
});

test('runtime ignores a model attempt to promote a frozen partial result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-review-freeze-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ outcome: 'final_answer', reply: '模型虚构的最终结论' }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.agent.modelProvider = 'test';
    config.models.providers.test = {
      type: 'openai-compatible', baseUrl: 'https://api.example.test/v1', apiKey: 'test-key', model: 'test-model', temperature: 0,
    };
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'partial', summary: 'worker 未确认', missingInfo: ['服务日志'],
            evidence: [{ id: 'ev_partial', kind: 'workspace', source: 'src/router.ts', summary: '只定位到入口', confidence: 'medium' }],
            claims: [{ type: 'inference', text: '目前只能确认请求经过该入口。', evidenceIds: ['ev_partial'] }],
            recommendedNextAction: 'ask_user',
          },
          trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"partial"}', stderr: '', exitCode: 0 },
        };
      },
    };
    const agent = new SuperHelperAgent(config, new FileMemoryStore(root), worker);
    const response = await agent.handleUserMessage({ message: '课程保存接口返回 500，请定位原因。' });
    assert.equal(response.decision, 'ask_user');
    assert.match(response.assistantMessage, /目前只能确认请求经过该入口/);
    assert.doesNotMatch(response.assistantMessage, /模型虚构的最终结论/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('deterministic validation rejects duplicate, missing, and low-confidence fact evidence', () => {
  const validation = validateDiagnosticResult({
    status: 'concluded',
    summary: '不应直接形成结论',
    missingInfo: [],
    evidence: [
      { id: 'ev_low', kind: 'workspace', source: 'a.ts', summary: '弱证据', confidence: 'low' },
      { id: 'ev_low', kind: 'workspace', source: 'b.ts', summary: '重复 ID', confidence: 'high' },
      { id: 'ev_unknown', kind: 'unknown', source: 'unknown', summary: '未知来源', confidence: 'high' },
    ],
    claims: [
      { id: 'claim_low', type: 'fact', text: '低置信度事实', evidenceIds: ['ev_low'] },
      { id: 'claim_missing', type: 'fact', text: '不存在证据', evidenceIds: ['ev_missing'] },
      { id: 'claim_unknown', type: 'fact', text: '未知来源事实', evidenceIds: ['ev_unknown'] },
      { id: 'claim_invalid', type: 'invented', text: '非法类型', evidenceIds: ['ev_unknown'] },
    ],
    recommendedNextAction: 'final_answer',
  });
  assert.equal(validation.result.status, 'partial');
  assert.equal(validation.result.recommendedNextAction, 'ask_user');
  assert.deepEqual(validation.acceptedClaimIds, []);
  assert.equal(validation.issues.some((issue) => issue.code === 'duplicate_evidence_id'), true);
  assert.equal(validation.issues.some((issue) => issue.code === 'missing_evidence_reference'), true);
  assert.equal(validation.issues.some((issue) => issue.code === 'low_confidence_fact'), true);
  assert.equal(validation.issues.some((issue) => issue.code === 'invalid_claim_type'), true);
});

test('worker failure fallback never copies raw stdout stderr or secrets into main reply', () => {
  const result = {
    status: 'partial', summary: 'worker failed', missingInfo: [], evidence: [], claims: [], recommendedNextAction: 'escalate_to_human',
  };
  const reply = formatReviewFailureFallback(result, 'operations', 'test', {
    command: 'claude --secret', cwd: '/private/workspace', stdout: 'raw stdout sk-secret-123456', stderr: 'Authorization: Bearer token-secret',
    exitCode: 1, error: 'stack internal', startedAt: '', finishedAt: '',
  }, 'model also failed');
  assert.match(reply, /诊断未完成|工具调用失败/);
  assert.doesNotMatch(reply, /raw stdout|Authorization|sk-secret|token-secret|\/private\/workspace|stack internal/);
});

test('worker trace logging is bounded and redacts contextual secrets', () => {
  const safe = sanitizeWorkerTrace({
    command: `claude --api-key custom-secret-value ${'x'.repeat(3000)}`,
    cwd: '/private/workspace',
    stdout: `Authorization: Bearer bearer-secret\npassword=plain-secret\n${'x'.repeat(9000)}`,
    stderr: 'cookie=session-secret',
    error: 'token=provider-secret',
    exitCode: 1,
    startedAt: '',
    finishedAt: '',
  });
  assert.doesNotMatch(JSON.stringify(safe), /custom-secret-value|bearer-secret|plain-secret|session-secret|provider-secret/);
  assert.match(JSON.stringify(safe), /REDACTED/);
  assert.ok(safe.command.length <= 2000);
  assert.ok(safe.stdout.length <= 8000);
});

test('safety preflight blocks a matching historical write request before Experience', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-safety-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.agent.modelProvider = undefined;
    config.agent.useModelForPreflight = false;
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'local', userId: 'local-user', workspaceId: 'current', title: '历史写请求' });
    const user = store.addMessage(source, { role: 'user', body: '请直接删除生产课程数据' });
    store.addMessage(source, { role: 'helper', body: '历史写操作回复', replyToMessageId: user.id });
    store.addRun(source, {
      id: 'run_write', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_write', workspaceId: 'current', claudeSessionId: source.claudeSessionId, userGoal: user.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '历史写操作', missingInfo: [],
        evidence: [{ id: 'ev_write', kind: 'workspace', source: 'admin.ts', summary: '写操作入口', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' } }],
        claims: [{ type: 'fact', text: '存在写操作入口', evidenceIds: ['ev_write'] }], recommendedNextAction: 'final_answer',
      },
    });
    source.status = 'concluded';
    store.saveCase(source);
    const worker = { async diagnose() { throw new Error('safety preflight must stop before worker'); } };
    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({ message: user.body });

    assert.equal(response.decision, 'ask_user');
    assert.match(response.assistantMessage, /当前只允许只读诊断/);
    assert.equal(response.caseSession.logs.some((event) => event.phase === 'experience_started'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync first turn and async unknown follow-up share one resolved query across runtime stages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-resolved-runtime-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.agent.modelProvider = undefined;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = process.cwd();
    const requests = [];
    const worker = {
      async diagnose(request) {
        requests.push(request);
        return {
          result: {
            status: 'concluded',
            summary: '已完成只读排查。',
            missingInfo: [],
            evidence: [{ id: `ev_${requests.length}`, kind: 'workspace', source: 'src/example.ts', summary: '当前工作区证据。', confidence: 'high' }],
            claims: [{ type: 'fact', text: '当前工作区可继续核验该问题。', evidenceIds: [`ev_${requests.length}`] }],
            recommendedNextAction: 'final_answer',
          },
          trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"ok"}', stderr: '', exitCode: 0 },
        };
      },
    };
    const agent = new SuperHelperAgent(config, new FileMemoryStore(root), worker);
    const originalQuestion = '课程发布后学员为什么看不到入口？';
    const first = await agent.handleUserMessage({ message: originalQuestion });
    const accepted = agent.startUserTurn({ caseId: first.caseSession.id, message: '不清楚' });
    const second = await agent.completeUserTurn(accepted.id, '不清楚');

    assert.equal(requests.length, 2);
    assert.equal(requests[1].userGoal, originalQuestion);
    assert.equal(requests[1].context.resolvedTurn.resolvedQuery, originalQuestion);
    assert.equal(requests[1].context.resolvedTurn.latestUserMessage, '不清楚');
    assert.equal(requests[1].unknowns.includes('不清楚'), true);
    assert.equal(second.caseSession.messages.some((message) => message.role === 'user' && message.body === '不清楚'), true);

    const phase = (name) => second.caseSession.logs.find((event) => event.phase === name && event.createdAt >= accepted.updatedAt);
    assert.equal(phase('experience_started').detail.message, originalQuestion);
    assert.equal(phase('knowledge_router_started').detail.message, originalQuestion);
    assert.equal(phase('diagnostic_request').detail.userGoal, originalQuestion);
    assert.ok(second.caseSession.logs.findIndex((event) => event.phase === 'preflight_started') < second.caseSession.logs.findIndex((event) => event.phase === 'experience_started'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

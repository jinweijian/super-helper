import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { SuperHelperAgent } from '../dist/agent.js';
import { ClaudeCodeWorker } from '../dist/claude-worker.js';
import { loadConfig } from '../dist/config.js';
import { createModelClient } from '../dist/model.js';
import { renderApp } from '../dist/ui.js';
import { FileMemoryStore } from '../dist/storage.js';
import { startServer } from '../dist/server.js';
import { initKnowledgeWorkspace, resolveKnowledgeWorkspaceRoot, updateKnowledgeIndex } from '../dist/knowledge/index.js';
import { failedExecutionDiagnosticResult, mockDiagnosticResponse, parseClaudeOutput } from '../dist/workers/claude/claude-output-parser.js';
import { assertHostCommandAllowed, readOnlyTools } from '../dist/workers/claude/claude-policy.js';
import { buildDiagnosticRequestContext } from '../dist/sessions/context-builder.js';
import { buildDiagnosticRequest, buildFollowUpDiagnosticRequest } from '../dist/runtime/request-builder.js';
import { buildLocalPreflightDecision, isGenericWorkspaceFollowUp, summarizePreflightDecision } from '../dist/runtime/preflight-gate.js';
import {
  caseStatusFromDiagnosticResult,
  decisionFromDiagnosticResult,
  decisionFromReviewOutcome,
  shouldRunFollowUp,
} from '../dist/runtime/review-gate.js';
import { formatPreflightQuestion, personaGuide, personaName, ruleBasedReviewAndFormat } from '../dist/runtime/presenter.js';
import { listPublicAgentConfigs, loadAgentRegistry, resolveAgentConfig } from '../dist/runtime/agent-configs.js';
import { judgeKnowledgeEvidence } from '../dist/runtime/evidence-judge.js';
import { planDeepQuery } from '../dist/runtime/deep-query-planner.js';
import { curateSolvedCase, hasCuratableDiagnosticResult, isResolutionConfirmation } from '../dist/runtime/case-curator.js';

function baseConfig(rootDir) {
  return {
    version: 1,
    server: { host: '127.0.0.1', port: 4317 },
    storage: { rootDir, isolateByWorkspace: true },
    knowledge: { rootDir: join(rootDir, 'knowledge-store'), isolateByWorkspace: true },
    agent: {
      name: 'super helper',
      language: 'zh-CN',
      tone: 'calm_professional',
      modelProvider: 'minimax',
      useModelForPreflight: true,
      defaultUserPersona: 'operations',
      contextWindowTokens: 200000,
    },
    models: {
      providers: {
        minimax: {
          type: 'openai-compatible',
          baseUrl: 'https://api.example.test/v1',
          apiKey: 'test-key',
          model: 'MiniMax-M3',
          temperature: 0,
        },
      },
    },
    claude: {
      enabled: true,
      command: 'claude',
      commandWhitelist: ['claude', process.execPath],
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
      timeoutMs: 1000,
      maxBudgetUsd: 0.2,
      sessionBusyMaxRetries: 0,
      sessionBusyRetryDelayMs: 1,
    },
    workspaces: [{ id: 'current', name: 'Current Project', rootPath: process.cwd(), mcpToolIds: [] }],
    mcpTools: [],
  };
}

function chatResponse(content) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function waitFor(assertion, timeoutMs = 2000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

test('composer sends on Enter and keeps Shift+Enter for newline', () => {
  const html = renderApp();

  assert.match(html, /event\.key === 'Enter'/);
  assert.match(html, /!event\.shiftKey/);
  assert.match(html, /event\.preventDefault\(\)/);
});

test('app exposes a model settings and test entry', () => {
  const html = renderApp();

  assert.match(html, /openSettings\(\)/);
  assert.match(html, /测试模型/);
  assert.match(html, /保存配置/);
  assert.match(html, /上下文窗口 Tokens/);
  assert.match(html, /id="contextWindowTokens"/);
  assert.match(html, /contextWindowTokens: Number\(document\.getElementById\('contextWindowTokens'\)\.value/);
});

test('app surfaces interrupted requests and exposes session controls', () => {
  const html = renderApp();

  assert.match(html, /thinking-indicator/);
  assert.match(html, /typeWriter/);
  assert.match(html, /context-meter/);
  assert.match(html, /pollSessionUntilSettled/);
  assert.match(html, /catch \(error\)/);
  assert.match(html, /请求中断/);
  assert.match(html, /\/api\/sessions/);
  assert.match(html, /loadSessions\(\)/);
  assert.match(html, /openSession/);
  assert.match(html, /toggleSessionMenu/);
  assert.match(html, /session-menu/);
  assert.match(html, /更多选项/);
  assert.match(html, /归档/);
  assert.match(html, /删除/);
  assert.match(html, /log-block error/);
  assert.match(html, /log-block warn/);
  assert.match(html, /log-block ok/);
  assert.match(html, /\.msg\.helper pre/);
  assert.match(html, /preBlocks/);
  assert.match(html, /escapeHtml\(raw\)/);
});

test('chat messages keep pasted code and long commands inside the viewport', () => {
  const html = renderApp();

  assert.match(html, /\.chat \{[^}]*min-width: 0;[^}]*\}/);
  assert.match(html, /\.msg \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;[^}]*\}/);
  assert.match(html, /\.msg\.helper pre \{[^}]*max-width: 100%;[^}]*overflow: auto;[^}]*\}/);
  assert.match(html, /textarea \{[^}]*overflow-wrap: anywhere;[^}]*\}/);
});

test('app restores in-progress polling after reloading an active session', () => {
  const html = renderApp();

  assert.match(html, /function restorePendingTurn\(session\)/);
  assert.match(html, /isSessionInProgress\(session\)/);
  assert.match(html, /latestPendingUserMessage\(session\.messages \|\| \[\]\)/);
  assert.match(html, /pollSessionUntilSettled\(pending, session\.id, pendingUserMessage\.id\)/);
  assert.match(html, /restorePendingTurn\(json\.session\)/);
});

test('truncated visible metadata exposes title tooltips', () => {
  const html = renderApp();

  assert.match(html, /workspace\.title = workspaceText/);
  assert.match(html, /title\.title = titleText/);
  assert.match(html, /meta\.title = metaText/);
  assert.match(html, /meter\.title = text\.textContent/);
  assert.match(html, /class="session-title" title="/);
  assert.match(html, /class="session-meta" title="/);
});

test('diagnostic log drawer uses natural-height rows instead of grid-compressed tracks', () => {
  const html = renderApp();

  assert.doesNotMatch(html, /\.logs \{[^}]*display: grid;[^}]*\}/);
  assert.match(html, /\.logs \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*\}/);
  assert.match(html, /\.log-block \{[^}]*flex: 0 0 auto;[^}]*\}/);
});

test('diagnostic log drawer refreshes only when opened or manually requested', () => {
  const html = renderApp();
  const latestLogSummaryBody = html.match(/async function latestLogSummary\(\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';

  assert.match(html, /<button onclick="refreshLogs\(\)">刷新<\/button>/);
  assert.doesNotMatch(html, /logRefreshTimer/);
  assert.doesNotMatch(html, /setInterval\(refreshLogs/);
  assert.doesNotMatch(latestLogSummaryBody, /renderLogs\(json\)/);
});

test('diagnostic log drawer renders Claude command as a dedicated command block', () => {
  const html = renderApp();

  assert.match(html, /block\.command/);
  assert.match(html, /class="log-command"/);
  assert.match(html, /Claude Code 命令/);
});

test('composer keeps status chips out of the action row', () => {
  const html = renderApp();

  assert.match(html, /class="composer-meta status-pills"/);
  assert.match(html, /class="composer-actions"/);
  assert.match(html, /class="persona-control"/);
  assert.match(html, /class="persona-label"/);
  assert.doesNotMatch(html, /<label>用户视角<select id="personaSelect"/);
  assert.doesNotMatch(html, /class="composer-row"/);
  assert.match(
    html,
    /<div class="composer-meta status-pills">[\s\S]*Agent 审核[\s\S]*session 复用[\s\S]*<\/div>\s*<div class="composer-actions">[\s\S]*persona-control[\s\S]*sendButton/,
  );
  assert.doesNotMatch(html, /<div class="composer-actions">[\s\S]*status-pills[\s\S]*<\/div>/);
  assert.match(html, /\.composer-meta \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*\}/);
  assert.match(html, /\.composer-actions \{[^}]*display: flex;[^}]*justify-content: space-between;[^}]*align-items: center;[^}]*\}/);
  assert.match(html, /\.persona-control \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*\}/);
});

test('settings API sanitizes secrets and can test model connectivity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  let server;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'MiniMax-M3');
    assert.equal(body.messages.at(-1).content.includes('super helper model connectivity test'), true);
    return chatResponse('model ok');
  };

  try {
    const config = baseConfig(dir);
    config.server.port = 43971;
    config.models.providers.minimax.apiKey = 'secret-value';
    server = await startServer({ config });

    const settings = await originalFetch('http://127.0.0.1:43971/api/settings').then((res) => res.json());
    assert.equal(settings.agent.modelProvider, 'minimax');
    assert.equal(settings.models.providers.minimax.hasApiKey, true);
    assert.equal('apiKey' in settings.models.providers.minimax, false);
    assert.equal(settings.claude.timeoutMs, 1000);

    const claudeSettings = await originalFetch('http://127.0.0.1:43971/api/settings/claude', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeoutMs: 180000, maxBudgetUsd: 0.5 }),
    }).then((res) => res.json());

    assert.equal(claudeSettings.claude.timeoutMs, 180000);
    assert.equal(claudeSettings.claude.maxBudgetUsd, 0.5);

    const testResult = await originalFetch('http://127.0.0.1:43971/api/settings/model/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'minimax' }),
    }).then((res) => res.json());

    assert.equal(testResult.ok, true);
    assert.equal(testResult.providerId, 'minimax');
    assert.equal(testResult.model, 'MiniMax-M3');
  } finally {
    if (server) {
      await server.close();
    }
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model client times out instead of hanging agent review forever', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
    });

  try {
    const client = createModelClient({
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      timeoutMs: 10,
    });

    await assert.rejects(
      () => client.complete([{ role: 'user', content: 'hello' }]),
      /Model request timed out after 10ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sessions API lists, creates, and loads reusable chat sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43972;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const created = await fetch('http://127.0.0.1:43972/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '你好，这是一个新会话。' }),
    }).then((res) => res.json());

    const sessions = await fetch('http://127.0.0.1:43972/api/sessions').then((res) => res.json());
    assert.equal(sessions.sessions.length, 1);
    assert.equal(sessions.sessions[0].id, created.caseId);
    assert.equal(typeof sessions.sessions[0].claudeSessionId, 'string');

    const loaded = await fetch(`http://127.0.0.1:43972/api/session?caseId=${created.caseId}`).then((res) => res.json());
    assert.equal(loaded.session.id, created.caseId);
    assert.equal(loaded.session.messages.length, 2);

    const blank = await fetch('http://127.0.0.1:43972/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '新项目提问' }),
    }).then((res) => res.json());
    assert.equal(blank.session.title, '新项目提问');
    assert.equal(blank.session.messages.length, 0);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('server scopes session storage by active workspace root', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'super-helper-shared-storage-'));
  const workspaceOne = mkdtempSync(join(tmpdir(), 'super-helper-workspace-one-'));
  const workspaceTwo = mkdtempSync(join(tmpdir(), 'super-helper-workspace-two-'));
  let firstServer;
  let secondServer;

  try {
    const firstConfig = baseConfig(storageDir);
    firstConfig.server.port = 43980;
    firstConfig.agent.useModelForPreflight = false;
    firstConfig.agent.modelProvider = undefined;
    firstConfig.claude.enabled = false;
    firstConfig.workspaces[0] = {
      id: 'current',
      name: 'Workspace One',
      rootPath: workspaceOne,
      mcpToolIds: [],
    };
    firstServer = await startServer({ config: firstConfig });

    const created = await fetch('http://127.0.0.1:43980/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '第一个 workspace 的会话' }),
    }).then((res) => res.json());

    const firstSessions = await fetch('http://127.0.0.1:43980/api/sessions').then((res) => res.json());
    assert.equal(firstSessions.sessions.length, 1);
    assert.equal(firstSessions.sessions[0].id, created.caseId);

    const secondConfig = baseConfig(storageDir);
    secondConfig.server.port = 43981;
    secondConfig.agent.useModelForPreflight = false;
    secondConfig.agent.modelProvider = undefined;
    secondConfig.claude.enabled = false;
    secondConfig.workspaces[0] = {
      id: 'current',
      name: 'Workspace Two',
      rootPath: workspaceTwo,
      mcpToolIds: [],
    };
    secondServer = await startServer({ config: secondConfig });

    const secondInitialSessions = await fetch('http://127.0.0.1:43981/api/sessions').then((res) => res.json());
    assert.equal(secondInitialSessions.sessions.length, 0);

    const secondCreated = await fetch('http://127.0.0.1:43981/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '第二个 workspace 的会话' }),
    }).then((res) => res.json());

    const secondSessions = await fetch('http://127.0.0.1:43981/api/sessions').then((res) => res.json());
    assert.equal(secondSessions.sessions.length, 1);
    assert.equal(secondSessions.sessions[0].id, secondCreated.caseId);
    assert.notEqual(secondCreated.caseId, created.caseId);

    const firstSessionsAfterSecondWorkspace = await fetch('http://127.0.0.1:43980/api/sessions').then((res) => res.json());
    assert.equal(firstSessionsAfterSecondWorkspace.sessions.length, 1);
    assert.equal(firstSessionsAfterSecondWorkspace.sessions[0].id, created.caseId);
  } finally {
    if (secondServer) {
      await secondServer.close();
    }
    if (firstServer) {
      await firstServer.close();
    }
    rmSync(storageDir, { recursive: true, force: true });
    rmSync(workspaceOne, { recursive: true, force: true });
    rmSync(workspaceTwo, { recursive: true, force: true });
  }
});

test('public API routes keep compatible response shapes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  let server;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'MiniMax-M3');
    assert.match(body.messages.at(-1).content, /connectivity test/);
    return chatResponse('model ok');
  };

  try {
    const config = baseConfig(dir);
    config.server.port = 43977;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const baseUrl = 'http://127.0.0.1:43977';
    const chat = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'developer', message: '请解释这个项目的 package.json 主要做什么。' }),
    }).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });

    assert.equal(typeof chat.caseId, 'string');
    assert.equal(typeof chat.claudeSessionId, 'string');
    assert.equal(typeof chat.title, 'string');
    assert.equal(typeof chat.status, 'string');
    assert.equal(typeof chat.message, 'string');
    assert.equal(typeof chat.decision, 'string');
    assert.equal(chat.persona, 'developer');
    assert.equal(typeof chat.contextUsage.estimatedTokens, 'number');

    const session = await originalFetch(`${baseUrl}/api/session?caseId=${chat.caseId}`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(session.session.id, chat.caseId);
    assert.equal(Array.isArray(session.session.messages), true);
    assert.equal(Array.isArray(session.session.runs), true);
    assert.equal(typeof session.session.contextUsage.limitTokens, 'number');

    const sessions = await originalFetch(`${baseUrl}/api/sessions`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(Array.isArray(sessions.sessions), true);
    assert.ok(sessions.sessions.some((item) => item.id === chat.caseId));

    const settings = await originalFetch(`${baseUrl}/api/settings`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(typeof settings.agent.name, 'string');
    assert.equal(settings.models.providers.minimax.hasApiKey, true);
    assert.equal(settings.models.providers.minimax.apiKey, undefined);
    assert.equal(typeof settings.claude.timeoutMs, 'number');

    const modelTest = await originalFetch(`${baseUrl}/api/settings/model/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'minimax' }),
    }).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(modelTest.ok, true);
    assert.equal(modelTest.reply, 'model ok');

    const logs = await originalFetch(`${baseUrl}/api/logs?caseId=${chat.caseId}`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(Array.isArray(logs.blocks), true);
    assert.equal(Array.isArray(logs.logs), true);
    assert.ok(logs.blocks.some((block) => block.phase === 'input_received'));
  } finally {
    if (server) {
      await server.close();
    }
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('case store records structured diagnostic log events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '日志测试',
    });

    assert.equal(typeof store.addLogEvent, 'function');
    store.addLogEvent(caseSession, {
      actor: 'agent',
      phase: 'preflight',
      summary: 'Agent started preflight',
      detail: { action: 'dispatch' },
    });

    const loaded = store.loadCase(caseSession.id);
    assert.equal(loaded.logs.length, 1);
    assert.equal(loaded.logs[0].actor, 'agent');
    assert.equal(loaded.logs[0].phase, 'preflight');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude Code worker reuses the per-case Claude session instead of disabling persistence', async () => {
  const config = baseConfig(mkdtempSync(join(tmpdir(), 'super-helper-test-')));
  config.claude.command = process.execPath;
  config.claude.timeoutMs = 1000;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      userGoal: '查一下项目里 package.json 的用途',
      knownFacts: ['用户在问项目问题'],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.match(response.trace.command, /--session-id 11111111-1111-4111-8111-111111111111/);
    assert.doesNotMatch(response.trace.command, /--no-session-persistence/);
    assert.match(response.trace.command, /read that file first/);
  } finally {
    rmSync(config.storage.rootDir, { recursive: true, force: true });
  }
});

test('Claude Code worker resumes an existing Claude session on follow-up runs', async () => {
  const config = baseConfig(mkdtempSync(join(tmpdir(), 'super-helper-test-')));
  config.claude.command = process.execPath;
  config.claude.timeoutMs = 1000;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_02',
      workspaceId: 'current',
      claudeSessionId: '55555555-5555-4555-8555-555555555555',
      userGoal: '继续追问 doing 流程',
      knownFacts: ['上一轮已经分析过 q2'],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.match(response.trace.command, /--resume 55555555-5555-4555-8555-555555555555/);
    assert.doesNotMatch(response.trace.command, /--session-id 55555555-5555-4555-8555-555555555555/);
  } finally {
    rmSync(config.storage.rootDir, { recursive: true, force: true });
  }
});

test('Claude Code worker separates system prompt from user payload and enforces read-only tools', async () => {
  const config = baseConfig(mkdtempSync(join(tmpdir(), 'super-helper-test-')));
  config.claude.command = process.execPath;
  config.claude.tools = ['Read', 'Glob', 'Grep', 'Bash', 'Edit'];
  config.claude.timeoutMs = 1000;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '22222222-2222-4222-8222-222222222222',
      userGoal: '只读分析 package.json',
      knownFacts: ['用户要求只读'],
      unknowns: [],
      constraints: ['Do not modify files.'],
      allowedMcpToolIds: [],
      userPersona: 'operations',
    });

    assert.match(response.trace.command, /--system-prompt /);
    assert.match(response.trace.command, /--allowedTools Read,Glob,Grep/);
    assert.match(response.trace.command, /--tools Read,Glob,Grep/);
    assert.match(response.trace.command, /--disallowedTools /);
    assert.match(response.trace.command, /DiagnosticRequest\.context/);
    assert.match(response.trace.command, /answer the latest userGoal first/i);
    assert.match(response.trace.command, /Before returning need_input for a selected workspace/);
    assert.match(response.trace.command, /Use Glob or Grep to inspect the current workspace/);
    assert.match(response.trace.command, /Do not cite paths outside the active workspace root as workspace evidence/);
    assert.match(response.trace.command, /Bash/);
    assert.match(response.trace.command, /Edit/);
    assert.doesNotMatch(response.trace.command, /--tools [^']*Bash/);
    assert.doesNotMatch(response.trace.command, /--allowedTools [^']*Edit/);
  } finally {
    rmSync(config.storage.rootDir, { recursive: true, force: true });
  }
});

test('Claude Code worker retries when a reused session is temporarily busy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const counterPath = join(dir, 'counter.txt');
  const workerPath = join(dir, 'fake-claude-worker.mjs');
  writeFileSync(
    workerPath,
    `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const counterPath = ${JSON.stringify(counterPath)};
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;
writeFileSync(counterPath, String(count + 1));
if (count === 0) {
  console.error('Error: Session ID 33333333-3333-4333-8333-333333333333 is already in use.');
  process.exit(1);
}
const result = {
  status: 'concluded',
  summary: 'retry succeeded',
  missingInfo: [],
  evidence: [{ id: 'ev_01', kind: 'workspace', source: 'package.json', summary: 'read-only evidence', confidence: 'high' }],
  claims: [{ type: 'fact', text: 'retry succeeded after busy session', evidenceIds: ['ev_01'] }],
  recommendedNextAction: 'final_answer'
};
console.log(JSON.stringify({ result: JSON.stringify(result) }));
`,
    'utf8',
  );
  chmodSync(workerPath, 0o755);

  const config = baseConfig(dir);
  config.claude.command = workerPath;
  config.claude.commandWhitelist = [workerPath];
  config.claude.sessionBusyMaxRetries = 2;
  config.claude.sessionBusyRetryDelayMs = 1;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '33333333-3333-4333-8333-333333333333',
      userGoal: '只读分析 package.json',
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.equal(response.result.summary, 'retry succeeded');
    assert.equal(response.trace.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude Code worker turns Claude result subtypes into partial diagnostics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workerPath = join(dir, 'fake-budget-worker.mjs');
  writeFileSync(
    workerPath,
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 0.21, errors: [] }));
`,
    'utf8',
  );
  chmodSync(workerPath, 0o755);

  const config = baseConfig(dir);
  config.claude.command = workerPath;
  config.claude.commandWhitelist = [workerPath];
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '44444444-4444-4444-8444-444444444444',
      userGoal: '分析 q2',
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.equal(response.result.status, 'partial');
    assert.match(response.result.summary, /error_max_budget_usd/);
    assert.equal(response.result.recommendedNextAction, 'continue_diagnosis');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude Code worker surfaces CLI API connection failures in the diagnostic result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workerPath = join(dir, 'fake-connection-worker.mjs');
  writeFileSync(
    workerPath,
    `#!/usr/bin/env node
console.log(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: 'API Error: Connection error.',
  usage: { input_tokens: 0, output_tokens: 0 },
  total_cost_usd: 0
}));
process.exit(1);
`,
    'utf8',
  );
  chmodSync(workerPath, 0o755);

  const config = baseConfig(dir);
  config.claude.command = workerPath;
  config.claude.commandWhitelist = [workerPath];
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '66666666-6666-4666-8666-666666666666',
      userGoal: '查找倍速播放路由',
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.equal(response.result.status, 'partial');
    assert.match(response.result.summary, /Claude Code 调用失败：API Error: Connection error\./);
    assert.doesNotMatch(response.result.summary, /模拟诊断结果/);
    assert.match(response.result.evidence[0].summary, /exitCode=1/);
    assert.equal(response.result.recommendedNextAction, 'escalate_to_human');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude worker helper modules parse output, downgrade failures, and narrow policy', () => {
  const request = {
    caseId: 'case_test',
    runId: 'run_01',
    workspaceId: 'current',
    claudeSessionId: '77777777-7777-4777-8777-777777777777',
    userGoal: '分析 package.json',
    knownFacts: [],
    unknowns: ['traceId'],
    constraints: [],
    allowedMcpToolIds: [],
  };
  const structured = {
    status: 'concluded',
    summary: 'parsed result',
    missingInfo: [],
    evidence: [{ id: 'ev_01', kind: 'workspace', source: 'package.json', summary: 'read evidence', confidence: 'high' }],
    claims: [{ type: 'fact', text: 'parsed', evidenceIds: ['ev_01'] }],
    recommendedNextAction: 'final_answer',
  };

  const parsed = parseClaudeOutput(JSON.stringify({ result: JSON.stringify(structured) }), request);
  assert.equal(parsed.summary, 'parsed result');
  assert.equal(parsed.recommendedNextAction, 'final_answer');

  const fenced = parseClaudeOutput(
    JSON.stringify({
      result: `The template uses {% if org.depth < 15 %} before the real result.

\`\`\`json
${JSON.stringify({ ...structured, summary: 'parsed fenced result with earlier braces' }, null, 2)}
\`\`\``,
    }),
    request,
  );
  assert.equal(fenced.summary, 'parsed fenced result with earlier braces');
  assert.equal(fenced.recommendedNextAction, 'final_answer');

  const disabled = mockDiagnosticResponse(request, 'Claude Code worker disabled in config.', '2026-01-01T00:00:00.000Z');
  assert.equal(disabled.result.status, 'partial');
  assert.equal(disabled.result.missingInfo[0], 'traceId');
  assert.equal(disabled.trace.command, 'claude worker not executed');

  const failed = failedExecutionDiagnosticResult(request, {
    stdout: JSON.stringify({ result: 'API Error: Connection error.' }),
    stderr: '',
    exitCode: 1,
  });
  assert.equal(failed.status, 'partial');
  assert.match(failed.summary, /API Error: Connection error\./);
  assert.equal(failed.recommendedNextAction, 'escalate_to_human');

  assert.deepEqual(readOnlyTools(['Read', 'Bash', 'Edit']), ['Read']);
  assert.deepEqual(readOnlyTools(['Bash']), ['Read', 'Glob', 'Grep']);
  assert.equal(assertHostCommandAllowed('claude', ['claude']), undefined);
  assert.match(assertHostCommandAllowed('rm', ['claude']), /not in super helper command whitelist/);
});

test('model client includes fetch cause codes in connection errors', async () => {
  const originalFetch = globalThis.fetch;
  const cause = new Error('Connect Timeout Error');
  cause.code = 'UND_ERR_CONNECT_TIMEOUT';
  globalThis.fetch = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause });
  };

  try {
    const client = createModelClient({
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      timeoutMs: 1000,
    });

    await assert.rejects(
      () => client.complete([{ role: 'user', content: 'test' }]),
      /fetch failed: UND_ERR_CONNECT_TIMEOUT Connect Timeout Error/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('config activates the only configured model provider for local agent runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const configPath = join(dir, 'config.json');
  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.models.providers = {
      minimax: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M3',
      },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const loaded = loadConfig(configPath);

    assert.equal(loaded.agent.modelProvider, 'minimax');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config defaults missing knowledge storage under the configured storage root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const configPath = join(dir, 'config.json');
  try {
    const config = baseConfig(dir);
    delete config.knowledge;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const loaded = loadConfig(configPath);

    assert.equal(loaded.knowledge.rootDir, join(dir, 'knowledge'));
    assert.equal(loaded.knowledge.isolateByWorkspace, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime answers directly from knowledge evidence before calling the worker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: 'worker should not be called for answerable knowledge',
          missingInfo: [],
          evidence: [{ id: 'ev_worker', kind: 'workspace', source: 'worker', summary: 'worker called', confidence: 'low' }],
          claims: [{ type: 'fact', text: 'worker called', evidenceIds: ['ev_worker'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-study',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。学习计划生成后包含任务数、学习总时长、学习起止时间、每周学习日和每日学习时长。',
      terms: ['AI伴学助手', '制定学习计划', '学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new SuperHelperAgent(config, store, worker);

    const response = await agent.handleUserMessage({
      message: 'AI伴学助手怎么制定学习计划？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 0);
    assert.equal(existsSync(join(workspace, 'knowledge')), false);
    assert.equal(response.decision, 'final');
    assert.equal(response.caseSession.runs.length, 1);
    assert.equal(response.caseSession.runs[0].result.evidence[0].kind, 'knowledge');
    assert.match(response.assistantMessage, /AI伴学助手如何制定学习计划/);
    assert.match(response.assistantMessage, /支撑证据/);
    assert.match(response.assistantMessage, /来源：knowledge\/faq\/ai-study/);
    assert.equal(response.caseSession.logs.some((event) => event.phase === 'knowledge_search_result'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime broadens source type filters so whitepaper evidence can answer natural how-to questions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      throw new Error('worker should not be called for whitepaper-backed knowledge answer');
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeWhitepaper(knowledgeWorkspace, {
      module: 'ai-study',
      title: '学习日晚上8点',
      body: '学习日晚上8点未完成当日学习任务时向以对话框消息和APP通知的形式向学员发送学习提醒。',
      terms: ['AI伴学助手', '督学提醒', '学习日晚上8点'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new SuperHelperAgent(config, store, worker);

    const response = await agent.handleUserMessage({
      message: 'AI伴学助手学习日晚上8点未完成任务会怎么提醒？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 0);
    assert.equal(response.decision, 'final');
    assert.match(response.assistantMessage, /学习日晚上8点/);
    assert.match(response.assistantMessage, /APP通知/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime escalates no-hit or implementation-detail knowledge questions with deep query context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: '已升级并检查当前接口实现',
          missingInfo: [],
          evidence: [{ id: 'ev_code_partial', kind: 'workspace', source: 'Grep:/api/orders', summary: '需要进一步静态调查', confidence: 'low' }],
          claims: [{ type: 'unknown', text: '知识库没有命中，需要代码证据', evidenceIds: ['ev_code_partial'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-study',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。',
      terms: ['AI伴学助手', '制定学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new SuperHelperAgent(config, store, worker);

    await agent.handleUserMessage({
      message: '接口 /api/orders 返回 500，帮我看当前实现为什么失败',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 1);
    assert.equal(workerRequests[0].context.knowledge.judge.need_code_escalation, true);
    assert.equal(workerRequests[0].context.deepQuery.permission, 'read_only');
    assert.equal(workerRequests[0].context.deepQuery.artifactTargets.includes('route'), true);
    assert.match(workerRequests[0].constraints.join('\n'), /知识库证据不足/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime does not expose restricted knowledge directly to customer persona', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: 'restricted knowledge was not shown directly',
          missingInfo: [],
          evidence: [{ id: 'ev_worker', kind: 'workspace', source: 'worker', summary: 'worker fallback used', confidence: 'low' }],
          claims: [{ type: 'unknown', text: 'restricted knowledge requires controlled handling', evidenceIds: ['ev_worker'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'course',
      intent: 'how_to',
      title: '课程隐藏规则内部排查',
      body: '内部排查步骤：检查隐藏规则和权限策略。',
      terms: ['课程', '隐藏规则', '权限策略'],
      visibility: 'restricted',
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new SuperHelperAgent(config, store, worker);

    const response = await agent.handleUserMessage({
      message: '课程隐藏规则怎么处理？',
      workspaceId: 'current',
      persona: 'customer',
    });

    assert.equal(workerRequests.length, 1);
    assert.doesNotMatch(response.assistantMessage, /内部排查步骤/);
    assert.match(workerRequests[0].context.knowledge.judge.reason, /restricted|受限|权限|知识库/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('evidence judge handles direct answers, stale or conflicting evidence, high risk, and query correction pivots', () => {
  const route = {
    normalizedQuestion: '课程发布后为什么学员看不到',
    moduleCandidates: ['course'],
    intentCandidates: ['how_to'],
    keywords: ['课程', '发布', '学员', '看不到'],
    sourceTypes: ['faq'],
    codeEscalationSignals: [],
    risks: [],
  };
  const activeFaq = knowledgeEvidence({
    id: 'ev_faq_active',
    status: 'active',
    sourceType: 'faq',
    matchedTerms: ['课程', '发布', '学员', '看不到'],
    verifiedAt: '2999-01-01',
  });

  const direct = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([activeFaq]),
    question: route.normalizedQuestion,
  });
  assert.equal(direct.answerable, true);
  assert.equal(direct.need_code_escalation, false);
  assert.equal(direct.recommended_next_action, 'final_answer');

  const directRunbook = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      knowledgeEvidence({
        id: 'ev_runbook_active',
        status: 'active',
        sourceType: 'runbook',
        matchedTerms: ['课程', '发布', '学员', '看不到'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(directRunbook.answerable, true);
  assert.equal(directRunbook.need_code_escalation, false);

  const conflict = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      activeFaq,
      knowledgeEvidence({
        id: 'ev_faq_deprecated',
        status: 'deprecated',
        sourceType: 'faq',
        matchedTerms: ['课程', '发布'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(conflict.answerable, false);
  assert.equal(conflict.need_code_escalation, true);
  assert.deepEqual(conflict.conflicts, ['course:how_to']);

  const stale = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      knowledgeEvidence({
        id: 'ev_review_required',
        status: 'review_required',
        sourceType: 'runbook',
        matchedTerms: ['课程', '发布', '学员'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(stale.answerable, false);
  assert.equal(stale.risks.includes('stale_knowledge'), true);

  const highRisk = judgeKnowledgeEvidence({
    route: { ...route, risks: ['payment'] },
    evidencePack: knowledgePack([activeFaq]),
    question: '支付退款配置怎么修复',
  });
  assert.equal(highRisk.answerable, false);
  assert.equal(highRisk.recommended_next_action, 'escalate_to_human');

  const implementationJudge = judgeKnowledgeEvidence({
    route: { ...route, codeEscalationSignals: ['/api/orders', '500'] },
    evidencePack: knowledgePack([]),
    question: '定时任务调用 /api/orders 返回 500',
  });
  const deepQuery = planDeepQuery({
    question: '定时任务调用 /api/orders 返回 500',
    route: { ...route, codeEscalationSignals: ['/api/orders', '500'] },
    evidencePack: knowledgePack([]),
    judge: implementationJudge,
  });
  assert.equal(deepQuery.permission, 'read_only');
  assert.equal(deepQuery.correctionActions.includes('expand_aliases'), true);
  assert.equal(deepQuery.correctionActions.includes('pivot_scheduler_to_queue_callback_state'), true);
  assert.equal(deepQuery.correctionActions.includes('pivot_route_to_controller_service_config'), true);

  const draft = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      knowledgeEvidence({
        id: 'ev_draft',
        status: 'draft',
        sourceType: 'faq',
        matchedTerms: ['课程', '发布', '学员', '看不到'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(draft.answerable, false);
  assert.equal(draft.need_code_escalation, true);
});

test('runtime curates a review-required solved case after user confirms resolution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const worker = {
    async diagnose() {
      throw new Error('worker should not be called for solved-case curation');
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-study',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。',
      terms: ['AI伴学助手', '制定学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new SuperHelperAgent(config, store, worker);
    const first = await agent.handleUserMessage({
      message: 'AI伴学助手怎么制定学习计划？',
      workspaceId: 'current',
    });

    const confirmed = await agent.handleUserMessage({
      caseId: first.caseSession.id,
      message: '已解决，这个方案有效',
      workspaceId: 'current',
    });

    const solvedDir = join(knowledgeWorkspace, 'knowledge', 'tickets', 'solved-cases', 'ai-study');
    const files = readdirSync(solvedDir).filter((file) => file.endsWith('.md'));
    const content = readFileSync(join(solvedDir, files[0]), 'utf8');

    assert.match(confirmed.assistantMessage, /solved case 草稿/);
    assert.match(content, /status: review_required/);
    assert.match(content, /confidence: medium/);
    assert.match(content, /## 用户最终确认/);
    assert.equal(existsSync(join(workspace, 'knowledge')), false);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'indexes', 'dirty.flag')), true);
    assert.equal(confirmed.caseSession.logs.some((event) => event.phase === 'case_curator_result'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('case curator keeps high-risk drafts restricted and refuses unsupported facts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));

  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '支付退款配置怎么修复',
    });
    caseSession.userPersona = 'developer';
    store.addMessage(caseSession, { role: 'user', body: '支付退款配置怎么修复？' });

    assert.equal(isResolutionConfirmation('还没解决，这个方案无效'), false);
    assert.equal(isResolutionConfirmation('已解决，这个方案有效'), true);
    assert.equal(hasCuratableDiagnosticResult(caseSession), false);

    store.addRun(caseSession, {
      id: 'run_01',
      caseId: caseSession.id,
      status: 'concluded',
      request: {
        caseId: caseSession.id,
        runId: 'run_01',
        workspaceId: 'current',
        claudeSessionId: caseSession.claudeSessionId,
        userGoal: '支付退款配置怎么修复？',
        knownFacts: ['支付退款配置怎么修复？'],
        unknowns: [],
        constraints: [],
        allowedMcpToolIds: [],
        userPersona: 'developer',
      },
      result: {
        status: 'concluded',
        summary: '退款配置需要管理员确认支付渠道状态后再调整。',
        missingInfo: ['当前支付渠道状态'],
        evidence: [{ id: 'ev_pay', kind: 'knowledge', source: 'knowledge/faq/payment/refund.md', summary: '退款配置 runbook', confidence: 'medium' }],
        claims: [
          { type: 'fact', text: '有证据的事实可沉淀', evidenceIds: ['ev_pay'] },
          { type: 'fact', text: '无证据根因不应沉淀', evidenceIds: [] },
          { type: 'unknown', text: '当前支付渠道状态未知', evidenceIds: [] },
        ],
        recommendedNextAction: 'final_answer',
      },
    });

    const draft = curateSolvedCase({
      workspaceRoot: workspace,
      caseSession,
      confirmationMessage: '已解决，这个方案有效',
    });
    const content = readFileSync(draft.path, 'utf8');

    assert.match(content, /visibility: restricted/);
    assert.match(content, /有证据的事实可沉淀/);
    assert.doesNotMatch(content, /无证据根因不应沉淀/);
    assert.match(content, /当前支付渠道状态未知/);
    assert.equal(existsSync(join(workspace, 'knowledge', 'indexes', 'dirty.flag')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('case curator refuses partial or unsupported diagnostic results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));

  try {
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '证据不足的问题',
    });
    store.addRun(caseSession, {
      id: 'run_partial',
      caseId: caseSession.id,
      status: 'partial',
      result: {
        status: 'partial',
        summary: '还没有足够证据。',
        missingInfo: ['当前实现证据'],
        evidence: [],
        claims: [{ type: 'fact', text: '无证据事实不能沉淀', evidenceIds: [] }],
        recommendedNextAction: 'ask_user',
      },
    });

    assert.equal(hasCuratableDiagnosticResult(caseSession), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('async chat accepts immediately, stores progress, and exposes context usage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43973;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    config.agent.contextWindowTokens = 200;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43973/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        persona: 'operations',
        message: '请解释这个项目的 package.json 主要做什么，需要引用文件证据。',
      }),
    }).then((res) => {
      assert.equal(res.status, 202);
      return res.json();
    });

    assert.equal(accepted.accepted, true);
    assert.equal(typeof accepted.caseId, 'string');
    assert.equal(accepted.persona, 'operations');

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43973/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.length >= 2, true);
      return json;
    });

    assert.equal(loaded.session.userPersona, 'operations');
    assert.equal(typeof loaded.session.contextUsage.estimatedTokens, 'number');
    assert.equal(typeof loaded.session.contextUsage.percent, 'number');
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync and async chat flows use the same runtime pipeline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const workerRequests = [];
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        return {
          result: {
            status: 'concluded',
            summary: '已完成同管线诊断。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_pipeline',
                kind: 'workspace',
                source: 'package.json',
                summary: '运行时管线已生成结构化请求。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '同步和异步路径都调用了同一个诊断 worker 端口。',
                evidenceIds: ['ev_pipeline'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"ok"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const syncResponse = await agent.handleUserMessage({
      message: '请检查项目的运行时拆分是否可诊断。',
    });
    const asyncCase = agent.startUserTurn({
      message: '请检查项目的配置加载是否可诊断。',
    });
    const asyncResponse = await agent.completeUserTurn(asyncCase.id, '请检查项目的配置加载是否可诊断。');

    const runtimePhases = (caseSession) =>
      caseSession.logs.map((event) => `${event.actor}:${event.phase}`).filter((phase) => phase !== 'system:conversation_started');

    assert.equal(syncResponse.decision, 'final');
    assert.equal(asyncResponse.decision, 'final');
    assert.equal(workerRequests.length, 2);
    assert.deepEqual(workerRequests.map((request) => request.context?.isFollowUp), [false, false]);
    assert.deepEqual(runtimePhases(syncResponse.caseSession), runtimePhases(asyncResponse.caseSession));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('context usage limit follows the current model context window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43975;
    config.agent.useModelForPreflight = false;
    config.claude.enabled = false;
    config.agent.contextWindowTokens = 200000;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43975/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        message: '请解释这个项目的 package.json 主要做什么。',
      }),
    }).then((res) => res.json());

    assert.equal(accepted.contextUsage.limitTokens, 1000000);

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43975/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.length >= 2, true);
      return json;
    });

    assert.equal(loaded.session.contextUsage.limitTokens, 1000000);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configured provider context window overrides inferred model defaults', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43976;
    config.agent.useModelForPreflight = false;
    config.claude.enabled = false;
    config.agent.contextWindowTokens = 200000;
    config.models.providers.minimax.contextWindowTokens = 512000;
    server = await startServer({ config });

    const created = await fetch('http://127.0.0.1:43976/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '上下文窗口测试' }),
    }).then((res) => res.json());

    assert.equal(created.session.contextUsage.limitTokens, 512000);

    const settings = await fetch('http://127.0.0.1:43976/api/settings').then((res) => res.json());
    assert.equal(settings.models.providers.minimax.contextWindowTokens, 512000);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logs API returns newest structured blocks with severity and labels', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43974;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43974/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true, message: '请解释 package.json，需要证据。' }),
    }).then((res) => res.json());

    await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43974/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.length >= 2, true);
    });

    const logs = await fetch(`http://127.0.0.1:43974/api/logs?caseId=${accepted.caseId}`).then((res) => res.json());
    assert.equal(Array.isArray(logs.blocks), true);
    assert.equal(logs.blocks[0].createdAt >= logs.blocks.at(-1).createdAt, true);
    assert.ok(logs.blocks.some((block) => block.label === '输入'));
    assert.ok(logs.blocks.some((block) => block.label === '调用 CC'));
    assert.ok(logs.blocks.every((block) => ['ok', 'warn', 'error', 'info'].includes(block.severity)));
    const commandBlock = logs.blocks.find((block) => block.phase === 'command');
    assert.equal(typeof commandBlock.command, 'string');
    assert.match(commandBlock.command, /claude worker not executed|claude -p/);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent model runs before Claude dispatch and after Claude returns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const modelCalls = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    modelCalls.push(body.messages);
    assert.deepEqual(body.response_format, { type: 'json_object' });

    if (modelCalls.length === 1) {
      return chatResponse(
        JSON.stringify({
          action: 'dispatch',
          reason: '信息足够进入诊断',
          missingInfo: ['traceId'],
        }),
      );
    }

    return chatResponse(
      JSON.stringify({
        outcome: 'final_answer',
        reply: '模型审核后的用户回复',
      }),
    );
  };

  try {
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: 'worker result',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'src/example.ts',
                summary: '找到相关代码路径',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '存在可验证证据',
                evidenceIds: ['ev_01'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p ...',
            cwd: process.cwd(),
            stdout: '{"result":"ok"}',
            stderr: '',
            exitCode: 0,
          },
        };
      },
    };

    const agent = new SuperHelperAgent(baseConfig(dir), store, worker);
    const response = await agent.handleUserMessage({
      message: '课程任务保存失败，接口 /course/1/task/2/update 返回 500，账号是管理员。',
    });

    assert.equal(modelCalls.length, 2);
    assert.match(modelCalls[1][0].content, /最终解释/);
    assert.match(modelCalls[1][0].content, /支撑证据/);
    assert.equal(response.assistantMessage, '模型审核后的用户回复');
    assert.equal(response.decision, 'final');
    assert.equal(response.caseSession.logs.some((item) => item.actor === 'claude' && item.phase === 'raw_output'), true);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent falls back to a preformatted raw Claude result when presentation model fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const rawClaudeResult = `The \`org.create\` event has no depth check before the fenced result.

\`\`\`json
{
  "status": "concluded",
  "summary": "创建入口按 15 级限制展示按钮",
  "recommendedNextAction": "final_answer"
}
\`\`\``;

  globalThis.fetch = async () => {
    throw new Error('Model request timed out after 10ms');
  };

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: '结构化诊断结果已产生。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_depth',
                kind: 'workspace',
                source: 'org-manage/index.html.twig:82',
                summary: '添加子部门按钮使用 org.depth < 15 控制。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '部门创建入口按 15 级限制展示。',
                evidenceIds: ['ev_depth'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: JSON.stringify({
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: rawClaudeResult,
            }),
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '请在当前项目里查找部门创建支持多少级，需要引用文件证据。',
    });

    assert.equal(response.decision, 'final');
    assert.match(response.assistantMessage, /美化输出 Agent 调用模型失败/);
    assert.match(response.assistantMessage, /<pre>/);
    assert.match(response.assistantMessage, /The `org\.create` event has no depth check/);
    assert.match(response.assistantMessage, /"summary": "创建入口按 15 级限制展示按钮"/);
    assert.doesNotMatch(response.assistantMessage, /来源：run_01/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent directly surfaces worker errors when presentation model fails before a result exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error('Model request timed out after 10ms');
  };

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        const execution = {
          stdout: JSON.stringify({ result: 'API Error: Connection error.' }),
          stderr: '',
          exitCode: 1,
        };
        return {
          result: failedExecutionDiagnosticResult(request, execution),
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            ...execution,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '请在当前项目里查找部门创建支持多少级，需要引用文件证据。',
    });

    assert.equal(response.decision, 'escalate');
    assert.match(response.assistantMessage, /Claude Code 在产生可展示结果前失败/);
    assert.match(response.assistantMessage, /错误结果：Claude Code 调用失败：API Error: Connection error\./);
    assert.match(response.assistantMessage, /exitCode=1/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent asks for required information without dispatching worker when preflight blocks diagnosis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    let workerCalls = 0;
    const worker = {
      async diagnose() {
        workerCalls += 1;
        throw new Error('worker should not be dispatched for blocked preflight');
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '你好',
    });

    assert.equal(response.decision, 'ask_user');
    assert.equal(response.caseSession.status, 'need_input');
    assert.equal(workerCalls, 0);
    assert.match(response.assistantMessage, /缺少关键信息/);
    assert.equal(response.caseSession.runs.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent dispatches workspace-aware messages as structured diagnostic requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.workspaces[0].mcpToolIds = ['readonly-docs'];
    const store = new FileMemoryStore(dir);
    let receivedRequest;
    const worker = {
      async diagnose(request) {
        receivedRequest = request;
        return {
          result: {
            status: 'concluded',
            summary: '找到设置入口。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'src/router.ts',
                summary: '当前 workspace 可检索到路由入口。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '已基于 workspace 证据定位。',
                evidenceIds: ['ev_01'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"ok"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({
      persona: 'support',
      message: '请查找视频倍速播放设置在哪个页面路由，需要引用代码文件证据。',
    });

    assert.equal(response.decision, 'final');
    assert.ok(receivedRequest);
    assert.equal(receivedRequest.caseId, response.caseSession.id);
    assert.equal(receivedRequest.runId, 'run_01');
    assert.equal(receivedRequest.workspaceId, 'current');
    assert.equal(receivedRequest.userPersona, 'support');
    assert.deepEqual(receivedRequest.allowedMcpToolIds, ['readonly-docs']);
    assert.match(receivedRequest.userGoal, /倍速播放/);
    assert.equal(receivedRequest.context.isFollowUp, false);
    assert.ok(receivedRequest.context.recentMessages.some((message) => message.role === 'user' && /倍速播放/.test(message.body)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent blocks unsupported fact-only worker conclusions from final presentation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: '没有证据但声称已经定位。',
            missingInfo: [],
            evidence: [],
            claims: [
              {
                type: 'fact',
                text: '这是没有任何 evidenceIds 的事实判断。',
                evidenceIds: [],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"unsupported"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '接口 /course/task/save 返回 500，请定位原因。',
    });

    assert.equal(response.decision, 'final');
    assert.match(response.assistantMessage, /没有证据支撑/);
    assert.match(response.assistantMessage, /不会把它作为结论展示/);
    assert.doesNotMatch(response.assistantMessage, /这是没有任何 evidenceIds 的事实判断/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime helper modules expose stable context, request, preflight, review, and presentation contracts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.workspaces[0].mcpToolIds = ['readonly-docs'];
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'runtime helper test',
    });
    caseSession.userPersona = 'developer';
    store.addMessage(caseSession, { role: 'user', body: '请解释 package.json 的脚本配置，需要引用文件证据。' });

    const request = buildDiagnosticRequest({
      caseSession,
      userMessage: '请解释 package.json 的脚本配置，需要引用文件证据。',
      unknowns: ['运行环境'],
      config,
    });
    assert.equal(request.runId, 'run_01');
    assert.equal(request.userPersona, 'developer');
    assert.deepEqual(request.allowedMcpToolIds, ['readonly-docs']);
    assert.equal(request.context.isFollowUp, false);

    const result = {
      status: 'partial',
      summary: '找到 package.json，但还需要继续确认脚本用途。',
      missingInfo: ['脚本运行场景'],
      evidence: [
        {
          id: 'ev_package',
          kind: 'workspace',
          source: 'package.json',
          summary: 'package.json 包含脚本配置。',
          confidence: 'high',
        },
      ],
      claims: [
        {
          type: 'fact',
          text: 'package.json 是当前判断的证据来源。',
          evidenceIds: ['ev_package'],
        },
      ],
      recommendedNextAction: 'continue_diagnosis',
    };
    store.addRun(caseSession, { id: request.runId, caseId: caseSession.id, status: 'partial', request, result });
    store.addMessage(caseSession, { role: 'helper', body: '上一轮已经定位到 package.json。' });

    const context = buildDiagnosticRequestContext(caseSession, '继续看这个脚本');
    assert.equal(context.isFollowUp, true);
    assert.ok(context.previousRuns.some((run) => run.evidence.some((item) => item.id === 'ev_package')));

    const followUp = buildFollowUpDiagnosticRequest({
      caseSession,
      previousRequest: request,
      previousResult: result,
    });
    assert.equal(followUp.runId, 'run_02');
    assert.match(followUp.userGoal, /继续追查/);
    assert.match(followUp.constraints.join('\n'), /Resolve follow-up references/);

    const blockedCase = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'blocked preflight',
    });
    store.addMessage(blockedCase, { role: 'user', body: '你好' });
    const blocked = buildLocalPreflightDecision({ config, caseSession: blockedCase, userMessage: '你好' });
    assert.equal(blocked.action, 'ask_user');
    assert.equal(summarizePreflightDecision(blocked).action, 'ask_user');
    assert.equal(isGenericWorkspaceFollowUp('请补充这是哪个产品或代码库？', ['产品名称']), true);
    assert.equal(isGenericWorkspaceFollowUp('请补充 traceId 和时间范围', ['traceId']), false);

    assert.equal(caseStatusFromDiagnosticResult({ ...result, status: 'concluded', recommendedNextAction: 'final_answer' }), 'concluded');
    assert.equal(decisionFromDiagnosticResult({ ...result, status: 'concluded', recommendedNextAction: 'final_answer' }), 'final');
    assert.equal(decisionFromReviewOutcome('ask_user', result), 'ask_user');
    assert.equal(shouldRunFollowUp({ reply: '继续', decision: 'partial' }, result, { command: '', cwd: '', stdout: '', stderr: '', startedAt: '', finishedAt: '' }), true);

    assert.equal(personaName('developer'), '开发人员');
    assert.equal(personaGuide('operations').focus.includes('配置入口'), true);
    assert.match(formatPreflightQuestion('请补充页面。', ['页面']), /缺少关键信息：页面/);
    assert.match(
      ruleBasedReviewAndFormat({
        status: 'concluded',
        summary: 'unsupported',
        missingInfo: [],
        evidence: [],
        claims: [{ type: 'fact', text: '无证据事实', evidenceIds: [] }],
        recommendedNextAction: 'final_answer',
      }, 'operations'),
      /没有证据支撑/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model preflight cannot block an inspectable workspace question with generic project-name follow-up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const workerRequests = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);

    if (body.messages[0].content.includes('Return JSON only. Use this shape:')) {
      return chatResponse(
        JSON.stringify({
          action: 'ask_user',
          reason: '缺少产品或系统名称',
          missingInfo: ['问题对应的产品/系统名称', '是否在当前工作区已有相关文档或代码'],
          question: '请补充这个倍速播放是哪个产品或后台的功能？',
        }),
      );
    }

    return chatResponse(
      JSON.stringify({
        outcome: 'final_answer',
        reply: '已基于当前项目先做只读排查，没有要求用户补充产品名称。',
      }),
    );
  };

  try {
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        return {
          result: {
            status: 'concluded',
            summary: '找到倍速播放相关入口和视频播放影响范围。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'app/example/player.js',
                summary: '当前 workspace 可以只读检索倍速播放相关实现。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '问题可以通过当前 workspace 先做只读排查。',
                evidenceIds: ['ev_01'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"ok"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(baseConfig(dir), store, worker);
    const response = await agent.handleUserMessage({
      persona: 'operations',
      message: '客户反馈找不到 倍速播放的页面路由，请问这个在哪？\n\n开启了倍数播放会影响微网校的视频播放吗',
    });

    assert.equal(workerRequests.length, 1);
    assert.match(workerRequests[0].userGoal, /倍速播放/);
    assert.equal(workerRequests[0].unknowns.length, 0);
    assert.equal(response.decision, 'final');
    assert.equal(response.assistantMessage, '已基于当前项目先做只读排查，没有要求用户补充产品名称。');
    assert.equal(
      response.caseSession.logs.some((item) => item.phase === 'model_preflight_overridden_by_local_dispatch'),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent can run one follow-up Claude turn when evidence review asks to continue diagnosis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const modelCalls = [];
  const workerRequests = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    modelCalls.push(body.messages);
    assert.deepEqual(body.response_format, { type: 'json_object' });

    if (modelCalls.length === 1) {
      return chatResponse(JSON.stringify({ action: 'dispatch', reason: '信息足够', missingInfo: [] }));
    }

    if (modelCalls.length === 2) {
      return chatResponse(
        JSON.stringify({
          outcome: 'partial',
          reply: '证据还不够，需要继续追查。',
        }),
      );
    }

    return chatResponse(
      JSON.stringify({
        outcome: 'final_answer',
        reply: '追查后整理出的最终回复，包含证据与解释。',
      }),
    );
  };

  try {
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        if (workerRequests.length === 1) {
          return {
            result: {
              status: 'partial',
              summary: '还需要继续查路由',
              missingInfo: [],
              evidence: [
                {
                  id: 'ev_01',
                  kind: 'workspace',
                  source: 'src/router.ts',
                  summary: '只找到疑似路由入口',
                  confidence: 'medium',
                },
              ],
              claims: [
                {
                  type: 'inference',
                  text: '可能需要继续查播放器配置。',
                  evidenceIds: ['ev_01'],
                },
              ],
              recommendedNextAction: 'continue_diagnosis',
            },
            trace: {
              command: 'claude -p --session-id ...',
              cwd: process.cwd(),
              stdout: '{"result":"partial"}',
              stderr: '',
              exitCode: 0,
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            },
          };
        }

        return {
          result: {
            status: 'concluded',
            summary: '找到播放器倍速配置和路由。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_02',
                kind: 'workspace',
                source: 'app/js/player/index.js',
                summary: '播放器初始化读取倍速配置。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '倍速开关由播放器初始化配置控制。',
                evidenceIds: ['ev_02'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"final"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(baseConfig(dir), store, worker);
    const response = await agent.handleUserMessage({
      message: '视频倍速开关在哪里开启？需要页面路由和证据。',
    });

    assert.equal(workerRequests.length, 2);
    assert.equal(workerRequests[1].runId, 'run_02');
    assert.equal(workerRequests[1].claudeSessionId, workerRequests[0].claudeSessionId);
    assert.equal(response.assistantMessage, '追查后整理出的最终回复，包含证据与解释。');
    assert.equal(response.decision, 'final');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('follow-up diagnostic requests carry prior assistant replies and evidence context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workerRequests = [];

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        if (workerRequests.length === 1) {
          return {
            result: {
              status: 'concluded',
              summary: '倍速播放设置位于管理后台云视频设置页 /edu_cloud/video/setting。',
              missingInfo: [],
              evidence: [
                {
                  id: 'ev_speed_setting',
                  kind: 'workspace',
                  source: 'app/Resources/views/admin-v2/cloud-center/edu-cloud/video/setting.html.twig:276',
                  summary: '倍速播放开关在 /edu_cloud/video/setting 页面。',
                  confidence: 'high',
                },
              ],
              claims: [
                {
                  type: 'fact',
                  text: '倍速播放开关和页面路由已经在上一轮确认。',
                  evidenceIds: ['ev_speed_setting'],
                },
              ],
              recommendedNextAction: 'final_answer',
            },
            trace: {
              command: 'claude -p --session-id ...',
              cwd: process.cwd(),
              stdout: '{"result":"first"}',
              stderr: '',
              exitCode: 0,
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            },
          };
        }

        return {
          result: {
            status: 'concluded',
            summary: '追问已结合上一轮设置页继续排查。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_security_setting',
                kind: 'workspace',
                source: 'app/Resources/views/admin-v2/cloud-center/edu-cloud/video/setting.html.twig:448',
                summary: '同一页面存在云视频防盗增强配置。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '追问上下文已串联。',
                evidenceIds: ['ev_security_setting'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --resume ...',
            cwd: process.cwd(),
            stdout: '{"result":"second"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const first = await agent.handleUserMessage({
      message: '客户反馈找不到倍速播放的页面路由，请问这个在哪？',
    });
    await agent.handleUserMessage({
      caseId: first.caseSession.id,
      message: '你刚刚说的设置的地方，限制只能微信浏览器内观看的配置也在吗，这个配置叫什么？',
    });

    assert.equal(workerRequests.length, 2);
    const followUpContext = workerRequests[1].context;
    assert.ok(followUpContext);
    assert.equal(followUpContext.isFollowUp, true);
    assert.ok(
      followUpContext.recentMessages.some(
        (message) => message.role === 'helper' && /edu_cloud\/video\/setting|云视频设置页/.test(message.body),
      ),
    );
    assert.ok(
      followUpContext.previousRuns.some((run) =>
        run.evidence.some((item) => item.id === 'ev_speed_setting' && /倍速播放开关/.test(item.summary)),
      ),
    );
    assert.match(workerRequests[1].constraints.join('\n'), /Resolve follow-up references/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local preflight can dispatch general project questions, not only diagnostics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    let receivedRequest;
    const worker = {
      async diagnose(request) {
        receivedRequest = request;
        return {
          result: {
            status: 'concluded',
            summary: '这是一个项目提问回答。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'package.json',
                summary: 'package.json 描述了项目脚本。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '项目通过 package.json 暴露脚本。',
                evidenceIds: ['ev_01'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"ok"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '请解释这个项目的 package.json 主要做什么，需要引用文件证据。',
    });

    assert.equal(response.decision, 'final');
    assert.equal(receivedRequest.userGoal.includes('package.json'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent registry exposes main and configured sub-agent contracts', () => {
  const registry = loadAgentRegistry();
  const stages = registry.agents.map((agent) => agent.stage);

  assert.deepEqual(stages, [
    'main',
    'input_review',
    'preflight',
    'experience',
    'knowledge_router',
    'evidence_judge',
    'case_curator',
    'output_review',
    'presentation',
  ]);
  assert.match(resolveAgentConfig('main').absolutePath, /src\/agents\/main\.md$/);
  assert.match(resolveAgentConfig('preflight').content, /Input Review Agent/);
  assert.match(resolveAgentConfig('experience').content, /Experience Agent/);
  assert.match(resolveAgentConfig('knowledge_router').content, /Knowledge Router Agent/);
  assert.match(resolveAgentConfig('evidence_judge').content, /Evidence Judge Agent/);
  assert.match(resolveAgentConfig('case_curator').content, /Case Curator Agent/);
  assert.equal(listPublicAgentConfigs().some((agent) => agent.stage === 'presentation' && agent.mayProduceUserFacingText), true);
});

test('experience agent reuses a prior reviewed answer without dispatching Claude', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const prior = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '历史问题',
    });
    store.addMessage(prior, { role: 'user', body: '课程任务保存失败是什么原因？' });
    store.addMessage(prior, { role: 'helper', body: '历史结论：课程任务保存失败通常需要检查任务配置和接口返回。' });
    prior.status = 'concluded';
    store.saveCase(prior);
    let workerCalls = 0;
    const worker = {
      async diagnose() {
        workerCalls += 1;
        throw new Error('experience match should not dispatch Claude');
      },
    };

    const agent = new SuperHelperAgent(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '课程任务保存失败是什么原因？',
    });

    assert.equal(workerCalls, 0);
    assert.equal(response.decision, 'final');
    assert.equal(response.caseSession.runs.length, 1);
    assert.equal(response.caseSession.runs[0].result.evidence[0].kind, 'history');
    assert.equal(response.caseSession.logs.some((event) => event.agentId === 'experience' && event.phase === 'experience_hit'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent log labels and activity are exposed through sessions and logs API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;
  try {
    const config = baseConfig(dir);
    config.server.port = 43977;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43977/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        message: '请解释这个项目的 package.json 主要做什么。',
      }),
    }).then((res) => res.json());

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43977/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.some((message) => message.role === 'helper'), true);
      return json;
    });
    const logs = await fetch(`http://127.0.0.1:43977/api/logs?caseId=${accepted.caseId}`).then((res) => res.json());

    assert.equal(loaded.session.agentActivity.some((item) => item.agentId === 'input-review'), true);
    assert.equal(logs.blocks.some((block) => block.agentName && block.tags.includes(block.agentName)), true);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session lifecycle supports title refresh, pin, archive, reject, and delete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;
  try {
    const config = baseConfig(dir);
    config.server.port = 43978;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const created = await fetch('http://127.0.0.1:43978/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '新对话' }),
    }).then((res) => res.json());
    const accepted = await fetch('http://127.0.0.1:43978/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        caseId: created.session.id,
        message: '请解释 package.json 的脚本。',
      }),
    }).then((res) => res.json());

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43978/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.notEqual(json.session.title, '新对话');
      return json;
    });

    const pinned = await fetch('http://127.0.0.1:43978/api/session', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: loaded.session.id, action: 'pin' }),
    }).then((res) => res.json());
    assert.equal(typeof pinned.session.pinnedAt, 'string');

    const archived = await fetch('http://127.0.0.1:43978/api/session', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: loaded.session.id, action: 'archive' }),
    }).then((res) => res.json());
    assert.equal(typeof archived.session.archivedAt, 'string');

    const rejected = await fetch('http://127.0.0.1:43978/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true, caseId: loaded.session.id, message: '继续问' }),
    });
    assert.equal(rejected.status, 409);

    const deleted = await fetch(`http://127.0.0.1:43978/api/session?caseId=${loaded.session.id}`, {
      method: 'DELETE',
    }).then((res) => res.json());
    assert.equal(deleted.deleted, true);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('async same-case turns receive ordered reply-to helper messages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        await new Promise((resolve) => setTimeout(resolve, request.userGoal.includes('第二') ? 30 : 1));
        return {
          result: {
            status: 'concluded',
            summary: `回答 ${request.userGoal}`,
            missingInfo: [],
            evidence: [
              {
                id: 'ev_order',
                kind: 'workspace',
                source: 'test',
                summary: request.userGoal,
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: request.userGoal,
                evidenceIds: ['ev_order'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p ...',
            cwd: process.cwd(),
            stdout: '{}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };
    const agent = new SuperHelperAgent(config, store, worker);
    const caseSession = agent.startUserTurn({ message: '第二个问题：解释 scripts' });
    const secondId = caseSession.messages.at(-1).id;
    agent.startUserTurn({ caseId: caseSession.id, message: '第三个问题：解释 dependencies' });
    const thirdId = store.loadCase(caseSession.id).messages.at(-1).id;

    await Promise.all([
      agent.completeUserTurn(caseSession.id, '第二个问题：解释 scripts'),
      agent.completeUserTurn(caseSession.id, '第三个问题：解释 dependencies'),
    ]);
    const loaded = store.loadCase(caseSession.id);
    const helperReplies = loaded.messages.filter((message) => message.role === 'helper');

    assert.equal(helperReplies.length, 2);
    assert.deepEqual(helperReplies.map((message) => message.replyToMessageId), [secondId, thirdId]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('async turn failures can reply to the accepted user message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        throw new Error('not used');
      },
    };
    const agent = new SuperHelperAgent(config, store, worker);
    const caseSession = agent.startUserTurn({ message: '失败路径也要绑定这一条消息' });
    const userMessageId = caseSession.messages.at(-1).id;

    agent.recordTurnFailure(caseSession.id, new Error('worker failed'), userMessageId);
    const loaded = store.loadCase(caseSession.id);
    const helper = loaded.messages.find((message) => message.role === 'helper');

    assert.equal(helper.replyToMessageId, userMessageId);
    assert.match(helper.body, /worker failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agents API and settings UI expose configured multi-agent settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;
  try {
    const config = baseConfig(dir);
    config.server.port = 43979;
    server = await startServer({ config });

    const agents = await fetch('http://127.0.0.1:43979/api/agents').then((res) => res.json());
    const html = renderApp();

    assert.equal(agents.agents.some((agent) => agent.stage === 'experience'), true);
    assert.match(html, /id="agentSettings"/);
    assert.match(html, /\/api\/agents/);
    assert.match(html, /多 Agent 设置/);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeKnowledgeFaq(workspace, input) {
  const faqDir = join(workspace, 'knowledge', 'faq', input.module);
  mkdirSync(faqDir, { recursive: true });
  writeFileSync(
    join(faqDir, `${input.module}-${input.intent}.md`),
    `---
id: kb_faq_${input.module}_${input.intent}
title: ${input.title}
type: faq
module: ${input.module}
intent: ${input.intent}
source_type: faq
confidence: high
status: active
visibility: ${input.visibility ?? 'internal'}
product_versions: []
related_terms:
${input.terms.map((term) => `  - ${term}`).join('\n')}
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# ${input.title}

## 答案

${input.body}
`,
    'utf8',
  );
}

function writeKnowledgeWhitepaper(workspace, input) {
  const whitepaperDir = join(workspace, 'knowledge', 'whitepapers', input.module);
  mkdirSync(whitepaperDir, { recursive: true });
  writeFileSync(
    join(whitepaperDir, `${input.module}-whitepaper.md`),
    `---
id: kb_whitepaper_${input.module}_reminder
title: ${input.title}
type: whitepaper_slice
module: ${input.module}
intent: product_rule
source_type: whitepaper
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms:
${input.terms.map((term) => `  - ${term}`).join('\n')}
related_repos: []
last_verified_at: 2026-06-13
owner: product
source_document: knowledge/_sources/whitepapers/test.docx
source_document_id: src_test_whitepaper
source_pages: []
section_path:
  - 督学提醒
  - ${input.title}
chunking_strategy: semantic-section-v1
---

# ${input.title}

## 核心内容

${input.body}
`,
    'utf8',
  );
}

function knowledgePack(results) {
  return {
    query: {
      normalized_question: '课程发布后为什么学员看不到',
      module_candidates: ['course'],
      intent_candidates: ['how_to'],
      keywords: ['课程', '发布', '学员', '看不到'],
    },
    results,
    coverage: {
      searched_files: results.length,
      matched_files: results.length,
      filtered_out: [],
    },
  };
}

function knowledgeEvidence(input) {
  return {
    evidence_id: input.id,
    document_id: input.id.replace(/^ev_/, 'kb_'),
    parent_id: input.id.replace(/^ev_/, 'kb_'),
    source: `knowledge/faq/course/${input.id}.md`,
    source_document: undefined,
    source_document_id: undefined,
    source_pages: [],
    title: '课程可见性规则',
    type: input.sourceType === 'runbook' ? 'runbook' : 'faq',
    module: 'course',
    intent: 'how_to',
    source_type: input.sourceType,
    confidence: 'high',
    status: input.status,
    visibility: 'internal',
    last_verified_at: input.verifiedAt,
    matched_terms: input.matchedTerms,
    summary: '课程可见性规则命中',
    excerpt: '课程发布后需要满足可见范围、权限和上架时间条件。',
    score: input.matchedTerms.length * 10,
  };
}

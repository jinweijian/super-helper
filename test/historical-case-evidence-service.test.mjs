import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { HistoricalCaseEvidenceService } from '../dist/mcp/historical-case-evidence-service.js';
import { normalizeMcpResult } from '../dist/mcp/normalizer.js';

function configured() {
  const config = defaultConfig();
  config.claude.commandWhitelist = ['node'];
  config.workspaces[0].mcpToolIds = ['company-redmine'];
  config.workspaces[0].historicalCaseSources = [{ serverId: 'company-redmine' }];
  config.mcpTools = [{
    id: 'company-redmine',
    name: 'Company Redmine',
    protocol: 'stdio',
    permission: 'read_only',
    enabled: true,
    allowedToolNames: ['redmine_search_issues', 'redmine_get_issue_case_details'],
    capability: { type: 'historical_case', provider: 'redmine' },
    config: { command: 'node', args: ['fixture.mjs'], env: {} },
  }];
  return config;
}

function request() {
  return {
    caseId: 'case-1',
    runId: 'run-1',
    workspaceId: 'current',
    claudeSessionId: 'session-1',
    answerGoal: {
      rawUserQuestion: '视频为什么加载失败？',
      resolvedQuestion: '视频为什么加载失败？',
      answerObject: '视频加载失败的原因和处理方式',
      mustAnswerItems: ['原因', '处理方式'],
      diagnosticObjective: '定位视频加载链路',
      sourceMessageIds: ['msg-1'],
    },
    userGoal: '视频为什么加载失败？',
    knownFacts: [],
    unknowns: [],
    constraints: [],
    allowedMcpToolIds: ['company-redmine'],
  };
}

function callResult(structuredContent) {
  return {
    content: [{ type: 'text', text: 'safe fixture summary' }],
    structuredContent,
  };
}

function clientFixture(responses) {
  const calls = [];
  let closes = 0;
  return {
    calls,
    get closes() { return closes; },
    client: {
      async listTools() {
        return [
          { name: 'redmine_search_issues' },
          { name: 'redmine_get_issue_case_details' },
        ];
      },
      async callTool(name, args) {
        calls.push({ name, args });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
      async close() { closes += 1; },
    },
  };
}

test('historical service uses one MCP session for search, grant-bound detail, evidence, and provenance', async () => {
  const fixture = clientFixture([
    callResult({
      status: 'completed',
      searchId: 'grant-1',
      candidates: [
        { issueId: 101, subject: '视频加载失败', descriptionExcerpt: '检查转码', sourceLocator: 'redmine:issue:101' },
        { issueId: 102, subject: '无关问题', descriptionExcerpt: '无关', sourceLocator: 'redmine:issue:102' },
      ],
    }),
    callResult({
      status: 'completed',
      details: [{
        issueId: 101,
        subject: '视频加载失败',
        sourceLocator: 'redmine:issue:101',
        evidenceBlocks: [{ id: 'redmine:101:description', kind: 'description', text: '检查转码队列' }],
      }],
      omittedBlocks: 0,
      truncated: false,
      originalCharacters: 200,
      outputCharacters: 200,
    }),
  ]);
  let factoryCalls = 0;
  const service = new HistoricalCaseEvidenceService(configured(), {
    createClient: async () => { factoryCalls += 1; return fixture.client; },
  });

  const outcome = await service.investigate({
    request: request(),
    query: '视频加载失败',
    signals: ['转码'],
    selectIssueIds: async (candidates) => [candidates[0].issueId],
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(factoryCalls, 1);
  assert.equal(fixture.closes, 1);
  assert.deepEqual(fixture.calls, [
    { name: 'redmine_search_issues', args: { query: '视频加载失败', signals: ['转码'] } },
    { name: 'redmine_get_issue_case_details', args: { searchId: 'grant-1', issueIds: [101] } },
  ]);
  assert.deepEqual(outcome.evidence.map((item) => item.kind), ['mcp']);
  assert.deepEqual(outcome.coverageEvidenceEnvelopes.map((item) => ({
    kind: item.kind,
    freshness: item.freshness,
    runId: item.runId,
    readOnly: item.readOnly,
    allowlisted: item.allowlisted,
    completed: item.completed,
  })), [{
    kind: 'mcp',
    freshness: 'current_mcp_call',
    runId: 'run-1',
    readOnly: true,
    allowlisted: true,
    completed: true,
  }]);
  assert.equal('result' in outcome, false, 'historical service must not manufacture a final answer');
});

test('historical service rejects invalid capability or workspace policy before client creation', async () => {
  for (const mutate of [
    (config) => { config.mcpTools[0].permission = 'read_write'; },
    (config) => { config.mcpTools[0].capability.provider = 'jira'; },
    (config) => { config.workspaces[0].mcpToolIds = []; },
    (config) => { config.mcpTools[0].allowedToolNames = ['redmine_search_issues']; },
  ]) {
    const config = configured();
    mutate(config);
    let factoryCalls = 0;
    const service = new HistoricalCaseEvidenceService(config, {
      createClient: async () => { factoryCalls += 1; throw new Error('must not connect'); },
    });
    const outcome = await service.investigate({
      request: request(),
      query: 'fixture',
      signals: [],
      selectIssueIds: async () => [],
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(factoryCalls, 0);
  }
});

test('historical service preserves no_hit, timeout, and failed semantics', async () => {
  for (const [response, expected] of [
    [callResult({ status: 'no_hit', candidates: [] }), 'no_hit'],
    [callResult({ status: 'timeout', candidates: [], safeErrorCode: 'timeout' }), 'timeout'],
    [callResult({ status: 'failed', candidates: [], safeErrorCode: 'authentication_failed' }), 'failed'],
  ]) {
    const fixture = clientFixture([response]);
    const service = new HistoricalCaseEvidenceService(configured(), {
      createClient: async () => fixture.client,
    });
    const outcome = await service.investigate({
      request: request(),
      query: 'fixture',
      signals: [],
      selectIssueIds: async () => [],
    });
    assert.equal(outcome.status, expected);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.closes, 1);
  }
});

test('historical capability keeps valid structured JSON near 48K while legacy MCP remains 20K', () => {
  const details = Array.from({ length: 3 }, (_, index) => ({
    issueId: index + 1,
    subject: `Issue ${index + 1}`,
    sourceLocator: `redmine:issue:${index + 1}`,
    evidenceBlocks: Array.from({ length: 6 }, (_, blockIndex) => ({
      id: `block-${index + 1}-${blockIndex + 1}`,
      kind: blockIndex === 0 ? 'description' : 'journal',
      text: 'x'.repeat(6_000),
    })),
  }));
  const historical = normalizeMcpResult(callResult({
    status: 'completed',
    details,
    omittedBlocks: 0,
    truncated: false,
    originalCharacters: 90_000,
    outputCharacters: 90_000,
  }), { type: 'historical_case', provider: 'redmine' });
  assert.ok(historical.structuredContent.length <= 48_000);
  assert.doesNotThrow(() => JSON.parse(historical.structuredContent));

  const legacy = normalizeMcpResult(callResult({ payload: 'y'.repeat(40_000) }));
  assert.ok(JSON.stringify(legacy).length <= 20_500);
});

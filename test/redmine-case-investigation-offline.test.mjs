import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { FileMemoryStore } from '../dist/sessions/file-memory-store.js';

const fixture = join(process.cwd(), 'test', 'fixtures', 'redmine-mcp-stdio.mjs');

const scenarios = [
  {
    id: 'resolved_by_ticket',
    message: '离线验收 resolved_by_ticket：当前项目的视频转码队列为什么失败？',
    verify(result) {
      assert.equal(result.status, 'concluded');
      assert.equal(result.recommendedNextAction, 'final_answer');
      assert.equal(result.claims.some((item) => item.id?.startsWith('historical_claim_')), true);
      assert.deepEqual(new Set(result.evidence.map((item) => item.kind)), new Set(['mcp', 'workspace']));
    },
  },
  {
    id: 'not_resolved_by_ticket',
    message: '离线验收 not_resolved_by_ticket：这个仅存在于当前项目的未知配置错误怎么处理？',
    verify(result) {
      assert.equal(result.status, 'partial');
      assert.equal(result.claims.some((item) => item.id?.startsWith('historical_claim_')), false);
      assert.equal(result.evidence.some((item) => item.kind === 'mcp'), false);
    },
  },
  {
    id: 'direction_helpful',
    message: '离线验收 direction_helpful：视频异常是否可以参考历史工单给出排查方向？',
    verify(result) {
      assert.equal(result.status, 'partial');
      const historical = result.claims.find((item) => item.id?.startsWith('historical_claim_'));
      assert.ok(historical);
      assert.match(historical.text, /初步排查方向/);
      assert.doesNotMatch(historical.text, /最终根因已确认/);
      assert.equal(result.evidence.some((item) => item.kind === 'mcp'), true);
    },
  },
];

test('offline acceptance uses production Runtime and real MCP SDK stdio for all three structural outcomes', async () => {
  const originalFetch = globalThis.fetch;
  let parentNetworkCalls = 0;
  globalThis.fetch = async () => {
    parentNetworkCalls += 1;
    throw new Error('offline acceptance forbids parent-process network');
  };
  try {
    for (const scenario of scenarios) {
      const root = mkdtempSync(join(tmpdir(), `redmine-offline-${scenario.id}-`));
      try {
        const config = acceptanceConfig(root);
        let workerCalls = 0;
        const runtime = new DiagnosticRuntime(config, new FileMemoryStore(config.storage.rootDir), {
          async diagnose(request) {
            workerCalls += 1;
            return workerResponse(request, root);
          },
        }, { model: offlineModel() });

        const response = await runtime.handleUserMessage({
          workspaceId: 'current', persona: 'developer', message: scenario.message,
        });
        const run = response.caseSession.runs.at(-1);
        assert.ok(run?.result);
        scenario.verify(run.result);
        assert.equal(workerCalls, 1);
        assert.equal(response.caseSession.runs.length, 1);
        assert.equal(response.caseSession.messages.filter((item) => item.role === 'helper').length, 1);
        assert.equal(response.caseSession.logs.some((item) => item.phase === 'historical_case_search_completed'), true);
        assert.doesNotMatch(JSON.stringify(response.caseSession), /offline-worker-private-output|REDMINE_API_KEY/);
        assert.doesNotMatch(JSON.stringify(response.caseSession), /resolved-marker|direction-marker|历史记录确认转码队列配置异常|历史记录没有当前环境结论/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    assert.equal(parentNetworkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function acceptanceConfig(root) {
  const config = defaultConfig();
  config.storage.rootDir = join(root, 'storage');
  config.storage.isolateByWorkspace = false;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.knowledge.isolateByWorkspace = false;
  config.embedding.enabled = false;
  config.rerank.enabled = false;
  config.agent.modelProvider = undefined;
  config.agent.useModelForPreflight = false;
  config.agent.useModelForRagAnswerability = false;
  config.claude.commandWhitelist = [process.execPath];
  config.workspaces = [{
    id: 'current', name: 'Current', rootPath: root,
    mcpToolIds: ['fixture-redmine'], historicalCaseSources: [{ serverId: 'fixture-redmine' }],
  }];
  config.mcpTools = [{
    id: 'fixture-redmine', name: 'Fixture Redmine', protocol: 'stdio', permission: 'read_only', enabled: true,
    allowedToolNames: ['redmine_search_issues', 'redmine_get_issue_case_details'],
    capability: { type: 'historical_case', provider: 'redmine' }, timeoutMs: 15_000,
    config: { command: process.execPath, args: [fixture], env: {} },
  }];
  return config;
}

function offlineModel() {
  return {
    async complete(messages) {
      const system = messages[0]?.content ?? '';
      const input = JSON.parse(messages.at(-1)?.content ?? '{}');
      if (system.includes('historical-ticket-search-query-planner')) {
        const question = input.answerGoal?.resolvedQuestion ?? '';
        const query = question.includes('not_resolved_by_ticket') ? 'NOHIT'
          : question.includes('direction_helpful') ? 'DIRECTION' : 'RESOLVED';
        return JSON.stringify({ query, signals: ['video'], status: 'all', candidateLimit: 10, detailLimit: 3 });
      }
      if (system.includes('historical-ticket-candidate-reranker')) {
        return JSON.stringify({ issueIds: input.candidates.slice(0, 1).map((item) => item.issueId) });
      }
      if (system.includes('historical-ticket-evidence-analyzer')) {
        const direction = JSON.stringify(input).includes('direction-marker');
        return JSON.stringify({ leads: [{
          id: direction ? 'lead-direction' : 'lead-resolved', issueId: 118740,
          hypothesis: direction ? '历史案例可用于检查转码链路，但尚不能确认同根因' : '当前转码队列配置与历史案例一致',
          evidenceIds: ['redmine_ev_01'], conflicts: [],
          checks: [{
            id: 'check-1', action: 'inspect_config', target: 'package.json',
            expectedMatch: '存在与历史案例一致的转码队列配置', expectedMismatch: '当前配置与历史案例不同',
            evidenceIds: ['redmine_ev_01'],
          }],
        }] });
      }
      if (system.includes('historical-and-current-evidence-verifier')) {
        const lead = input.leads[0];
        const currentIds = input.currentEvidence.map((item) => item.id);
        const direction = lead.id === 'lead-direction';
        return JSON.stringify({ verifications: [{
          leadId: lead.id, classification: direction ? 'diagnostic_lead_only' : 'same_root_cause_likely',
          historicalEvidenceIds: ['redmine_ev_01'], currentEvidenceIds: currentIds,
          supportingEvidenceIds: ['redmine_ev_01', ...currentIds], conflictingEvidenceIds: [],
        }] });
      }
      if (system.includes('Evidence Coverage Agent')) {
        const claim = input.claimSegments.find((item) => item.role === 'primary_answer');
        if (!claim) return JSON.stringify({ status: 'accepted', bindings: [], fullQuestion: 'none', fullQuestionClaimIds: [], missingElements: input.mustAnswerItems, reason: 'no primary' });
        return JSON.stringify({
          status: 'accepted',
          bindings: [{ claimId: claim.id, answerItemIds: claim.candidateAnswerItemIds, evidenceIds: claim.evidenceIds }],
          fullQuestion: 'full', fullQuestionClaimIds: [claim.id], missingElements: [], reason: 'fixture coverage',
        });
      }
      if (system.includes('Visible Prompt Safety Agent')) {
        const candidates = Array.isArray(input) ? input : input.candidates ?? [];
        return JSON.stringify({ status: 'accepted', acceptedIds: candidates.map((item) => item.id) });
      }
      throw new Error('unexpected offline model stage');
    },
  };
}

function workerResponse(request, root) {
  const noHit = request.answerGoal.resolvedQuestion.includes('not_resolved_by_ticket');
  const evidence = [{
    id: 'worker_ev_01', kind: 'workspace', source: 'worker',
    summary: noHit ? '当前项目只读检查尚未定位根因' : '当前项目只读检查获得与历史线索可比较的配置证据', confidence: 'high',
  }];
  return {
    result: {
      status: 'partial', summary: evidence[0].summary,
      missingInfo: noHit ? ['仍需补充当前运行日志'] : [], evidence,
      claims: [{
        id: 'worker_claim_01', type: 'inference', role: 'primary_answer', text: evidence[0].summary,
        evidenceIds: ['worker_ev_01'], answers: request.answerGoal.mustAnswerItems,
      }],
      recommendedNextAction: 'continue_diagnosis',
    },
    trace: {
      command: 'offline-worker', cwd: root, stdout: 'offline-worker-private-output', stderr: '', exitCode: 0,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    },
    coverageEvidence: [{
      evidenceId: 'worker_ev_01', kind: 'workspace', safeText: evidence[0].summary,
      runId: request.runId, validated: true,
    }],
  };
}

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SuperHelperConfig } from '../config.js';
import {
  buildAcceptanceReport,
  summarizeCheck,
  writeAcceptanceReport,
} from '../knowledge/acceptance.js';
import {
  knowledgeRoot,
  routeKnowledgeQuestion,
  type KnowledgeEvidencePack,
  type KnowledgeRoute,
} from '../knowledge/index.js';
import type {
  KnowledgeAcceptanceReport,
  KnowledgeAcceptanceScenario,
} from '../knowledge/types.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import { curateSolvedCase } from './case-curator.js';
import { planDeepQuery } from './deep-query-planner.js';
import { judgeKnowledgeEvidence, type EvidenceJudgeResult } from './evidence-judge.js';
import { prepareKnowledgeDiagnosis } from './knowledge-diagnosis.js';

export interface RunKnowledgeAcceptanceInput {
  config: SuperHelperConfig;
  projectWorkspaceRoot: string;
  knowledgeWorkspaceRoot: string;
  reportDir: string;
  mockWorker?: boolean;
  realWorker?: boolean;
  timeoutMs?: number;
  redact?: boolean;
  keepCases?: boolean;
}

export interface RunKnowledgeAcceptanceResult {
  report: KnowledgeAcceptanceReport;
  reportPath: string;
}

export async function runKnowledgeAcceptance(input: RunKnowledgeAcceptanceInput): Promise<RunKnowledgeAcceptanceResult> {
  const scenarios: KnowledgeAcceptanceScenario[] = [];
  scenarios.push(runConfigChecks(input));
  scenarios.push(await runDirectKnowledgeScenario(input, {
    id: 'whitepaper_ai_companion_direct',
    name: 'AI companion whitepaper direct answer',
    question: 'AI伴学助手学习日晚上8点未完成任务会怎么提醒？',
    expectedSource: /AI伴学|伴学助手|ai/i,
  }));
  scenarios.push(await runDirectKnowledgeScenario(input, {
    id: 'whitepaper_edusoho_direct',
    name: 'EduSoho training whitepaper direct answer',
    question: 'EduSoho 教培线课程搜索栏支持按什么搜索课程？',
    expectedSource: /EduSoho|教培|edusoho/i,
  }));
  scenarios.push(await runNoHitEscalationScenario(input));
  scenarios.push(await runImplementationEscalationScenario(input));
  scenarios.push(runSolvedCaseCurationScenario(input));

  const failures = scenarios
    .filter((scenario) => !scenario.passed)
    .map((scenario) => ({ scenarioId: scenario.id, reason: scenario.reason }));
  const report = buildAcceptanceReport({
    workspaceRoot: input.knowledgeWorkspaceRoot,
    configSummary: {
      projectWorkspace: input.projectWorkspaceRoot,
      knowledgeWorkspace: input.knowledgeWorkspaceRoot,
      mockWorker: String(input.mockWorker ?? !input.realWorker),
      realWorker: String(Boolean(input.realWorker)),
      modelProvider: input.config.agent.modelProvider ?? '',
    },
    environmentSummary: {
      node: process.version,
      platform: process.platform,
    },
    scenarios,
    failures,
  });
  const reportPath = writeAcceptanceReport({ reportDir: input.reportDir, report });
  return { report, reportPath };
}

function runConfigChecks(input: RunKnowledgeAcceptanceInput): KnowledgeAcceptanceScenario {
  const root = knowledgeRoot(input.knowledgeWorkspaceRoot);
  const ingestReport = join(root, 'indexes', 'ingest-report.json');
  const manifest = join(root, 'indexes', 'manifest.json');
  const chunks = join(root, 'indexes', 'chunks.jsonl');
  const provider = input.config.agent.modelProvider
    ? input.config.models.providers[input.config.agent.modelProvider]
    : undefined;
  let sourceDocs = 0;
  if (existsSync(ingestReport)) {
    try {
      sourceDocs = Number((JSON.parse(readFileSync(ingestReport, 'utf8')) as { sourceDocuments?: number }).sourceDocuments ?? 0);
    } catch {
      sourceDocs = 0;
    }
  }
  const claudeAvailable = !input.realWorker || spawnSync(input.config.claude.command, ['--version'], {
    encoding: 'utf8',
    timeout: input.timeoutMs ?? 5000,
  }).status === 0;
  const checks = [
    summarizeCheck('project_workspace_exists', 'ok', existsSync(input.projectWorkspaceRoot), input.projectWorkspaceRoot),
    summarizeCheck('knowledge_dir_exists', 'ok', existsSync(root), root),
    summarizeCheck('ingest_report_exists', 'ok', existsSync(ingestReport), ingestReport),
    summarizeCheck('manifest_exists', 'ok', existsSync(manifest), manifest),
    summarizeCheck('chunks_exists', 'ok', existsSync(chunks), chunks),
    summarizeCheck('source_documents_count', 'info', sourceDocs >= 2, `source documents: ${sourceDocs}`),
    summarizeCheck('model_provider_configured', 'info', Boolean(provider), input.config.agent.modelProvider ?? 'none'),
    summarizeCheck('claude_command_available', input.realWorker ? 'ok' : 'info', claudeAvailable, claudeAvailable ? 'claude available or not required' : 'claude command unavailable'),
    summarizeCheck('read_only_worker_policy', 'ok', input.config.claude.allowedTools.every((tool) => ['Read', 'Glob', 'Grep'].includes(tool)), input.config.claude.allowedTools.join(',')),
  ];
  const passed = checks.filter((check) => check.severity === 'ok' || check.severity === 'error').every((check) => check.passed);
  return {
    id: 'config_checks',
    name: 'Acceptance Config Checks',
    question: '',
    passed,
    reason: passed ? 'all required config checks passed' : 'one or more required config checks failed',
    evidenceIds: [],
    workerCallCount: 0,
    logPhases: ['config_check'],
    checks,
  };
}

async function runDirectKnowledgeScenario(
  input: RunKnowledgeAcceptanceInput,
  scenario: { id: string; name: string; question: string; expectedSource: RegExp },
): Promise<KnowledgeAcceptanceScenario> {
  const { evidencePack, judge } = await diagnoseKnowledge(input, scenario.question);
  const top = evidencePack.results[0];
  const sourceText = `${top?.source ?? ''} ${top?.source_document ?? ''} ${top?.title ?? ''}`;
  const passed = judge.answerable && Boolean(top) && scenario.expectedSource.test(sourceText);
  return {
    id: scenario.id,
    name: scenario.name,
    question: scenario.question,
    passed,
    reason: passed ? 'knowledge evidence is answerable without worker' : `not answerable or source mismatch: ${judge.reason}`,
    caseId: `accept_${scenario.id}`,
    runId: 'run_01',
    evidenceIds: evidencePack.results.map((result) => result.evidence_id),
    workerCallCount: 0,
    logPhases: ['knowledge_router_result', 'knowledge_search_result', 'evidence_judge_result'],
    checks: [
      summarizeCheck('judge_answerable', 'ok', judge.answerable, judge.reason, { answerScore: judge.answer_score, blockers: judge.blockers }),
      summarizeCheck('expected_source_match', 'ok', scenario.expectedSource.test(sourceText), sourceText),
    ],
  };
}

async function runNoHitEscalationScenario(input: RunKnowledgeAcceptanceInput): Promise<KnowledgeAcceptanceScenario> {
  const question = 'no-hit-acceptance-token-zxqv-20260614-zkpqwlm';
  const { route, evidencePack, judge } = await diagnoseKnowledge(input, question);
  const deepQuery = planDeepQuery({ question, route, evidencePack, judge });
  const hasBroadening = deepQuery.correctionActions.some((action) => action === 'expand_aliases' || action === 'broaden_source_types');
  const passed = evidencePack.results.length === 0 && judge.need_code_escalation && deepQuery.permission === 'read_only' && hasBroadening;
  return {
    id: 'no_hit_escalation',
    name: 'No-hit escalation',
    question,
    passed,
    reason: passed ? 'no knowledge hit escalates with read-only deep query broadening' : judge.reason,
    caseId: 'accept_no_hit',
    runId: 'run_01',
    evidenceIds: evidencePack.results.map((result) => result.evidence_id),
    workerCallCount: 1,
    logPhases: ['knowledge_search_result', 'evidence_judge_result', 'code_escalation_requested'],
    checks: [
      summarizeCheck('zero_knowledge_evidence', 'ok', evidencePack.results.length === 0, `evidence count: ${evidencePack.results.length}`),
      summarizeCheck('read_only_deep_query', 'ok', deepQuery.permission === 'read_only', deepQuery.permission),
      summarizeCheck('correction_broadening', 'ok', hasBroadening, deepQuery.correctionActions.join(',')),
    ],
  };
}

async function runImplementationEscalationScenario(input: RunKnowledgeAcceptanceInput): Promise<KnowledgeAcceptanceScenario> {
  const question = '接口 /api/acceptance/config 返回 500，帮我看当前实现和配置读取路径';
  const { route, evidencePack, judge } = await diagnoseKnowledge(input, question);
  const deepQuery = planDeepQuery({ question, route, evidencePack, judge });
  const passed = judge.blockers.includes('implementation_detail') && judge.need_code_escalation && deepQuery.permission === 'read_only';
  return {
    id: 'implementation_detail_escalation',
    name: 'Implementation detail escalation',
    question,
    passed,
    reason: passed ? 'implementation detail blocker escalates to read-only worker request' : judge.reason,
    caseId: 'accept_impl',
    runId: 'run_01',
    evidenceIds: evidencePack.results.map((result) => result.evidence_id),
    workerCallCount: 1,
    logPhases: ['evidence_judge_result', 'code_escalation_requested'],
    checks: [
      summarizeCheck('implementation_blocker', 'ok', judge.blockers.includes('implementation_detail'), judge.blockers.join(',')),
      summarizeCheck('read_only_deep_query', 'ok', deepQuery.permission === 'read_only', deepQuery.permission),
    ],
  };
}

async function diagnoseKnowledge(
  input: RunKnowledgeAcceptanceInput,
  question: string,
): Promise<{
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
}> {
  const diagnosis = await prepareKnowledgeDiagnosis({
    config: input.config,
    workspaceRoot: input.knowledgeWorkspaceRoot,
    question,
    persona: 'operations',
  });
  if (diagnosis) {
    return diagnosis;
  }
  const route = routeKnowledgeQuestion({ workspaceRoot: input.knowledgeWorkspaceRoot, question });
  const evidencePack: KnowledgeEvidencePack = {
    query: {
      normalized_question: route.normalizedQuestion,
      module_candidates: route.moduleCandidates,
      intent_candidates: route.intentCandidates,
      keywords: route.keywords,
    },
    results: [],
    coverage: { searched_files: 0, matched_files: 0, filtered_out: [] },
  };
  return {
    route,
    evidencePack,
    judge: judgeKnowledgeEvidence({ route, evidencePack, question }),
  };
}

function runSolvedCaseCurationScenario(input: RunKnowledgeAcceptanceInput): KnowledgeAcceptanceScenario {
  const tempRoot = input.keepCases ? undefined : mkdtempSync(join(tmpdir(), 'super-helper-accept-case-'));
  const curationWorkspaceRoot = tempRoot ?? input.knowledgeWorkspaceRoot;
  try {
    const now = new Date().toISOString();
    const caseSession: StoredCase = {
      id: 'accept_case_curation',
      claudeSessionId: 'claude_accept',
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: input.config.workspaces[0]?.id ?? 'current',
      title: '验收 solved case',
      status: 'concluded',
      userPersona: 'operations',
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: 'msg_user', role: 'user', body: '验收场景为什么失败？', createdAt: now },
        { id: 'msg_helper', role: 'helper', body: '根据证据，问题由配置缺失导致。', createdAt: now, replyToMessageId: 'msg_user' },
      ],
      runs: [
        {
          id: 'run_01',
          caseId: 'accept_case_curation',
          status: 'concluded',
          result: {
            status: 'concluded',
            summary: '配置缺失导致验收场景失败。',
            missingInfo: [],
            evidence: [
              { id: 'ev_accept', kind: 'knowledge', source: 'knowledge/faq/general/accept.md', summary: '配置缺失会导致验收失败。', confidence: 'medium' },
            ],
            claims: [
              { type: 'fact', text: '配置缺失会导致验收失败。', evidenceIds: ['ev_accept'] },
            ],
            recommendedNextAction: 'final_answer',
          },
        },
      ],
      logs: [],
    };
    const draft = curateSolvedCase({
      workspaceRoot: curationWorkspaceRoot,
      caseSession,
      confirmationMessage: '已解决',
    });
    const dirtyFlag = join(curationWorkspaceRoot, 'knowledge', 'indexes', 'dirty.flag');
    const passed = draft.status === 'review_required' && existsSync(draft.path) && existsSync(dirtyFlag);
    return {
      id: 'solved_case_curation_smoke',
      name: 'Solved case curation smoke',
      question: '已解决',
      passed,
      reason: passed ? 'review_required solved case draft created and index marked dirty' : 'solved case draft or dirty flag missing',
      caseId: caseSession.id,
      runId: 'run_01',
      evidenceIds: ['ev_accept'],
      workerCallCount: 0,
      logPhases: ['case_curator_started', 'case_curator_result'],
      checks: [
        summarizeCheck('draft_review_required', 'ok', draft.status === 'review_required', draft.status),
        summarizeCheck('dirty_flag_written', 'ok', existsSync(dirtyFlag), 'dirty.flag'),
        summarizeCheck(
          'curation_workspace_isolated',
          'info',
          Boolean(input.keepCases) || curationWorkspaceRoot !== input.knowledgeWorkspaceRoot,
          Boolean(input.keepCases) ? 'keep-cases requested; wrote to real knowledge workspace' : 'temporary knowledge workspace used',
        ),
      ],
    };
  } finally {
    if (tempRoot && !input.keepCases) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

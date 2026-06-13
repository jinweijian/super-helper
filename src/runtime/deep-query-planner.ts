import type { DiagnosticRequest } from '../domain.js';
import type { KnowledgeEvidencePack, KnowledgeRoute } from '../knowledge/index.js';
import type { EvidenceJudgeResult } from './evidence-judge.js';
import { correctionActionsFor } from './query-correction.js';

export interface DeepQueryPlan {
  permission: 'read_only';
  artifactTargets: string[];
  anchorTerms: string[];
  likelyPaths: string[];
  avoidAssumptions: string[];
  correctionActions: string[];
}

export function planDeepQuery(input: {
  question: string;
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
}): DeepQueryPlan {
  const artifactTargets = inferArtifactTargets(input.question, input.route);
  const anchorTerms = Array.from(new Set([
    ...input.route.keywords,
    ...input.route.moduleCandidates,
    ...input.route.intentCandidates,
    ...input.evidencePack.results.flatMap((result) => result.matched_terms),
  ])).slice(0, 24);

  return {
    permission: 'read_only',
    artifactTargets,
    anchorTerms,
    likelyPaths: likelyPathsFor(artifactTargets),
    avoidAssumptions: [
      '不要把用户猜测的方向直接当作根因。',
      '如果知识库证据不足，请用 Read/Glob/Grep 找当前实现证据。',
      '如果找不到证据，返回缺口和已尝试的关键词，不要编造结论。',
    ],
    correctionActions: correctionActionsFor({
      noHits: input.evidencePack.results.length === 0,
      ambiguous: !input.judge.answerable && input.evidencePack.results.length > 0,
      artifactTargets,
    }),
  };
}

export function attachDeepQueryContext(input: {
  request: DiagnosticRequest;
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  deepQuery: DeepQueryPlan;
}): void {
  input.request.context ??= {
    isFollowUp: false,
    currentUserMessage: input.request.userGoal,
    recentMessages: [],
    previousRuns: [],
  };
  input.request.context.knowledge = {
    route: {
      normalizedQuestion: input.route.normalizedQuestion,
      moduleCandidates: input.route.moduleCandidates,
      intentCandidates: input.route.intentCandidates,
      keywords: input.route.keywords,
      sourceTypes: input.route.sourceTypes,
      codeEscalationSignals: input.route.codeEscalationSignals,
      risks: input.route.risks,
    },
    evidence: input.evidencePack.results.slice(0, 8).map((result) => ({
      id: result.evidence_id,
      source: result.source,
      title: result.title,
      summary: result.summary,
      confidence: result.confidence,
      status: result.status,
      matchedTerms: result.matched_terms,
    })),
    judge: input.judge,
  };
  input.request.context.deepQuery = input.deepQuery;
  input.request.knownFacts = Array.from(new Set([
    ...input.request.knownFacts,
    `知识库证据判断：${input.judge.reason}`,
    ...input.evidencePack.results.slice(0, 5).map((result) => `${result.evidence_id}: ${result.summary} (${result.source})`),
  ]));
  input.request.constraints = Array.from(new Set([
    ...input.request.constraints,
    '知识库证据不足或问题依赖当前实现，请执行带线索的只读静态调查。',
    `优先检查 artifact targets: ${input.deepQuery.artifactTargets.join(', ') || 'general workspace evidence'}.`,
    `优先使用 anchor terms: ${input.deepQuery.anchorTerms.join(', ') || input.request.userGoal}.`,
    ...input.deepQuery.avoidAssumptions,
  ]));
}

function inferArtifactTargets(question: string, route: KnowledgeRoute): string[] {
  const text = `${question}\n${route.codeEscalationSignals.join('\n')}`;
  const targets = new Set<string>();
  if (/定时|cron|scheduler|job|任务/.test(text)) targets.add('scheduler');
  if (/queue|consumer|event|消息|队列/.test(text)) targets.add('queue');
  if (/callback|webhook|回调/.test(text)) targets.add('callback');
  if (/状态|state|status|完成|进度/.test(text)) targets.add('state_machine');
  if (/权限|permission|role|auth|登录/.test(text)) targets.add('permission');
  if (/支付|订单|payment|order|退款/.test(text)) targets.add('payment');
  if (/config|配置|env|开关/.test(text)) targets.add('config');
  if (/\/[A-Za-z0-9_\-/{}:?=&.]+|接口|route|router|controller/.test(text)) targets.add('route');
  if (/service|服务|实现|代码|当前实现/.test(text)) targets.add('service');
  if (targets.size === 0) targets.add('service');
  return Array.from(targets);
}

function likelyPathsFor(targets: string[]): string[] {
  const patterns: Record<string, string[]> = {
    scheduler: ['src/**/scheduler*', 'src/**/*job*', 'src/**/*cron*', 'src/**/*task*'],
    queue: ['src/**/*queue*', 'src/**/*consumer*', 'src/**/*event*'],
    callback: ['src/**/*callback*', 'src/**/*webhook*', 'src/**/*handler*'],
    state_machine: ['src/**/*state*', 'src/**/*status*', 'src/**/*progress*'],
    permission: ['src/**/*auth*', 'src/**/*permission*', 'src/**/*role*'],
    payment: ['src/**/*payment*', 'src/**/*order*', 'src/**/*refund*'],
    config: ['src/**/*config*', '**/*.env*', '**/*settings*'],
    route: ['src/**/*route*', 'src/**/*router*', 'src/**/*controller*'],
    service: ['src/**/*service*', 'src/**/*manager*', 'src/**/*repository*'],
  };
  return Array.from(new Set(targets.flatMap((target) => patterns[target] ?? []))).slice(0, 20);
}

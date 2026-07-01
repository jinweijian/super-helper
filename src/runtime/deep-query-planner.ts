import type { DiagnosticRequest } from '../domain.js';
import type { KnowledgeEvidencePack, KnowledgeRoute } from '../knowledge/index.js';
import type { EvidenceJudgeResult } from './evidence-judge.js';
import type { RagAnswerabilityResult } from './rag-answerability-service.js';
import { correctionActionsFor } from './query-correction.js';

export interface DeepQueryPlan {
  permission: 'read_only';
  artifactTargets: string[];
  anchorTerms: string[];
  likelyPaths: string[];
  projectType: string;
  avoidAssumptions: string[];
  correctionActions: string[];
  attempt: number;
  maxAttempts: number;
  triedQueries: string[];
  failedReasons: string[];
  nextPivot?: string;
  stopReason?: 'max_attempts' | 'sufficient_evidence' | 'needs_user' | 'human_escalation';
  previousArtifactTargets: string[];
}

export function planDeepQuery(input: {
  question: string;
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  attempt?: number;
  maxAttempts?: number;
  previousArtifactTargets?: string[];
  triedQueries?: string[];
  failedReasons?: string[];
  projectType?: string;
  glossaryTerms?: string[];
  answerability?: RagAnswerabilityResult;
}): DeepQueryPlan {
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 2;
  const projectType = normalizeProjectType(input.projectType);
  const answerabilityFocus = answerabilityFocusText(input.answerability);
  const artifactTargets = inferArtifactTargets(input.question, input.route, answerabilityFocus);
  const anchorTerms = filterMeaningfulAnchorTerms(Array.from(new Set([
    ...input.route.keywords,
    ...input.route.moduleCandidates,
    ...input.route.intentCandidates,
    ...input.evidencePack.results.flatMap((result) => result.matched_terms),
    ...answerabilityAnchorTerms(input.answerability),
  ])), input.glossaryTerms).slice(0, 24);

  return {
    permission: 'read_only',
    artifactTargets,
    anchorTerms,
    likelyPaths: likelyPathsFor(artifactTargets, projectType),
    projectType,
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
    attempt,
    maxAttempts,
    triedQueries: input.triedQueries ?? [],
    failedReasons: input.failedReasons ?? [],
    nextPivot: undefined,
    stopReason: undefined,
    previousArtifactTargets: input.previousArtifactTargets ?? [],
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
      sourceDocument: result.source_document,
      sourceDocumentId: result.source_document_id,
      sourceBlockIds: result.source_block_ids,
      sectionPath: result.section_path,
      title: result.title,
      summary: result.summary,
      answerSpan: result.answer_span,
      confidence: result.confidence,
      status: result.status,
      matchedTerms: result.matched_terms,
      quality: result.quality,
      retrieval: result.retrieval,
      groundingIssues: result.grounding_issues,
      taxonomyKnown: result.taxonomy_known,
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

const MODULE_TO_ARTIFACT_TARGETS: Record<string, string[]> = {
  'marketing-theme': ['template', 'widget', 'config'],
  'ai-companion': ['service', 'config'],
  'edusoho-training': ['service', 'controller', 'template', 'config'],
};

const BIGRAM_NOISE = new Set(['销主', '题中', '中关']);

function inferArtifactTargets(question: string, route: KnowledgeRoute, answerabilityFocus = ''): string[] {
  const targets = new Set<string>();
  for (const module of route.moduleCandidates) {
    for (const target of MODULE_TO_ARTIFACT_TARGETS[module] ?? []) {
      targets.add(target);
    }
  }
  addRegexArtifactTargets(targets, `${question}\n${route.codeEscalationSignals.join('\n')}\n${answerabilityFocus}`, false);
  if (targets.size === 0) {
    addRegexArtifactTargets(targets, `${question}\n${route.codeEscalationSignals.join('\n')}\n${answerabilityFocus}`, true);
  }
  return Array.from(targets);
}

function answerabilityFocusText(answerability?: RagAnswerabilityResult): string {
  if (!answerability) return '';
  return [
    answerability.escalationFocus,
    ...answerability.missingElements,
  ].filter(Boolean).join('\n');
}

function answerabilityAnchorTerms(answerability?: RagAnswerabilityResult): string[] {
  if (!answerability) return [];
  return [
    ...answerability.missingElements,
    answerability.escalationFocus,
    ...answerability.coveredClaims.flatMap((claim) => claim.coveredRequirementIds),
  ].filter(Boolean);
}

function addRegexArtifactTargets(targets: Set<string>, text: string, fallback: boolean): void {
  if (/定时|cron|scheduler|job|任务/.test(text)) targets.add('scheduler');
  if (/queue|consumer|event|消息|队列/.test(text)) targets.add('queue');
  if (/callback|webhook|回调/.test(text)) targets.add('callback');
  if (/状态|state|status|完成|进度/.test(text)) targets.add('state_machine');
  if (/权限|permission|role|auth|登录/.test(text)) targets.add('permission');
  if (/支付|订单|payment|order|退款/.test(text)) targets.add('payment');
  if (/config|配置|env|开关/.test(text)) targets.add('config');
  if (/\/[A-Za-z0-9_\-/{}:?=&.]+|接口|route|router|controller/.test(text)) targets.add('route');
  if (/service|服务|实现|代码|当前实现/.test(text)) targets.add('service');
  if (fallback && targets.size === 0) targets.add('service');
}

function likelyPathsFor(targets: string[], projectType: string): string[] {
  const patternByType: Record<string, Record<string, string[]>> = {
    generic: {
    scheduler: ['src/**/scheduler*', 'src/**/*job*', 'src/**/*cron*', 'src/**/*task*'],
    queue: ['src/**/*queue*', 'src/**/*consumer*', 'src/**/*event*'],
    callback: ['src/**/*callback*', 'src/**/*webhook*', 'src/**/*handler*'],
    state_machine: ['src/**/*state*', 'src/**/*status*', 'src/**/*progress*'],
    permission: ['src/**/*auth*', 'src/**/*permission*', 'src/**/*role*'],
    payment: ['src/**/*payment*', 'src/**/*order*', 'src/**/*refund*'],
    config: ['src/**/*config*', '**/*.env*', '**/*settings*'],
    route: ['src/**/*route*', 'src/**/*router*', 'src/**/*controller*'],
    service: ['src/**/*service*', 'src/**/*manager*', 'src/**/*repository*'],
    },
    symfony: {
      template: ['web/themes/**/*.twig', 'app/Resources/**/*.twig'],
      widget: ['web/themes/**/*widget*', 'web/themes/**/*block*', 'web/themes/**/parts/**/*.twig'],
      config: ['app/config/**/*.yml', 'app/config/**/*.yaml'],
      route: ['app/config/**/*routing*.yml', 'src/Bundle/**/*Controller.php'],
      controller: ['src/Bundle/**/*Controller.php'],
      service: ['src/Bundle/**/*Service*.php', 'src/Bundle/**/*Manager*.php', 'src/Bundle/**/*Repository*.php'],
      permission: ['src/Bundle/**/*Voter.php', 'src/Bundle/**/*Permission*.php'],
      queue: ['src/Bundle/**/*Consumer*.php', 'src/Bundle/**/*Event*.php'],
      scheduler: ['src/Bundle/**/*Job*.php', 'src/Bundle/**/*Task*.php'],
    },
    node: {
      service: ['src/**/*service*', 'lib/**/*service*'],
      route: ['src/**/*route*', 'src/**/*router*', 'src/**/*controller*', 'lib/**/*route*'],
      config: ['src/**/*config*', 'config/**/*', '**/*.env*'],
      queue: ['src/**/*queue*', 'lib/**/*queue*', 'src/**/*consumer*'],
    },
    vue: {
      template: ['src/**/*.vue', 'src/**/components/**/*'],
      widget: ['src/**/components/**/*', 'src/**/widgets/**/*'],
      config: ['src/**/*config*', 'vite.config.*', 'vue.config.*'],
      service: ['src/**/*service*', 'src/**/api/**/*'],
      route: ['src/**/*router*', 'src/**/routes*'],
    },
  };
  const patterns = patternByType[projectType] ?? patternByType.generic;
  return Array.from(new Set(targets.flatMap((target) => patterns[target] ?? []))).slice(0, 20);
}

function filterMeaningfulAnchorTerms(terms: string[], glossaryTerms: string[] = []): string[] {
  const glossary = new Set(glossaryTerms.map((term) => term.trim()).filter(Boolean));
  return terms.filter((term) => {
    const value = term.trim();
    if (!value) return false;
    if (glossary.has(value)) return true;
    if (/^[A-Za-z][A-Za-z0-9_-]+$/.test(value)) return true;
    if (!/^[\u4e00-\u9fff]{2,}$/.test(value)) return value.length >= 2;
    if (BIGRAM_NOISE.has(value)) return false;
    return true;
  });
}

function normalizeProjectType(projectType: string | undefined): string {
  const value = projectType?.trim().toLowerCase();
  return value || 'generic';
}

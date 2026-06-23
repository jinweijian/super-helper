import { existsSync } from 'node:fs';
import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRequest, DiagnosticResult, Evidence, UserPersona } from '../domain.js';
import {
  discoverKnowledgeDocuments,
  knowledgeRoot,
  routeKnowledgeQuestion,
  type KnowledgeEvidencePack,
  type KnowledgeRoute,
  type KnowledgeSearchQuery,
  type KnowledgeVisibility,
} from '../knowledge/index.js';
import {
  retrieveKnowledgeWithConfiguredRetrieval,
  type ConfiguredKnowledgeRetrievalResult,
} from '../retrieval/configured-search.js';
import type { RetrievalTrace } from '../retrieval/types.js';
import { attachDeepQueryContext, planDeepQuery } from './deep-query-planner.js';
import { judgeKnowledgeEvidence, type EvidenceJudgeResult } from './evidence-judge.js';

export async function searchKnowledgeForRuntime(input: {
  config: SuperHelperConfig;
  query: KnowledgeSearchQuery;
}): Promise<ConfiguredKnowledgeRetrievalResult> {
  return retrieveKnowledgeWithConfiguredRetrieval({
    config: input.config,
    query: input.query,
  });
}

export async function prepareKnowledgeDiagnosis(input: {
  config: SuperHelperConfig;
  workspaceRoot: string;
  question: string;
  persona: UserPersona;
}): Promise<{
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  retrievalTrace: RetrievalTrace;
} | undefined> {
  if (!existsSync(knowledgeRoot(input.workspaceRoot))) {
    return undefined;
  }
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  if (docs.length === 0) {
    return undefined;
  }

  const route = routeKnowledgeQuestion({
    workspaceRoot: input.workspaceRoot,
    question: input.question,
  });
  let retrieval = await searchKnowledgeForRuntime({
    config: input.config,
    query: {
      workspaceRoot: input.workspaceRoot,
      query: input.question,
      moduleCandidates: route.moduleCandidates,
      intentCandidates: route.intentCandidates,
      sourceTypes: route.sourceTypes,
      visibility: knowledgeVisibilityForPersona(input.persona),
      limit: 8,
    },
  });
  if (retrieval.evidencePack.results.length === 0 && route.sourceTypes.length > 0) {
    retrieval = await searchKnowledgeForRuntime({
      config: input.config,
      query: {
        workspaceRoot: input.workspaceRoot,
        query: input.question,
        moduleCandidates: route.moduleCandidates,
        intentCandidates: route.intentCandidates,
        visibility: knowledgeVisibilityForPersona(input.persona),
        limit: 8,
      },
    });
  }
  const { evidencePack, trace: retrievalTrace } = retrieval;
  const judge = judgeKnowledgeEvidence({
    route,
    evidencePack,
    question: input.question,
  });
  return { route, evidencePack, judge, retrievalTrace };
}

export function attachKnowledgeCodeEscalationContext(input: {
  request: DiagnosticRequest;
  question: string;
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
}): void {
  const deepQuery = planDeepQuery({
    question: input.question,
    route: input.route,
    evidencePack: input.evidencePack,
    judge: input.judge,
  });
  attachDeepQueryContext({
    request: input.request,
    route: input.route,
    evidencePack: input.evidencePack,
    judge: input.judge,
    deepQuery,
  });
}

export function diagnosticResultFromKnowledge(input: {
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  route: KnowledgeRoute;
}): DiagnosticResult {
  const answerEvidence = input.evidencePack.results.filter((result) => result.status === 'active');
  const evidence: Evidence[] = answerEvidence.slice(0, 6).map((result) => ({
    id: result.evidence_id,
    kind: 'knowledge',
    source: sourceLabel(result),
    summary: `${result.title}：${result.answer_span ?? result.excerpt ?? result.summary}`,
    confidence: result.confidence,
    validation: {
      status: result.status === 'active' ? 'active' : result.status === 'review_required' ? 'review_required' : result.status === 'deprecated' ? 'deprecated' : 'inactive',
      visibility: result.visibility,
      lastVerifiedAt: result.last_verified_at,
      quality: result.quality?.severity,
    },
  }));
  const top = answerEvidence[0];
  const summary = top
    ? `知识库命中「${top.title}」，可回答：${top.answer_span ?? top.excerpt ?? top.summary}`
    : '知识库证据足够回答当前问题。';

  return {
    status: 'concluded',
    summary,
    missingInfo: [],
    evidence,
    claims: [
      {
        type: 'fact',
        text: summary,
        evidenceIds: evidence.map((item) => item.id),
      },
      {
        type: 'inference',
        text: `Evidence Judge 判定知识证据可直接回答，answer_score=${input.judge.answer_score}，模块候选：${input.route.moduleCandidates.join('、') || '未限定'}`,
        evidenceIds: evidence.map((item) => item.id),
      },
    ],
    recommendedNextAction: 'final_answer',
  };
}

export function knowledgeVisibilityForPersona(persona: UserPersona): KnowledgeVisibility[] {
  if (persona === 'customer') {
    return ['customer_safe'];
  }
  if (persona === 'operations') {
    return ['customer_safe', 'internal'];
  }
  return ['customer_safe', 'internal', 'support'];
}

function sourceLabel(result: KnowledgeEvidencePack['results'][number]): string {
  const pages = result.source_pages?.length ? ` pages=${result.source_pages.join(',')}` : '';
  const sourceDocument = result.source_document ? ` source=${result.source_document}` : '';
  return `${result.source}${sourceDocument}${pages}`;
}

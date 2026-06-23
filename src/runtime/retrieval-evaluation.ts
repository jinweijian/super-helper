import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SuperHelperConfig } from '../config.js';
import {
  routeKnowledgeQuestion,
  type KnowledgeEvidencePack,
} from '../knowledge/index.js';
import { createEmptyRetrievalTrace } from '../retrieval/trace.js';
import type { RetrievalTrace } from '../retrieval/types.js';
import { judgeKnowledgeEvidence } from './evidence-judge.js';
import { prepareKnowledgeDiagnosis } from './knowledge-diagnosis.js';

export type RuntimeRetrievalExpectedBehavior = 'direct' | 'abstain' | 'escalate';

export interface RuntimeRetrievalEvaluationQuestion {
  id: string;
  question: string;
  expectedParentId?: string;
  expectedBehavior: RuntimeRetrievalExpectedBehavior;
  split?: 'calibration' | 'holdout';
  category?: 'exact' | 'paraphrase' | 'generic' | 'no_hit' | 'implementation_risk' | 'visibility_stale_conflict';
}

export interface RuntimeRetrievalEvaluationThresholds {
  recallAt5: number;
  mrr: number;
  directAnswerPrecision: number;
  abstentionAccuracy: number;
  mustEscalateAccuracy: number;
}

export interface RuntimeRetrievalEvaluationReport {
  version: 1;
  generatedAt: string;
  passed: boolean;
  offline: boolean;
  questionCount: number;
  thresholds: RuntimeRetrievalEvaluationThresholds;
  metrics: RuntimeRetrievalEvaluationThresholds;
  splitMetrics: {
    calibration?: RuntimeRetrievalEvaluationThresholds;
    holdout?: RuntimeRetrievalEvaluationThresholds;
  };
  failures: Array<{ questionId: string; reason: string; attribution: 'retrieval' | 'evidence_judge' }>;
  questions: Array<{
    id: string;
    expectedBehavior: RuntimeRetrievalExpectedBehavior;
    expectedParentId?: string;
    split?: RuntimeRetrievalEvaluationQuestion['split'];
    category?: RuntimeRetrievalEvaluationQuestion['category'];
    parentRank?: number;
    answerable: boolean;
    recommendedAction: string;
    blockers: string[];
    topEvidence?: {
      evidenceId: string;
      parentId: string;
      title: string;
      source: string;
      score: number;
      quality?: string;
    };
    trace: RetrievalTrace;
    passed: boolean;
  }>;
}

const DEFAULT_THRESHOLDS: RuntimeRetrievalEvaluationThresholds = {
  recallAt5: 1,
  mrr: 1,
  directAnswerPrecision: 1,
  abstentionAccuracy: 1,
  mustEscalateAccuracy: 1,
};

export async function runRuntimeRetrievalEvaluation(input: {
  config: SuperHelperConfig;
  workspaceRoot: string;
  questions: RuntimeRetrievalEvaluationQuestion[];
  thresholds?: Partial<RuntimeRetrievalEvaluationThresholds>;
  reportPath?: string;
}): Promise<RuntimeRetrievalEvaluationReport> {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const failures: RuntimeRetrievalEvaluationReport['failures'] = [];
  const questions: RuntimeRetrievalEvaluationReport['questions'] = [];

  for (const question of input.questions) {
    const diagnosis = await evaluateThroughRuntime({
      config: input.config,
      workspaceRoot: input.workspaceRoot,
      question: question.question,
    });
    const rank = question.expectedParentId
      ? diagnosis.evidencePack.results.findIndex((result) => result.parent_id === question.expectedParentId) + 1
      : 0;
    const parentRank = rank > 0 ? rank : undefined;
    const correctDirectAnswer = (
      question.expectedBehavior === 'direct' &&
      diagnosis.judge.answerable &&
      (!question.expectedParentId || parentRank === 1)
    );
    const correctAbstention = question.expectedBehavior === 'abstain' && !diagnosis.judge.answerable;
    const correctEscalation = (
      question.expectedBehavior === 'escalate' &&
      !diagnosis.judge.answerable &&
      diagnosis.judge.recommended_next_action !== 'final_answer'
    );
    const retrievalPassed = !question.expectedParentId || (parentRank !== undefined && parentRank <= 5);
    const behaviorPassed = correctDirectAnswer || correctAbstention || correctEscalation;
    const passed = retrievalPassed && behaviorPassed;

    if (!retrievalPassed) {
      failures.push({
        questionId: question.id,
        reason: `expected parent ${question.expectedParentId} not found in top 5`,
        attribution: 'retrieval',
      });
    } else if (!behaviorPassed) {
      failures.push({
        questionId: question.id,
        reason: `expected ${question.expectedBehavior}, got ${diagnosis.judge.recommended_next_action}`,
        attribution: 'evidence_judge',
      });
    }

    const top = diagnosis.evidencePack.results[0];
    questions.push({
      id: question.id,
      expectedBehavior: question.expectedBehavior,
      expectedParentId: question.expectedParentId,
      split: question.split,
      category: question.category,
      parentRank,
      answerable: diagnosis.judge.answerable,
      recommendedAction: diagnosis.judge.recommended_next_action,
      blockers: [...diagnosis.judge.blockers],
      topEvidence: top ? {
        evidenceId: top.evidence_id,
        parentId: top.parent_id,
        title: top.title,
        source: top.source,
        score: top.score,
        quality: top.quality?.severity,
      } : undefined,
      trace: diagnosis.retrievalTrace,
      passed,
    });
  }

  const metrics = calculateMetrics(questions);
  const calibrationQuestions = questions.filter((question) => question.split === 'calibration');
  const holdoutQuestions = questions.filter((question) => question.split === 'holdout');
  const splitMetrics = {
    calibration: calibrationQuestions.length ? calculateMetrics(calibrationQuestions) : undefined,
    holdout: holdoutQuestions.length ? calculateMetrics(holdoutQuestions) : undefined,
  };
  const releaseMetrics = splitMetrics.holdout ?? metrics;
  const releaseQuestions = holdoutQuestions.length ? holdoutQuestions : questions;
  const metricsPassed = (Object.keys(thresholds) as Array<keyof RuntimeRetrievalEvaluationThresholds>)
    .every((metric) => releaseMetrics[metric] >= thresholds[metric]);
  const report: RuntimeRetrievalEvaluationReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    passed: input.questions.length > 0 && releaseQuestions.every((question) => question.passed) && metricsPassed,
    offline: input.config.embedding.enabled !== true && input.config.rerank.enabled !== true,
    questionCount: input.questions.length,
    thresholds,
    metrics,
    splitMetrics,
    failures,
    questions,
  };

  if (input.reportPath) {
    mkdirSync(dirname(input.reportPath), { recursive: true });
    writeFileSync(input.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return report;
}

export function loadRuntimeRetrievalEvaluationQuestions(
  questionsPath: string,
): RuntimeRetrievalEvaluationQuestion[] {
  if (!existsSync(questionsPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(questionsPath, 'utf8')) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.questions) ? parsed.questions : [];
    return records.flatMap((record) => normalizeQuestion(record));
  } catch {
    return [];
  }
}

async function evaluateThroughRuntime(input: {
  config: SuperHelperConfig;
  workspaceRoot: string;
  question: string;
}): Promise<{
  evidencePack: KnowledgeEvidencePack;
  retrievalTrace: RetrievalTrace;
  judge: ReturnType<typeof judgeKnowledgeEvidence>;
}> {
  const diagnosis = await prepareKnowledgeDiagnosis({
    config: input.config,
    workspaceRoot: input.workspaceRoot,
    question: input.question,
    persona: 'operations',
  });
  if (diagnosis) {
    return diagnosis;
  }
  const route = routeKnowledgeQuestion({ workspaceRoot: input.workspaceRoot, question: input.question });
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
    evidencePack,
    retrievalTrace: createEmptyRetrievalTrace(),
    judge: judgeKnowledgeEvidence({ route, evidencePack, question: input.question }),
  };
}

function normalizeQuestion(value: unknown): RuntimeRetrievalEvaluationQuestion[] {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.question !== 'string') {
    return [];
  }
  const behavior = value.expectedBehavior ?? value.expected_behavior;
  if (behavior !== 'direct' && behavior !== 'abstain' && behavior !== 'escalate') {
    return [];
  }
  const parent = value.expectedParentId ?? value.expected_parent_id;
  const split = value.split;
  const category = value.category;
  return [{
    id: value.id,
    question: value.question,
    expectedParentId: typeof parent === 'string' && parent.trim() ? parent : undefined,
    expectedBehavior: behavior,
    split: split === 'calibration' || split === 'holdout' ? split : undefined,
    category: isEvaluationCategory(category) ? category : undefined,
  }];
}

function isEvaluationCategory(value: unknown): value is NonNullable<RuntimeRetrievalEvaluationQuestion['category']> {
  return ['exact', 'paraphrase', 'generic', 'no_hit', 'implementation_risk', 'visibility_stale_conflict'].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : round(numerator / denominator);
}

function calculateMetrics(
  questions: RuntimeRetrievalEvaluationReport['questions'],
): RuntimeRetrievalEvaluationThresholds {
  const retrievalQuestions = questions.filter((question) => question.expectedParentId);
  const directPredictions = questions.filter((question) => question.answerable);
  const abstentionQuestions = questions.filter((question) => question.expectedBehavior === 'abstain');
  const escalationQuestions = questions.filter((question) => question.expectedBehavior === 'escalate');
  return {
    recallAt5: ratio(
      retrievalQuestions.filter((question) => question.parentRank !== undefined && question.parentRank <= 5).length,
      retrievalQuestions.length,
    ),
    mrr: retrievalQuestions.length === 0
      ? 1
      : round(retrievalQuestions.reduce((sum, question) => sum + (question.parentRank ? 1 / question.parentRank : 0), 0) / retrievalQuestions.length),
    directAnswerPrecision: ratio(
      directPredictions.filter((question) => question.expectedBehavior === 'direct' && (!question.expectedParentId || question.parentRank === 1)).length,
      directPredictions.length,
    ),
    abstentionAccuracy: ratio(abstentionQuestions.filter((question) => !question.answerable).length, abstentionQuestions.length),
    mustEscalateAccuracy: ratio(
      escalationQuestions.filter((question) => !question.answerable && question.recommendedAction !== 'final_answer').length,
      escalationQuestions.length,
    ),
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

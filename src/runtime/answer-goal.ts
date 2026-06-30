import type { AnswerGoal, ResolvedTurnContext } from '../domain.js';

export function buildAnswerGoal(input: {
  resolvedTurn: ResolvedTurnContext;
  previousMissingInfo?: string[];
}): AnswerGoal {
  const rawUserQuestion = input.resolvedTurn.latestUserMessage.trim();
  const resolvedQuestion = input.resolvedTurn.resolvedQuery.trim() || rawUserQuestion;
  const answerObject = inferAnswerObject(resolvedQuestion || rawUserQuestion);
  return {
    rawUserQuestion,
    resolvedQuestion,
    answerObject,
    mustAnswerItems: [answerObject],
    diagnosticObjective: buildDiagnosticObjective(resolvedQuestion || rawUserQuestion, input.previousMissingInfo ?? []),
    sourceMessageIds: input.resolvedTurn.sourceMessageIds,
  };
}

export function answerGoalText(answerGoal: AnswerGoal): string {
  return answerGoal.resolvedQuestion || answerGoal.rawUserQuestion || answerGoal.answerObject;
}

export function primaryAnswerItems(answerGoal: AnswerGoal): string[] {
  return answerGoal.mustAnswerItems.length > 0 ? answerGoal.mustAnswerItems : [answerGoal.answerObject];
}

function inferAnswerObject(question: string): string {
  const normalized = question
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，。；;：:]+|[\s,，。；;：:?？!！]+$/g, '')
    .trim();
  const segments = normalized
    .split(/[\n。！？!?；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const meaningful = segments.find((item) => item.length >= 4) ?? normalized;
  return bound(meaningful || '当前问题', 120);
}

function buildDiagnosticObjective(question: string, previousMissingInfo: string[]): string {
  const base = `围绕当前用户问题进行只读诊断：${bound(question, 180)}`;
  if (previousMissingInfo.length === 0) {
    return base;
  }
  return `${base}。继续补齐上一轮缺失证据：${previousMissingInfo.map((item) => bound(item, 80)).join('、')}`;
}

function bound(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

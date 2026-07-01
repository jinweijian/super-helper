import type { AnswerGoal, ResolvedTurnContext } from '../domain.js';

export const DIRECT_ANSWER_ITEM = 'direct_answer';

export function buildAnswerGoal(input: {
  rawUserQuestion: string;
  resolvedTurn: ResolvedTurnContext;
  diagnosticObjective?: string;
}): AnswerGoal {
  const rawUserQuestion = bound(input.rawUserQuestion.trim(), 1600);
  const resolvedQuestion = bound(input.resolvedTurn.resolvedQuery.trim() || rawUserQuestion, 2000);
  const answerObject = inferAnswerObject(resolvedQuestion);
  return {
    rawUserQuestion,
    resolvedQuestion,
    answerObject,
    mustAnswerItems: [DIRECT_ANSWER_ITEM],
    diagnosticObjective: bound(input.diagnosticObjective?.trim() || `围绕用户真实问题进行只读诊断：${resolvedQuestion}`, 2000),
    sourceMessageIds: [...input.resolvedTurn.sourceMessageIds],
  };
}

export function followUpAnswerGoal(input: {
  previous: AnswerGoal;
  diagnosticObjective: string;
}): AnswerGoal {
  return {
    ...input.previous,
    diagnosticObjective: bound(input.diagnosticObjective.trim(), 2000),
    sourceMessageIds: [...input.previous.sourceMessageIds],
  };
}

function inferAnswerObject(question: string): string {
  const pathMatch = question.match(/(?:^|[\s"'“”‘’（(])((?:[.\w-]+\/)+[.\w-]+|[.\w-]+\.(?:json|ya?ml|ts|tsx|js|jsx|php|twig|md|sql))(?:$|[\s"'“”‘’）),，。])/i);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }
  const trimmed = question.replace(/[？?。！!，,\s]+$/g, '').trim();
  return bound(trimmed || '当前问题', 80);
}

function bound(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

import type { DiagnosticResult } from '../domain.js';
import type { FileMemoryStore, StoredCase } from '../storage.js';

export interface ExperienceMatch {
  sourceCaseId: string;
  sourceMessageId: string;
  sourceReplyId: string;
  question: string;
  reply: string;
  score: number;
  result: DiagnosticResult;
}

export function findExperienceMatch(input: {
  store: FileMemoryStore;
  currentCase: StoredCase;
  userMessage: string;
}): ExperienceMatch | undefined {
  const normalized = normalizeQuestion(input.userMessage);
  if (normalized.length < 6) {
    return undefined;
  }

  const candidates = input.store
    .listCases(200)
    .filter((caseSession) => caseSession.id !== input.currentCase.id)
    .filter((caseSession) => caseSession.workspaceId === input.currentCase.workspaceId)
    .flatMap((caseSession) => pairsFromCase(caseSession, normalized));

  return candidates.sort((a, b) => b.score - a.score)[0];
}

function pairsFromCase(caseSession: StoredCase, normalizedQuestion: string): ExperienceMatch[] {
  const matches: ExperienceMatch[] = [];
  const latestResult = [...caseSession.runs].reverse().find((run) => run.result)?.result;
  const reusable = caseSession.status === 'concluded' || latestResult?.recommendedNextAction === 'final_answer';
  if (!reusable) {
    return matches;
  }

  for (let index = 0; index < caseSession.messages.length; index += 1) {
    const message = caseSession.messages[index];
    if (message.role !== 'user') {
      continue;
    }
    const score = similarity(normalizedQuestion, normalizeQuestion(message.body));
    if (score < 0.92) {
      continue;
    }
    const reply = caseSession.messages.slice(index + 1).find((item) => item.role === 'helper');
    if (!reply) {
      continue;
    }
    const evidence = latestResult?.evidence ?? [];
    matches.push({
      sourceCaseId: caseSession.id,
      sourceMessageId: message.id,
      sourceReplyId: reply.id,
      question: message.body,
      reply: reply.body,
      score,
      result: {
        status: 'concluded',
        summary: `历史经验命中：${reply.body.slice(0, 240)}`,
        missingInfo: [],
        evidence: [
          {
            id: 'ev_history_match',
            kind: 'history',
            source: `${caseSession.id}/${message.id}`,
            summary: `历史会话中存在相同问题的已回复答案。匹配分：${score.toFixed(2)}。原问题：${message.body}`,
            confidence: score >= 0.98 ? 'high' : 'medium',
          },
          ...evidence.slice(0, 3),
        ],
        claims: [
          {
            type: 'fact',
            text: `历史会话 ${caseSession.id} 已经回答过高度相同的问题，可作为本次回复的历史证据。`,
            evidenceIds: ['ev_history_match'],
          },
          {
            type: 'inference',
            text: reply.body,
            evidenceIds: ['ev_history_match'],
          },
        ],
        recommendedNextAction: 'final_answer',
      },
    });
  }
  return matches;
}

function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[，。！？、,.!?;:：；"'`~\s]/g, '')
    .trim();
}

function similarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const aSet = bigrams(a);
  const bSet = bigrams(b);
  const intersection = [...aSet].filter((item) => bSet.has(item)).length;
  const union = new Set([...aSet, ...bSet]).size || 1;
  return intersection / union;
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) {
    return new Set([value]);
  }
  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2));
  }
  return grams;
}

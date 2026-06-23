import type { RetrievalCandidate, RetrievalStrategyScore } from './types.js';

export function dedupeRetrievalCandidatesByParent(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const byParent = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    const key = candidate.parentId ?? candidate.documentId;
    const existing = byParent.get(key);
    if (!existing) {
      byParent.set(key, {
        ...candidate,
        metadata: {
          ...(candidate.metadata ?? {}),
          childHits: [candidate.chunkId ?? candidate.id],
        },
      });
      continue;
    }
    const preferred = answerStrength(candidate) > answerStrength(existing) ? candidate : existing;
    byParent.set(key, {
      ...existing,
      excerpt: preferred.excerpt ?? existing.excerpt,
      answerSpan: preferred.answerSpan ?? existing.answerSpan,
      matchedTerms: Array.from(new Set([...(existing.matchedTerms ?? []), ...(candidate.matchedTerms ?? [])])),
      score: Math.max(existing.score, candidate.score),
      finalScore: Math.max(existing.finalScore ?? existing.score, candidate.finalScore ?? candidate.score),
      rerankScore: maxDefined(existing.rerankScore, candidate.rerankScore),
      strategyScores: mergeStrategyScores(existing.strategyScores, candidate.strategyScores),
      groundingIssues: Array.from(new Set([...(existing.groundingIssues ?? []), ...(candidate.groundingIssues ?? [])])),
      metadata: {
        ...(existing.metadata ?? {}),
        childHits: Array.from(new Set([
          ...childHits(existing),
          candidate.chunkId ?? candidate.id,
        ])),
      },
    });
  }
  return Array.from(byParent.values());
}

function answerStrength(candidate: RetrievalCandidate): number {
  return (candidate.answerSpan ? 100 : 0) + (candidate.matchedTerms ?? []).filter((term) => term.length >= 2).length;
}

function childHits(candidate: RetrievalCandidate): string[] {
  const value = candidate.metadata?.childHits;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [candidate.chunkId ?? candidate.id];
}

function mergeStrategyScores(
  left: RetrievalStrategyScore[] | undefined,
  right: RetrievalStrategyScore[] | undefined,
): RetrievalStrategyScore[] {
  const scores = new Map<string, RetrievalStrategyScore>();
  for (const item of [...(left ?? []), ...(right ?? [])]) {
    const existing = scores.get(item.strategyId);
    if (!existing || item.score > existing.score) scores.set(item.strategyId, item);
  }
  return Array.from(scores.values());
}

function maxDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

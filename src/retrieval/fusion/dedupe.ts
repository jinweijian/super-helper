import type { RetrievalCandidate } from '../types.js';

export function candidateDedupeKey(candidate: RetrievalCandidate): string {
  return candidate.chunkId ?? candidate.id ?? candidate.documentId;
}

export function mergeCandidate(left: RetrievalCandidate, right: RetrievalCandidate): RetrievalCandidate {
  return {
    ...left,
    score: Math.max(left.score, right.score),
    finalScore: Math.max(left.finalScore ?? left.score, right.finalScore ?? right.score),
    matchedTerms: Array.from(new Set([...(left.matchedTerms ?? []), ...(right.matchedTerms ?? [])])),
    strategyScores: [
      ...(left.strategyScores ?? []),
      ...(right.strategyScores ?? []),
    ],
    metadata: {
      ...(left.metadata ?? {}),
      ...(right.metadata ?? {}),
    },
  };
}

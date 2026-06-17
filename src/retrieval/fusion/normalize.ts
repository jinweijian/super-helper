import type { RetrievalCandidate } from '../types.js';

export function normalizeStrategyCandidates(input: {
  strategyId: string;
  candidates: RetrievalCandidate[];
}): RetrievalCandidate[] {
  return input.candidates.map((candidate, index) => ({
    ...candidate,
    id: candidate.id || candidate.chunkId || candidate.documentId,
    finalScore: candidate.finalScore ?? candidate.score,
    strategyScores: [
      ...(candidate.strategyScores ?? []),
      {
        strategyId: input.strategyId,
        score: candidate.score,
        rank: index + 1,
      },
    ],
  }));
}

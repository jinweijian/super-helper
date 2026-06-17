import type { RetrievalCandidate } from '../types.js';
import { candidateDedupeKey, mergeCandidate } from './dedupe.js';

export interface RrfFusionResult {
  candidates: RetrievalCandidate[];
  inputCount: number;
  dedupedCount: number;
}

export function fuseWithRrf(candidates: RetrievalCandidate[], k = 60): RrfFusionResult {
  const byKey = new Map<string, { candidate: RetrievalCandidate; firstSeen: number; rrfScore: number }>();
  candidates.forEach((candidate, index) => {
    const key = candidateDedupeKey(candidate);
    const contribution = (candidate.strategyScores ?? [])
      .reduce((sum, item) => sum + 1 / (k + item.rank), 0);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        candidate,
        firstSeen: index,
        rrfScore: contribution,
      });
      return;
    }
    byKey.set(key, {
      candidate: mergeCandidate(existing.candidate, candidate),
      firstSeen: existing.firstSeen,
      rrfScore: existing.rrfScore + contribution,
    });
  });

  return {
    inputCount: candidates.length,
    dedupedCount: candidates.length - byKey.size,
    candidates: Array.from(byKey.values())
      .map((entry) => ({
        ...entry.candidate,
        finalScore: Number(entry.rrfScore.toFixed(8)),
      }))
      .sort((left, right) => {
        const score = (right.finalScore ?? 0) - (left.finalScore ?? 0);
        if (score !== 0) {
          return score;
        }
        return (byKey.get(candidateDedupeKey(left))?.firstSeen ?? 0) - (byKey.get(candidateDedupeKey(right))?.firstSeen ?? 0);
      }),
  };
}

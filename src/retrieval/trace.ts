import type { RetrievalTrace } from './types.js';

export function createEmptyRetrievalTrace(): RetrievalTrace {
  return {
    strategies: [],
    fusion: {
      method: 'none',
      inputCount: 0,
      dedupedCount: 0,
      finalCandidateCount: 0,
    },
    rerank: {
      status: 'skipped',
      reason: 'not configured',
    },
  };
}

import { retrievalCandidatesToEvidencePack } from './evidence-pack.js';
import { redactProviderErrorMessage } from '../providers/redaction.js';
import { fuseWithRrf } from './fusion/rrf.js';
import { normalizeStrategyCandidates } from './fusion/normalize.js';
import type { RecallStrategy } from './recall/contract.js';
import type { RetrievalReranker } from './rerank/service.js';
import { createEmptyRetrievalTrace } from './trace.js';
import type {
  RetrievalCandidate,
  RetrievalInput,
  RetrievalResult,
} from './types.js';

export interface RetrievalService {
  retrieve(input: RetrievalInput): Promise<RetrievalResult>;
}

export function createRetrievalService(input: {
  strategies: RecallStrategy[];
  reranker?: RetrievalReranker;
  rerankerUnavailableReason?: string;
}): RetrievalService {
  return {
    async retrieve(request) {
      const limit = request.limit ?? 8;
      const trace = createEmptyRetrievalTrace();
      const recalled: RetrievalCandidate[] = [];
      const filteredOut: Array<{ reason: string; count: number }> = [];

      for (const strategy of input.strategies) {
        const enabled = normalizeEnabledResult(strategy.enabled({ workspaceRoot: request.workspaceRoot }));
        if (!enabled.enabled) {
          trace.strategies.push({
            id: strategy.id,
            kind: strategy.kind,
            status: 'skipped',
            candidateCount: 0,
            reason: enabled.reason ?? 'disabled',
          });
          continue;
        }
        try {
          const result = await strategy.recall({ ...request, limit });
          const normalized = normalizeStrategyCandidates({
            strategyId: strategy.id,
            candidates: result.candidates,
          });
          recalled.push(...normalized);
          trace.strategies.push({
            id: strategy.id,
            kind: strategy.kind,
            status: 'ran',
            candidateCount: normalized.length,
          });
        } catch (error) {
          const reason = redactProviderErrorMessage(error);
          filteredOut.push({ reason: `${strategy.id}_failed`, count: 1 });
          trace.strategies.push({
            id: strategy.id,
            kind: strategy.kind,
            status: 'failed',
            candidateCount: 0,
            reason,
          });
        }
      }

      const fused = fuseWithRrf(recalled);
      trace.fusion = {
        method: 'rrf',
        inputCount: fused.inputCount,
        dedupedCount: fused.dedupedCount,
        finalCandidateCount: fused.candidates.length,
      };

      let candidates = fused.candidates;
      if (input.reranker && candidates.length > 0) {
        try {
          trace.rerank = {
            status: 'ran',
            inputCount: candidates.length,
          };
          const reranked = await input.reranker.rerank({
            query: request.query,
            candidates,
            limit,
          });
          candidates = reranked.candidates;
          trace.rerank.outputCount = candidates.length;
        } catch (error) {
          trace.rerank = {
            status: 'failed',
            reason: redactProviderErrorMessage(error),
            inputCount: candidates.length,
            outputCount: candidates.length,
          };
        }
      } else {
        trace.rerank = {
          status: 'skipped',
          reason: input.reranker ? 'no candidates' : input.rerankerUnavailableReason ?? 'not configured',
          inputCount: candidates.length,
          outputCount: candidates.length,
        };
      }

      const finalCandidates = candidates.slice(0, limit);
      trace.fusion.finalCandidateCount = finalCandidates.length;
      return {
        query: request.query,
        candidates: finalCandidates,
        trace,
        evidence: retrievalCandidatesToEvidencePack({
          request,
          candidates: finalCandidates,
          filteredOut,
        }),
      };
    },
  };
}

function normalizeEnabledResult(value: boolean | { enabled: boolean; reason?: string }): { enabled: boolean; reason?: string } {
  return typeof value === 'boolean' ? { enabled: value } : value;
}

import type { EmbeddingProviderConfig } from '../../../providers/embedding/contract.js';
import type { RecallInput, RecallStrategy } from '../contract.js';
import { searchVectorArtifacts } from './vector-search.js';

export function createEmbeddingRecallStrategy(input: {
  provider?: {
    embedQuery(input: { id?: string; text: string; metadata?: Record<string, unknown> }): Promise<{ vector: number[] }>;
  };
  embeddingConfig?: Pick<EmbeddingProviderConfig, 'enabled'>;
} = {}): RecallStrategy {
  return {
    id: 'embedding',
    kind: 'semantic',
    enabled: () => {
      if (!input.provider) {
        return { enabled: false, reason: 'embedding provider not configured' };
      }
      if (input.embeddingConfig && input.embeddingConfig.enabled === false) {
        return { enabled: false, reason: 'embedding disabled' };
      }
      return { enabled: true };
    },
    async recall(recallInput: RecallInput) {
      if (!input.provider) {
        return { candidates: [] };
      }
      const queryVector = await input.provider.embedQuery({ text: recallInput.query });
      return {
        candidates: searchVectorArtifacts({
          workspaceRoot: recallInput.workspaceRoot,
          queryVector: queryVector.vector,
          limit: recallInput.limit,
        }),
      };
    },
  };
}

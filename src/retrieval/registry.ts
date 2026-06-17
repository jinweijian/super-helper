import type { EmbeddingProviderConfig } from '../providers/embedding/contract.js';
import { createBm25RecallStrategy } from './recall/bm25/strategy.js';
import { createEmbeddingRecallStrategy } from './recall/embedding/strategy.js';
import { createKeywordRecallStrategy } from './recall/keyword/strategy.js';
import type { RecallStrategy } from './recall/contract.js';

export interface RetrievalRegistryOptions {
  embeddingProvider?: {
    embedQuery(input: { id?: string; text: string; metadata?: Record<string, unknown> }): Promise<{ vector: number[] }>;
  };
  embeddingConfig?: Pick<EmbeddingProviderConfig, 'enabled'>;
  includeKeywordCompatibility?: boolean;
}

export function createDefaultRetrievalStrategies(options: RetrievalRegistryOptions = {}): RecallStrategy[] {
  return [
    createBm25RecallStrategy(),
    createEmbeddingRecallStrategy({
      provider: options.embeddingProvider,
      embeddingConfig: options.embeddingConfig,
    }),
    ...(options.includeKeywordCompatibility ? [createKeywordRecallStrategy()] : []),
  ];
}

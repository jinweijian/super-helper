import type { SuperHelperConfig } from '../config.js';
import { searchKnowledge } from '../knowledge/index.js';
import type { KnowledgeEvidencePack, KnowledgeSearchQuery } from '../knowledge/types.js';
import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import { createRerankProvider } from '../providers/rerank/factory.js';
import { searchKnowledgeWithRag } from './legacy-rag.js';

export async function searchKnowledgeWithConfiguredRetrieval(input: {
  config: SuperHelperConfig;
  query: KnowledgeSearchQuery;
}): Promise<KnowledgeEvidencePack> {
  const embedding = createConfiguredEmbeddingProvider(input.config);
  const rerank = createConfiguredRerankProvider(input.config);
  if (!embedding && !rerank) {
    return searchKnowledge(input.query);
  }
  return searchKnowledgeWithRag({
    ...input.query,
    embedding: embedding ? { provider: embedding } : undefined,
    rerank: rerank ? { provider: rerank, topN: input.config.rerank?.topN } : undefined,
  });
}

function createConfiguredEmbeddingProvider(config: SuperHelperConfig) {
  if (config.embedding?.enabled !== true) {
    return undefined;
  }
  try {
    return createEmbeddingProvider(config.embedding);
  } catch {
    return undefined;
  }
}

function createConfiguredRerankProvider(config: SuperHelperConfig) {
  if (config.rerank?.enabled !== true) {
    return undefined;
  }
  try {
    return createRerankProvider(config.rerank);
  } catch {
    return undefined;
  }
}

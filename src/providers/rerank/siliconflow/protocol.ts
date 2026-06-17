import { EmbeddingProviderError } from '../../errors.js';
import { isProviderObject } from '../../http.js';
import type {
  RerankDocumentResult,
  RerankRequestInput,
} from '../contract.js';

export function buildSiliconFlowRerankRequest(input: RerankRequestInput, model: string, defaultTopN?: number): Record<string, unknown> {
  return {
    model,
    query: input.query,
    documents: input.documents.map((document) => document.text),
    top_n: input.topN ?? defaultTopN ?? input.documents.length,
    return_documents: false,
  };
}

export function mapSiliconFlowRerankResponse(value: unknown, input: RerankRequestInput): RerankDocumentResult[] {
  if (!isProviderObject(value) || !Array.isArray(value.results)) {
    throw new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'malformed_response',
      retryable: false,
      safeMessage: 'SiliconFlow rerank response did not include results[].relevance_score.',
    });
  }
  return value.results.map((item) => {
    if (!isProviderObject(item) || typeof item.index !== 'number' || typeof item.relevance_score !== 'number') {
      throw new EmbeddingProviderError({
        provider: 'siliconflow',
        code: 'malformed_response',
        retryable: false,
        safeMessage: 'SiliconFlow rerank result did not include index and relevance_score.',
      });
    }
    const document = input.documents[item.index];
    if (!document) {
      throw new EmbeddingProviderError({
        provider: 'siliconflow',
        code: 'malformed_response',
        retryable: false,
        safeMessage: 'SiliconFlow rerank result referenced an unknown document index.',
      });
    }
    return { id: document.id, index: item.index, score: item.relevance_score };
  });
}

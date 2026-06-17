import type { EmbeddingProviderConfig } from '../contract.js';
import { joinProviderEndpoint } from '../../http.js';

export const SILICONFLOW_EMBEDDING_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';

export function resolveSiliconFlowEmbeddingEndpoint(config: EmbeddingProviderConfig): string {
  if (config.endpoint) {
    return config.endpoint;
  }
  return joinProviderEndpoint(config.baseUrl, SILICONFLOW_EMBEDDING_DEFAULT_BASE_URL, 'embeddings');
}

import { joinProviderEndpoint } from '../../http.js';
import type { RerankProviderConfig } from '../contract.js';

export const SILICONFLOW_RERANK_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';

export function resolveSiliconFlowRerankEndpoint(config: RerankProviderConfig): string {
  if (config.endpoint) {
    return config.endpoint;
  }
  return joinProviderEndpoint(config.baseUrl, SILICONFLOW_RERANK_DEFAULT_BASE_URL, 'rerank');
}

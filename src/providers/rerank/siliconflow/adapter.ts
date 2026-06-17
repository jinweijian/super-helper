import { EmbeddingProviderError, isEmbeddingProviderError, redactEmbeddingErrorMessage } from '../../errors.js';
import {
  isAbortError,
  parseJsonBody,
  parseJsonBodyIfPossible,
  providerStatusError,
  resolveApiKey,
  type ProviderFetch,
  type ProviderRequestOptions,
} from '../../http.js';
import type {
  RerankBatchResult,
  RerankProvider,
  RerankProviderConfig,
  RerankRequestInput,
} from '../contract.js';
import { resolveSiliconFlowRerankEndpoint } from './endpoint.js';
import {
  buildSiliconFlowRerankRequest,
  mapSiliconFlowRerankResponse,
} from './protocol.js';

export class SiliconFlowRerankProvider implements RerankProvider {
  readonly id = 'siliconflow';
  readonly model: string;

  constructor(
    private readonly config: RerankProviderConfig,
    private readonly fetchImpl: ProviderFetch,
  ) {
    this.model = config.model;
  }

  async rerank(input: RerankRequestInput, options: ProviderRequestOptions = {}): Promise<RerankBatchResult> {
    const apiKey = resolveApiKey(this.config);
    if (!apiKey) {
      throw new EmbeddingProviderError({
        provider: this.id,
        code: 'missing_credentials',
        retryable: false,
        safeMessage: 'SiliconFlow API key is required for rerank.',
      });
    }
    if (input.documents.length === 0) {
      return { provider: this.id, model: this.model, results: [], warnings: [] };
    }

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.fetchImpl(resolveSiliconFlowRerankEndpoint(this.config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildSiliconFlowRerankRequest(input, this.config.model, this.config.topN)),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw providerStatusError({
          provider: this.id,
          status: response.status,
          parsed: parseJsonBodyIfPossible(bodyText),
          bodyText,
          operation: 'rerank',
        });
      }
      return {
        provider: this.id,
        model: this.model,
        results: mapSiliconFlowRerankResponse(parseJsonBody(bodyText, {
          provider: this.id,
          safeMessage: 'SiliconFlow rerank response body was not valid JSON.',
        }), input),
        warnings: [],
      };
    } catch (error) {
      if (isEmbeddingProviderError(error)) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new EmbeddingProviderError({
          provider: this.id,
          code: 'timeout',
          retryable: true,
          safeMessage: `SiliconFlow rerank request timed out after ${timeoutMs}ms.`,
          cause: error,
        });
      }
      throw new EmbeddingProviderError({
        provider: this.id,
        code: 'network_error',
        retryable: true,
        safeMessage: `SiliconFlow rerank network error: ${redactEmbeddingErrorMessage(error)}`,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

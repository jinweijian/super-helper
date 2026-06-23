import { ProviderError, isProviderError } from '../../errors.js';
import {
  isAbortError,
  isProviderObject,
  parseJsonBody,
  parseJsonBodyIfPossible,
  providerStatusError,
  resolveApiKey,
} from '../../http.js';
import { redactProviderErrorMessage } from '../../redaction.js';
import type {
  EmbeddingBatchResult,
  EmbeddingDistanceMetric,
  EmbeddingDocumentInput,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderFactoryOptions,
  EmbeddingQueryInput,
  EmbeddingRequestOptions,
  EmbeddingUsage,
  EmbeddingVectorResult,
} from '../contract.js';
import { resolveSiliconFlowEmbeddingEndpoint } from './endpoint.js';
import {
  buildSiliconFlowEmbeddingRequest,
  mapSiliconFlowEmbeddingResponse,
  parseSiliconFlowEmbeddingResponse,
  type SiliconFlowEmbeddingResponse,
} from './protocol.js';

export class SiliconFlowEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'siliconflow';
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: EmbeddingProviderConfig,
    options: EmbeddingProviderFactoryOptions = {},
  ) {
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.distance = config.distance as EmbeddingDistanceMetric;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async embedDocuments(
    input: EmbeddingDocumentInput[],
    options: EmbeddingRequestOptions = {},
  ): Promise<EmbeddingBatchResult> {
    if (input.length === 0) {
      return {
        provider: this.id,
        model: this.model,
        dimensions: this.dimensions,
        distance: this.distance,
        results: [],
        usage: { providerRequestCount: 0, inputTokens: 0, totalTokens: 0 },
        warnings: [],
      };
    }

    const batchSize = Math.max(1, Math.floor(options.batchSize ?? this.config.batchSize ?? 16));
    const results: EmbeddingVectorResult[] = [];
    const usage: EmbeddingUsage = { providerRequestCount: 0, inputTokens: 0, totalTokens: 0 };
    for (let offset = 0; offset < input.length; offset += batchSize) {
      const batch = input.slice(offset, offset + batchSize);
      const response = await this.requestEmbeddings(batch.map((item) => item.text), options);
      results.push(...mapSiliconFlowEmbeddingResponse({
        response,
        model: this.model,
        dimensions: this.dimensions,
        distance: this.distance,
        ids: batch.map((item) => item.id),
        contentHashes: batch.map((item) => item.contentHash),
        metadatas: batch.map((item) => item.metadata),
      }));
      usage.providerRequestCount = (usage.providerRequestCount ?? 0) + 1;
      usage.inputTokens = (usage.inputTokens ?? 0) + (response.usage?.promptTokens ?? 0);
      usage.totalTokens = (usage.totalTokens ?? 0) + (response.usage?.totalTokens ?? 0);
    }

    return {
      provider: this.id,
      model: this.model,
      dimensions: this.dimensions,
      distance: this.distance,
      results,
      usage,
      warnings: [],
    };
  }

  async embedQuery(
    input: EmbeddingQueryInput,
    options: EmbeddingRequestOptions = {},
  ): Promise<EmbeddingVectorResult> {
    const response = await this.requestEmbeddings(input.text, options);
    const [result] = mapSiliconFlowEmbeddingResponse({
      response,
      model: this.model,
      dimensions: this.dimensions,
      distance: this.distance,
      ids: [input.id ?? 'query'],
      contentHashes: [undefined],
      metadatas: [input.metadata],
    });
    if (!result) {
      throw new ProviderError({
        provider: this.id,
        code: 'malformed_response',
        retryable: false,
        safeMessage: 'SiliconFlow embedding response did not include a query vector.',
      });
    }
    return result;
  }

  private async requestEmbeddings(
    input: string | string[],
    options: EmbeddingRequestOptions,
  ): Promise<SiliconFlowEmbeddingResponse> {
    const apiKey = resolveApiKey(this.config);
    if (!apiKey) {
      throw new ProviderError({
        provider: this.id,
        code: 'missing_credentials',
        retryable: false,
        safeMessage: 'SiliconFlow API key is required. Configure embedding.apiKeyEnv or embedding.apiKey.',
      });
    }

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.fetchImpl(resolveSiliconFlowEmbeddingEndpoint(this.config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildSiliconFlowEmbeddingRequest(this.config, input)),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw providerStatusError({
          provider: this.id,
          status: response.status,
          parsed: parseJsonBodyIfPossible(bodyText),
          bodyText,
          operation: 'embedding',
        });
      }
      const parsed = parseJsonBody(bodyText, {
        provider: this.id,
        safeMessage: 'SiliconFlow response body was not valid JSON.',
      });
      if (!isProviderObject(parsed)) {
        throw new ProviderError({
          provider: this.id,
          code: 'malformed_response',
          retryable: false,
          safeMessage: 'SiliconFlow embedding response was not a JSON object.',
        });
      }
      return parseSiliconFlowEmbeddingResponse(parsed);
    } catch (error) {
      if (isProviderError(error)) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new ProviderError({
          provider: this.id,
          code: 'timeout',
          retryable: true,
          safeMessage: `SiliconFlow embedding request timed out after ${timeoutMs}ms.`,
          cause: error,
        });
      }
      throw new ProviderError({
        provider: this.id,
        code: 'network_error',
        retryable: true,
        safeMessage: `SiliconFlow embedding network error: ${redactProviderErrorMessage(error)}`,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

import { EmbeddingProviderError, isEmbeddingProviderError, redactEmbeddingErrorMessage } from './errors.js';
import type {
  EmbeddingBatchResult,
  EmbeddingDistanceMetric,
  EmbeddingDocumentInput,
  EmbeddingFetch,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderFactoryOptions,
  EmbeddingQueryInput,
  EmbeddingRequestOptions,
  EmbeddingUsage,
  EmbeddingVectorResult,
} from './types.js';

interface SiliconFlowEmbeddingResponse {
  model?: string;
  data?: Array<{
    index?: number;
    embedding?: unknown;
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export class SiliconFlowEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'siliconflow';
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;
  private readonly config: EmbeddingProviderConfig;
  private readonly fetchImpl: EmbeddingFetch;

  constructor(config: EmbeddingProviderConfig, options: EmbeddingProviderFactoryOptions = {}) {
    this.config = config;
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
      const mapped = mapResponseVectors({
        response,
        provider: this.id,
        model: this.model,
        dimensions: this.dimensions,
        distance: this.distance,
        ids: batch.map((item) => item.id),
        contentHashes: batch.map((item) => item.contentHash),
        metadatas: batch.map((item) => item.metadata),
      });
      results.push(...mapped);
      usage.providerRequestCount = (usage.providerRequestCount ?? 0) + 1;
      usage.inputTokens = (usage.inputTokens ?? 0) + (response.usage?.prompt_tokens ?? 0);
      usage.totalTokens = (usage.totalTokens ?? 0) + (response.usage?.total_tokens ?? 0);
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
    const [result] = mapResponseVectors({
      response,
      provider: this.id,
      model: this.model,
      dimensions: this.dimensions,
      distance: this.distance,
      ids: [input.id ?? 'query'],
      contentHashes: [undefined],
      metadatas: [input.metadata],
    });
    if (!result) {
      throw new EmbeddingProviderError({
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
    const apiKey = resolveProviderSecret(this.config);
    if (!apiKey) {
      throw new EmbeddingProviderError({
        provider: this.id,
        code: 'missing_credentials',
        retryable: false,
        safeMessage: 'SiliconFlow API key is required. Configure embedding.apiKeyEnv or embedding.apiKey.',
      });
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.fetchImpl(resolveEmbeddingsEndpoint(this.config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildRequestBody(this.config, input)),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw providerStatusError(response.status, parseJsonBodyIfPossible(bodyText), bodyText);
      }

      const parsed = parseJsonBody(bodyText);
      if (!isObject(parsed)) {
        throw new EmbeddingProviderError({
          provider: this.id,
          code: 'malformed_response',
          retryable: false,
          safeMessage: 'SiliconFlow embedding response was not a JSON object.',
        });
      }
      return parsed as SiliconFlowEmbeddingResponse;
    } catch (error) {
      if (isEmbeddingProviderError(error)) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new EmbeddingProviderError({
          provider: this.id,
          code: 'timeout',
          retryable: true,
          safeMessage: `SiliconFlow embedding request timed out after ${timeoutMs}ms.`,
          cause: error,
        });
      }
      throw new EmbeddingProviderError({
        provider: this.id,
        code: 'network_error',
        retryable: true,
        safeMessage: `SiliconFlow embedding network error: ${redactEmbeddingErrorMessage(error)}`,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function buildRequestBody(config: EmbeddingProviderConfig, input: string | string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    input,
    encoding_format: 'float',
  };
  if (Number.isInteger(config.dimensions) && config.dimensions > 0) {
    body.dimensions = config.dimensions;
  }
  if (config.extra && typeof config.extra.user === 'string') {
    body.user = config.extra.user;
  }
  if (config.extra && (config.extra.truncate === 'left' || config.extra.truncate === 'right')) {
    body.truncate = config.extra.truncate;
  }
  return body;
}

function resolveProviderSecret(config: EmbeddingProviderConfig): string | undefined {
  if (config.apiKey) {
    return config.apiKey;
  }
  if (config.apiKeyEnv) {
    return process.env[config.apiKeyEnv];
  }
  return undefined;
}

function resolveEmbeddingsEndpoint(config: EmbeddingProviderConfig): string {
  if (config.endpoint) {
    return config.endpoint;
  }
  const baseUrl = (config.baseUrl ?? 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  return `${baseUrl}/embeddings`;
}

function mapResponseVectors(input: {
  response: SiliconFlowEmbeddingResponse;
  provider: 'siliconflow';
  model: string;
  dimensions: number;
  distance: EmbeddingDistanceMetric;
  ids: string[];
  contentHashes: Array<string | undefined>;
  metadatas: Array<Record<string, unknown> | undefined>;
}): EmbeddingVectorResult[] {
  if (!Array.isArray(input.response.data)) {
    throw new EmbeddingProviderError({
      provider: input.provider,
      code: 'malformed_response',
      retryable: false,
      safeMessage: 'SiliconFlow embedding response did not include data[].',
    });
  }

  if (input.response.data.length !== input.ids.length) {
    throw new EmbeddingProviderError({
      provider: input.provider,
      code: 'malformed_response',
      retryable: false,
      safeMessage: `SiliconFlow embedding response returned ${input.response.data.length} vectors for ${input.ids.length} inputs.`,
    });
  }

  const seenIndexes = new Set<number>();
  return input.response.data
    .slice()
    .sort((a, b) => numericIndex(a.index, 0) - numericIndex(b.index, 0))
    .map((item, outputIndex) => {
      if (!Array.isArray(item.embedding) || !item.embedding.every((value) => typeof value === 'number')) {
        throw new EmbeddingProviderError({
          provider: input.provider,
          code: 'malformed_response',
          retryable: false,
          safeMessage: 'SiliconFlow embedding response contained a missing or invalid vector.',
        });
      }
      if (item.embedding.length !== input.dimensions) {
        throw new EmbeddingProviderError({
          provider: input.provider,
          code: 'dimension_mismatch',
          retryable: false,
          safeMessage: `SiliconFlow embedding dimensions mismatch for ${input.model}: expected ${input.dimensions}, got ${item.embedding.length}.`,
        });
      }
      if (item.index !== undefined && !Number.isInteger(item.index)) {
        throw new EmbeddingProviderError({
          provider: input.provider,
          code: 'malformed_response',
          retryable: false,
          safeMessage: 'SiliconFlow embedding response contained a non-integer data[].index.',
        });
      }
      const sourceIndex = numericIndex(item.index, outputIndex);
      if (sourceIndex < 0 || sourceIndex >= input.ids.length || seenIndexes.has(sourceIndex)) {
        throw new EmbeddingProviderError({
          provider: input.provider,
          code: 'malformed_response',
          retryable: false,
          safeMessage: 'SiliconFlow embedding response contained an invalid or duplicate data[].index.',
        });
      }
      seenIndexes.add(sourceIndex);
      return {
        id: input.ids[sourceIndex] ?? input.ids[outputIndex] ?? String(outputIndex),
        provider: input.provider,
        model: input.response.model ?? input.model,
        dimensions: input.dimensions,
        distance: input.distance,
        vector: item.embedding,
        usage: {
          providerRequestCount: 1,
          inputTokens: input.response.usage?.prompt_tokens,
          totalTokens: input.response.usage?.total_tokens,
        },
        contentHash: input.contentHashes[sourceIndex] ?? input.contentHashes[outputIndex],
        metadata: input.metadatas[sourceIndex] ?? input.metadatas[outputIndex],
      };
    });
}

function numericIndex(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function parseJsonBody(bodyText: string): unknown {
  if (!bodyText.trim()) {
    return {};
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'malformed_response',
      retryable: false,
      safeMessage: 'SiliconFlow response body was not valid JSON.',
    });
  }
}

function parseJsonBodyIfPossible(bodyText: string): unknown {
  if (!bodyText.trim()) {
    return {};
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}

function providerStatusError(status: number, parsed: unknown, bodyText?: string): EmbeddingProviderError {
  const message = extractProviderMessage(parsed) ??
    (bodyText?.trim() ? bodyText.slice(0, 1000) : `SiliconFlow embedding request failed with status ${status}.`);
  if (status === 401 || status === 403) {
    return new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'missing_credentials',
      retryable: false,
      status,
      safeMessage: message,
    });
  }
  if (status === 429) {
    return new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'rate_limited',
      retryable: true,
      status,
      safeMessage: message,
    });
  }
  if (status >= 400 && status < 500) {
    return new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'invalid_request',
      retryable: false,
      status,
      safeMessage: message,
    });
  }
  return new EmbeddingProviderError({
    provider: 'siliconflow',
    code: 'provider_error',
    retryable: true,
    status,
    safeMessage: message,
  });
}

function extractProviderMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!isObject(value)) {
    return undefined;
  }
  if (typeof value.message === 'string') {
    return value.message;
  }
  if (typeof value.error === 'string') {
    return value.error;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

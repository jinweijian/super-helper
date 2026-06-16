import { EmbeddingProviderError, isEmbeddingProviderError, redactEmbeddingErrorMessage } from './errors.js';
import type {
  EmbeddingFetch,
  EmbeddingProviderFactoryOptions,
  EmbeddingRequestOptions,
  RerankBatchResult,
  RerankDocumentResult,
  RerankProvider,
  RerankProviderConfig,
  RerankRequestInput,
} from './types.js';

export function createRerankProvider(
  config: RerankProviderConfig,
  options: EmbeddingProviderFactoryOptions = {},
): RerankProvider {
  if (config.provider === 'siliconflow') {
    return new SiliconFlowRerankProvider(config, options.fetch ?? fetch);
  }
  if (config.provider === 'fake') {
    return new FakeRerankProvider(config);
  }
  throw new EmbeddingProviderError({
    provider: config.provider,
    code: 'unsupported_provider',
    retryable: false,
    safeMessage: `Unsupported rerank provider: ${config.provider}`,
  });
}

export class FakeRerankProvider implements RerankProvider {
  readonly id = 'fake';
  readonly model: string;

  constructor(private readonly config: RerankProviderConfig) {
    this.model = config.model;
  }

  async rerank(input: RerankRequestInput): Promise<RerankBatchResult> {
    const queryTerms = normalize(input.query).split('').filter(Boolean);
    const results = input.documents
      .map((document, index) => ({
        id: document.id,
        index,
        score: queryTerms.reduce((sum, term) => sum + (normalize(document.text).includes(term) ? 1 : 0), 0),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.topN ?? this.config.topN ?? input.documents.length);
    return {
      provider: this.id,
      model: this.model,
      results,
      warnings: [],
    };
  }
}

export class SiliconFlowRerankProvider implements RerankProvider {
  readonly id = 'siliconflow';
  readonly model: string;

  constructor(
    private readonly config: RerankProviderConfig,
    private readonly fetchImpl: EmbeddingFetch,
  ) {
    this.model = config.model;
  }

  async rerank(input: RerankRequestInput, options: EmbeddingRequestOptions = {}): Promise<RerankBatchResult> {
    const apiKey = resolveProviderSecret(this.config);
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
      const response = await this.fetchImpl(resolveRerankEndpoint(this.config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          query: input.query,
          documents: input.documents.map((document) => document.text),
          top_n: input.topN ?? this.config.topN ?? input.documents.length,
          return_documents: false,
        }),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw providerStatusError(response.status, parseJsonBodyIfPossible(bodyText), bodyText);
      }
      return {
        provider: this.id,
        model: this.model,
        results: mapRerankResponse(parseJsonBody(bodyText), input),
        warnings: [],
      };
    } catch (error) {
      if (isEmbeddingProviderError(error)) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
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

function mapRerankResponse(value: unknown, input: RerankRequestInput): RerankDocumentResult[] {
  if (!isObject(value) || !Array.isArray(value.results)) {
    throw new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'malformed_response',
      retryable: false,
      safeMessage: 'SiliconFlow rerank response did not include results[].relevance_score.',
    });
  }
  return value.results.map((item) => {
    if (!isObject(item) || typeof item.index !== 'number' || typeof item.relevance_score !== 'number') {
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

function resolveProviderSecret(config: RerankProviderConfig): string | undefined {
  if (config.apiKey) {
    return config.apiKey;
  }
  if (config.apiKeyEnv) {
    return process.env[config.apiKeyEnv];
  }
  return undefined;
}

function resolveRerankEndpoint(config: RerankProviderConfig): string {
  if (config.endpoint) {
    return config.endpoint;
  }
  const baseUrl = (config.baseUrl ?? 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  return `${baseUrl}/rerank`;
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
      safeMessage: 'SiliconFlow rerank response body was not valid JSON.',
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
    (bodyText?.trim() ? bodyText.slice(0, 1000) : `SiliconFlow rerank request failed with status ${status}.`);
  if (status === 401 || status === 403) {
    return new EmbeddingProviderError({ provider: 'siliconflow', code: 'missing_credentials', retryable: false, status, safeMessage: message });
  }
  if (status === 429) {
    return new EmbeddingProviderError({ provider: 'siliconflow', code: 'rate_limited', retryable: true, status, safeMessage: message });
  }
  if (status >= 400 && status < 500) {
    return new EmbeddingProviderError({ provider: 'siliconflow', code: 'invalid_request', retryable: false, status, safeMessage: message });
  }
  return new EmbeddingProviderError({ provider: 'siliconflow', code: 'provider_error', retryable: true, status, safeMessage: message });
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
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}

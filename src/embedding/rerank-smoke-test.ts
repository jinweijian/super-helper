import { EmbeddingProviderError, formatEmbeddingSafeError, isEmbeddingProviderError, redactEmbeddingErrorMessage } from './errors.js';
import type { EmbeddingFetch, RerankProviderConfig, RerankProviderHealthCheckResult } from './types.js';

export async function runRerankSmokeTest(input: {
  config: RerankProviderConfig;
  fetch?: EmbeddingFetch;
  force?: boolean;
}): Promise<RerankProviderHealthCheckResult> {
  const startedAt = Date.now();
  if (!input.config.enabled && !input.force) {
    return {
      provider: input.config.provider,
      model: input.config.model,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: {
        code: 'disabled',
        retryable: false,
        safeMessage: 'rerank disabled',
      },
    };
  }

  if (input.config.provider !== 'siliconflow') {
    return {
      provider: input.config.provider,
      model: input.config.model,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: {
        code: 'unsupported_provider',
        retryable: false,
        safeMessage: `Unsupported rerank provider: ${input.config.provider}`,
      },
    };
  }

  try {
    const topScore = await requestSiliconFlowRerank(input.config, input.fetch ?? fetch);
    return {
      provider: input.config.provider,
      model: input.config.model,
      ok: true,
      durationMs: Date.now() - startedAt,
      topScore,
    };
  } catch (error) {
    return {
      provider: input.config.provider,
      model: input.config.model,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: isEmbeddingProviderError(error)
        ? {
          code: error.code,
          status: error.status,
          retryable: error.retryable,
          safeMessage: error.safeMessage,
        }
        : {
          code: 'unknown',
          retryable: false,
          safeMessage: formatEmbeddingSafeError(error),
        },
    };
  }
}

async function requestSiliconFlowRerank(config: RerankProviderConfig, fetchImpl: EmbeddingFetch): Promise<number> {
  const apiKey = resolveProviderSecret(config);
  if (!apiKey) {
    throw new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'missing_credentials',
      retryable: false,
      safeMessage: 'SiliconFlow API key is required for rerank smoke test.',
    });
  }

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(resolveRerankEndpoint(config), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        query: 'super helper rerank smoke',
        documents: ['super helper rerank smoke', 'unrelated document'],
        top_n: config.topN ?? 2,
        return_documents: false,
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw providerStatusError(response.status, parseJsonBodyIfPossible(bodyText), bodyText);
    }
    const parsed = parseJsonBody(bodyText);
    const score = extractTopScore(parsed);
    if (score === undefined) {
      throw new EmbeddingProviderError({
        provider: 'siliconflow',
        code: 'malformed_response',
        retryable: false,
        safeMessage: 'SiliconFlow rerank response did not include results[].relevance_score.',
      });
    }
    return score;
  } catch (error) {
    if (isEmbeddingProviderError(error)) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new EmbeddingProviderError({
        provider: 'siliconflow',
        code: 'timeout',
        retryable: true,
        safeMessage: `SiliconFlow rerank request timed out after ${timeoutMs}ms.`,
        cause: error,
      });
    }
    throw new EmbeddingProviderError({
      provider: 'siliconflow',
      code: 'network_error',
      retryable: true,
      safeMessage: `SiliconFlow rerank network error: ${redactEmbeddingErrorMessage(error)}`,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
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

function extractTopScore(value: unknown): number | undefined {
  if (!isObject(value) || !Array.isArray(value.results)) {
    return undefined;
  }
  const first = value.results[0];
  if (!isObject(first) || typeof first.relevance_score !== 'number') {
    return undefined;
  }
  return first.relevance_score;
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

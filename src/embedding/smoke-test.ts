import { formatEmbeddingSafeError, isEmbeddingProviderError } from './errors.js';
import { createEmbeddingProvider } from './provider.js';
import type { EmbeddingFetch, EmbeddingProviderConfig, EmbeddingProviderHealthCheckResult } from './types.js';

export async function runEmbeddingSmokeTest(input: {
  config: EmbeddingProviderConfig;
  sampleText?: string;
  fetch?: EmbeddingFetch;
  force?: boolean;
}): Promise<EmbeddingProviderHealthCheckResult> {
  const startedAt = Date.now();
  if (!input.config.enabled && !input.force) {
    return {
      provider: input.config.provider as EmbeddingProviderHealthCheckResult['provider'],
      model: input.config.model,
      dimensions: input.config.dimensions,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: {
        code: 'disabled',
        retryable: false,
        safeMessage: 'embedding disabled',
      },
    };
  }

  try {
    const provider = createEmbeddingProvider(
      { ...input.config, enabled: true },
      { fetch: input.fetch },
    );
    const result = await provider.embedQuery({
      id: 'embedding_smoke',
      text: input.sampleText ?? 'super helper embedding smoke test',
    });
    return {
      provider: provider.id,
      model: provider.model,
      dimensions: result.vector.length,
      ok: result.vector.length === provider.dimensions,
      durationMs: Date.now() - startedAt,
      error: result.vector.length === provider.dimensions
        ? undefined
        : {
          code: 'dimension_mismatch',
          retryable: false,
          safeMessage: `expected ${provider.dimensions}, got ${result.vector.length}`,
        },
    };
  } catch (error) {
    return {
      provider: input.config.provider as EmbeddingProviderHealthCheckResult['provider'],
      model: input.config.model,
      dimensions: input.config.dimensions,
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

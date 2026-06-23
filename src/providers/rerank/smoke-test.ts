import { formatProviderSafeError, isProviderError } from '../errors.js';
import type { ProviderFetch } from '../http.js';
import type { RerankProviderConfig, RerankProviderHealthCheckResult } from './contract.js';
import { createRerankProvider } from './factory.js';

export async function runRerankSmokeTest(input: {
  config: RerankProviderConfig;
  fetch?: ProviderFetch;
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

  try {
    const provider = createRerankProvider(input.config, { fetch: input.fetch ?? fetch });
    const result = await provider.rerank({
      query: 'super helper rerank smoke',
      documents: [
        { id: 'rerank_smoke_match', text: 'super helper rerank smoke' },
        { id: 'rerank_smoke_other', text: 'unrelated document' },
      ],
      topN: input.config.topN ?? 2,
    });
    return {
      provider: provider.id,
      model: provider.model,
      ok: true,
      durationMs: Date.now() - startedAt,
      topScore: result.results[0]?.score,
    };
  } catch (error) {
    return {
      provider: input.config.provider,
      model: input.config.model,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: isProviderError(error)
        ? {
          code: error.code,
          status: error.status,
          retryable: error.retryable,
          safeMessage: error.safeMessage,
        }
        : {
          code: 'unknown',
          retryable: false,
          safeMessage: formatProviderSafeError(error),
        },
    };
  }
}

import { ProviderError } from '../errors.js';
import { FakeEmbeddingProvider } from './fake.js';
import { GeminiEmbeddingProvider } from './gemini/adapter.js';
import { MiniMaxEmbeddingProvider } from './minimax/adapter.js';
import { QwenEmbeddingProvider } from './qwen/adapter.js';
import { SiliconFlowEmbeddingProvider } from './siliconflow/adapter.js';
import type {
  EmbeddingDistanceMetric,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderFactoryOptions,
  EmbeddingProviderId,
} from './contract.js';

const SUPPORTED_PROVIDERS: EmbeddingProviderId[] = ['siliconflow', 'minimax', 'gemini', 'qwen', 'fake'];
const SUPPORTED_DISTANCES: EmbeddingDistanceMetric[] = ['cosine', 'dot', 'euclidean'];

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
  options: EmbeddingProviderFactoryOptions = {},
): EmbeddingProvider {
  validateEmbeddingProviderConfig(config);

  switch (config.provider) {
    case 'fake':
      return new FakeEmbeddingProvider({
        provider: 'fake',
        model: config.model,
        dimensions: config.dimensions,
        distance: config.distance as EmbeddingDistanceMetric,
      });
    case 'siliconflow':
      return new SiliconFlowEmbeddingProvider(config, options);
    case 'minimax':
      return new MiniMaxEmbeddingProvider(config);
    case 'gemini':
      return new GeminiEmbeddingProvider(config);
    case 'qwen':
      return new QwenEmbeddingProvider(config);
    default:
      throw unsupportedProviderError(config.provider);
  }
}

export function validateEmbeddingProviderConfig(config: EmbeddingProviderConfig): void {
  if (!SUPPORTED_PROVIDERS.includes(config.provider as EmbeddingProviderId)) {
    throw unsupportedProviderError(config.provider);
  }
  if (!config.model?.trim()) {
    throw new ProviderError({
      provider: config.provider,
      code: 'invalid_request',
      retryable: false,
      safeMessage: 'Embedding model must be configured when embedding is enabled.',
    });
  }
  if (!Number.isInteger(config.dimensions) || config.dimensions <= 0) {
    throw new ProviderError({
      provider: config.provider,
      code: 'invalid_request',
      retryable: false,
      safeMessage: 'Embedding dimensions must be a positive integer.',
    });
  }
  if (!SUPPORTED_DISTANCES.includes(config.distance as EmbeddingDistanceMetric)) {
    throw new ProviderError({
      provider: config.provider,
      code: 'invalid_request',
      retryable: false,
      safeMessage: 'Embedding distance must be one of cosine, dot, or euclidean.',
    });
  }
}

function unsupportedProviderError(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: 'unsupported_provider',
    retryable: false,
    safeMessage: `Unsupported embedding provider: ${provider}`,
  });
}

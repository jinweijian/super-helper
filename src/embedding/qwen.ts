import { EmbeddingProviderError } from './errors.js';
import type {
  EmbeddingBatchResult,
  EmbeddingDistanceMetric,
  EmbeddingDocumentInput,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingQueryInput,
  EmbeddingRequestOptions,
  EmbeddingVectorResult,
} from './types.js';

export class QwenEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'qwen';
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.distance = config.distance as EmbeddingDistanceMetric;
  }

  async embedDocuments(
    _input: EmbeddingDocumentInput[],
    _options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingBatchResult> {
    throw this.unsupportedError();
  }

  async embedQuery(
    _input: EmbeddingQueryInput,
    _options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingVectorResult> {
    throw this.unsupportedError();
  }

  private unsupportedError(): EmbeddingProviderError {
    return new EmbeddingProviderError({
      provider: this.id,
      code: 'unsupported_provider',
      retryable: false,
      safeMessage: 'Qwen embedding provider is reserved for a later OpenSpec change and is not implemented in this change.',
    });
  }
}

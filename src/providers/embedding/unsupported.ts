import { ProviderError, type ProviderErrorCode } from '../errors.js';
import type {
  EmbeddingBatchResult,
  EmbeddingDistanceMetric,
  EmbeddingDocumentInput,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderId,
  EmbeddingQueryInput,
  EmbeddingRequestOptions,
  EmbeddingVectorResult,
} from './contract.js';

export class UnsupportedEmbeddingProvider implements EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;

  constructor(
    config: EmbeddingProviderConfig,
    private readonly unavailable: {
      provider: EmbeddingProviderId;
      code: ProviderErrorCode;
      safeMessage: string;
    },
  ) {
    this.id = unavailable.provider;
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.distance = config.distance as EmbeddingDistanceMetric;
  }

  async embedDocuments(
    _input: EmbeddingDocumentInput[],
    _options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingBatchResult> {
    throw this.unavailableError();
  }

  async embedQuery(
    _input: EmbeddingQueryInput,
    _options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingVectorResult> {
    throw this.unavailableError();
  }

  private unavailableError(): ProviderError {
    return new ProviderError({
      provider: this.id,
      code: this.unavailable.code,
      retryable: false,
      safeMessage: this.unavailable.safeMessage,
    });
  }
}

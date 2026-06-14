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

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'gemini';
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
    throw this.docsRequiredError();
  }

  async embedQuery(
    _input: EmbeddingQueryInput,
    _options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingVectorResult> {
    throw this.docsRequiredError();
  }

  private docsRequiredError(): EmbeddingProviderError {
    return new EmbeddingProviderError({
      provider: this.id,
      code: 'docs_required',
      retryable: false,
      safeMessage: 'Gemini embedding adapter requires provider-specific request/response implementation before real calls are available.',
    });
  }
}

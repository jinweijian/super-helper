import { createHash } from 'node:crypto';
import type {
  EmbeddingBatchResult,
  EmbeddingDistanceMetric,
  EmbeddingDocumentInput,
  EmbeddingProvider,
  EmbeddingProviderId,
  EmbeddingQueryInput,
  EmbeddingRequestOptions,
  EmbeddingVectorResult,
} from './types.js';

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;
  private readonly seed: string;

  constructor(input: {
    provider?: EmbeddingProviderId;
    model: string;
    dimensions: number;
    distance: EmbeddingDistanceMetric;
    seed?: string;
  }) {
    this.id = input.provider ?? 'fake';
    this.model = input.model;
    this.dimensions = input.dimensions;
    this.distance = input.distance;
    this.seed = input.seed ?? 'super-helper-fake-embedding-v1';
  }

  async embedDocuments(
    input: EmbeddingDocumentInput[],
    _options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingBatchResult> {
    return {
      provider: this.id,
      model: this.model,
      dimensions: this.dimensions,
      distance: this.distance,
      results: input.map((item) => this.vectorResult({
        id: item.id,
        text: item.text,
        contentHash: item.contentHash,
        metadata: item.metadata,
      })),
      usage: {
        providerRequestCount: 1,
        inputTokens: input.reduce((sum, item) => sum + estimateTokens(item.text), 0),
      },
      warnings: [],
    };
  }

  async embedQuery(
    input: EmbeddingQueryInput,
    _options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingVectorResult> {
    return this.vectorResult({
      id: input.id ?? 'query',
      text: input.text,
      metadata: input.metadata,
    });
  }

  private vectorResult(input: {
    id: string;
    text: string;
    contentHash?: string;
    metadata?: Record<string, unknown>;
  }): EmbeddingVectorResult {
    return {
      id: input.id,
      provider: this.id,
      model: this.model,
      dimensions: this.dimensions,
      distance: this.distance,
      vector: deterministicVector({
        seed: this.seed,
        model: this.model,
        dimensions: this.dimensions,
        text: input.text,
      }),
      usage: {
        providerRequestCount: 1,
        inputTokens: estimateTokens(input.text),
      },
      contentHash: input.contentHash,
      metadata: input.metadata,
    };
  }
}

function deterministicVector(input: {
  seed: string;
  model: string;
  dimensions: number;
  text: string;
}): number[] {
  return Array.from({ length: input.dimensions }, (_, index) => {
    const hash = createHash('sha256')
      .update(input.seed)
      .update('\0')
      .update(input.model)
      .update('\0')
      .update(String(index))
      .update('\0')
      .update(input.text)
      .digest();
    const integer = hash.readUInt32BE(0);
    return Number(((integer / 0xffffffff) * 2 - 1).toFixed(8));
  });
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

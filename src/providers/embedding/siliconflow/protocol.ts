import { ProviderError } from '../../errors.js';
import { isProviderObject } from '../../http.js';
import type {
  EmbeddingDistanceMetric,
  EmbeddingProviderConfig,
  EmbeddingVectorResult,
} from '../contract.js';

export interface SiliconFlowEmbeddingResponse {
  model?: string;
  data: Array<Record<string, unknown>>;
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
}

export function buildSiliconFlowEmbeddingRequest(
  config: EmbeddingProviderConfig,
  input: string | string[],
): Record<string, unknown> {
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

export function parseSiliconFlowEmbeddingResponse(value: unknown): SiliconFlowEmbeddingResponse {
  if (!isProviderObject(value) || !Array.isArray(value.data)) {
    throw malformed('SiliconFlow embedding response did not include data[].');
  }
  const usage = isProviderObject(value.usage)
    ? {
      promptTokens: numberOrUndefined(value.usage.prompt_tokens),
      totalTokens: numberOrUndefined(value.usage.total_tokens),
    }
    : undefined;
  return {
    model: typeof value.model === 'string' ? value.model : undefined,
    data: value.data.map((item) => {
      if (!isProviderObject(item)) {
        throw malformed('SiliconFlow embedding response contained an invalid data[] item.');
      }
      return item;
    }),
    usage,
  };
}

export function mapSiliconFlowEmbeddingResponse(input: {
  response: SiliconFlowEmbeddingResponse;
  model: string;
  dimensions: number;
  distance: EmbeddingDistanceMetric;
  ids: string[];
  contentHashes: Array<string | undefined>;
  metadatas: Array<Record<string, unknown> | undefined>;
}): EmbeddingVectorResult[] {
  if (input.response.data.length !== input.ids.length) {
    throw malformed(`SiliconFlow embedding response returned ${input.response.data.length} vectors for ${input.ids.length} inputs.`);
  }

  const seenIndexes = new Set<number>();
  return input.response.data
    .slice()
    .sort((left, right) => numericIndex(left.index, 0) - numericIndex(right.index, 0))
    .map((item, outputIndex) => {
      const vector = item.embedding;
      if (!Array.isArray(vector) || !vector.every((value) => typeof value === 'number')) {
        throw malformed('SiliconFlow embedding response contained a missing or invalid vector.');
      }
      if (vector.length !== input.dimensions) {
        throw new ProviderError({
          provider: 'siliconflow',
          code: 'dimension_mismatch',
          retryable: false,
          safeMessage: `SiliconFlow embedding dimensions mismatch for ${input.model}: expected ${input.dimensions}, got ${vector.length}.`,
        });
      }
      if (item.index !== undefined && !Number.isInteger(item.index)) {
        throw malformed('SiliconFlow embedding response contained a non-integer data[].index.');
      }
      const sourceIndex = numericIndex(item.index, outputIndex);
      if (sourceIndex < 0 || sourceIndex >= input.ids.length || seenIndexes.has(sourceIndex)) {
        throw malformed('SiliconFlow embedding response contained an invalid or duplicate data[].index.');
      }
      seenIndexes.add(sourceIndex);
      return {
        id: input.ids[sourceIndex] ?? input.ids[outputIndex] ?? String(outputIndex),
        provider: 'siliconflow',
        model: input.response.model ?? input.model,
        dimensions: input.dimensions,
        distance: input.distance,
        vector,
        usage: {
          providerRequestCount: 1,
          inputTokens: input.response.usage?.promptTokens,
          totalTokens: input.response.usage?.totalTokens,
        },
        contentHash: input.contentHashes[sourceIndex] ?? input.contentHashes[outputIndex],
        metadata: input.metadatas[sourceIndex] ?? input.metadatas[outputIndex],
      };
    });
}

function numericIndex(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function malformed(safeMessage: string): ProviderError {
  return new ProviderError({
    provider: 'siliconflow',
    code: 'malformed_response',
    retryable: false,
    safeMessage,
  });
}

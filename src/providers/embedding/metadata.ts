import { createHash } from 'node:crypto';
import type { EmbeddingProviderConfig } from './contract.js';

export interface EmbeddingManifestLike {
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
}

export interface EmbeddingCompatibilityResult {
  compatible: boolean;
  mismatches: Array<'provider' | 'model' | 'dimensions' | 'distance'>;
}

export function embeddingConfigFingerprint(config: EmbeddingProviderConfig): string {
  return ['embedding-v1', config.provider, config.model, String(config.dimensions), config.distance].join(':');
}

export function assertEmbeddingDimensions(
  vector: number[],
  expectedDimensions: number,
  provider: string,
  model: string,
): void {
  if (vector.length !== expectedDimensions) {
    throw new Error(`Embedding dimension mismatch for ${provider}/${model}: expected ${expectedDimensions}, got ${vector.length}`);
  }
}

export function isEmbeddingManifestCompatible(
  manifest: EmbeddingManifestLike,
  config: EmbeddingProviderConfig,
): EmbeddingCompatibilityResult {
  const mismatches: EmbeddingCompatibilityResult['mismatches'] = [];
  if (manifest.provider !== config.provider) mismatches.push('provider');
  if (manifest.model !== config.model) mismatches.push('model');
  if (manifest.dimensions !== config.dimensions) mismatches.push('dimensions');
  if (manifest.distance !== config.distance) mismatches.push('distance');
  return { compatible: mismatches.length === 0, mismatches };
}

export function hashEmbeddingText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

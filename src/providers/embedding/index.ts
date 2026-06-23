export type {
  EmbeddingBatchResult,
  EmbeddingDistanceMetric,
  EmbeddingDocumentInput,
  EmbeddingFetch,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderFactoryOptions,
  EmbeddingProviderHealthCheckResult,
  EmbeddingProviderId,
  EmbeddingQueryInput,
  EmbeddingRequestOptions,
  EmbeddingUsage,
  EmbeddingVectorResult,
} from './contract.js';
export { FakeEmbeddingProvider } from './fake.js';
export {
  createEmbeddingProvider,
  validateEmbeddingProviderConfig,
} from './factory.js';
export { runEmbeddingSmokeTest } from './smoke-test.js';
export { SiliconFlowEmbeddingProvider } from './siliconflow/adapter.js';
export { GeminiEmbeddingProvider } from './gemini/adapter.js';
export { MiniMaxEmbeddingProvider } from './minimax/adapter.js';
export { QwenEmbeddingProvider } from './qwen/adapter.js';
export {
  assertEmbeddingDimensions,
  embeddingConfigFingerprint,
  hashEmbeddingText,
  isEmbeddingManifestCompatible,
} from './metadata.js';
export type {
  EmbeddingCompatibilityResult,
  EmbeddingManifestLike,
} from './metadata.js';

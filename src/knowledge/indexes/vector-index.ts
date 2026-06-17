export {
  buildKnowledgeVectorIndex,
  checkKnowledgeVectorCompatibility,
  chunkToEmbeddingDocumentInput,
  isChunkEligibleForRemoteEmbedding,
  loadKnowledgeChunksForEmbedding,
  readKnowledgeVectorManifest,
  readKnowledgeVectorRecords,
} from '../vector-index.js';
export type {
  BuildKnowledgeVectorIndexInput,
  BuildKnowledgeVectorIndexResult,
  KnowledgeEmbeddingConfigLike,
  KnowledgeEmbeddingDocumentInput,
  KnowledgeEmbeddingProviderLike,
  KnowledgeVectorCompatibilityResult,
  KnowledgeVectorCompatibilityStatus,
} from '../vector-index.js';

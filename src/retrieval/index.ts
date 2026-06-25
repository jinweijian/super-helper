export type {
  RecallStrategyKind,
  RetrievalCandidate,
  RetrievalInput,
  RetrievalResult,
  RetrievalStrategyScore,
  RetrievalStrategyTrace,
  RetrievalTrace,
} from './types.js';
export type {
  RecallContext,
  RecallEnabledResult,
  RecallInput,
  RecallResult,
  RecallStrategy,
} from './recall/contract.js';
export {
  createDefaultRetrievalStrategies,
} from './registry.js';
export type { RetrievalRegistryOptions } from './registry.js';
export { createRetrievalService } from './service.js';
export type { RetrievalService } from './service.js';
export { dedupeRetrievalCandidatesByParent } from './parent-dedupe.js';
export { createBm25RecallStrategy } from './recall/bm25/strategy.js';
export { createEmbeddingRecallStrategy } from './recall/embedding/strategy.js';
export { tokenizeForBm25 } from './recall/bm25/tokenizer.js';
export { scoreBm25 } from './recall/bm25/scorer.js';
export { scoreFieldWeightedBm25, KNOWLEDGE_FIELD_WEIGHTS } from './recall/bm25/field-scorer.js';
export type { Bm25KnowledgeField, FieldWeightedBm25Document, FieldWeightedBm25Result } from './recall/bm25/field-scorer.js';
export { createProviderReranker } from './rerank/service.js';
export type { RetrievalReranker } from './rerank/service.js';
export { retrievalCandidatesToEvidencePack } from './evidence-pack.js';

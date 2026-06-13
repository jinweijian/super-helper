export { parseMarkdownDocument, parseSimpleYaml } from './frontmatter.js';
export { initKnowledgeWorkspace } from './init.js';
export { defaultSourceDirectory, ingestSourceDocuments } from './ingest.js';
export { knowledgeRoot } from './paths.js';
export {
  discoverKnowledgeDocuments,
  keywordsFromQuery,
  loadSourceDocuments,
  searchKnowledge,
  updateKnowledgeIndex,
} from './indexer.js';
export { loadKnowledgeTaxonomy, routeKnowledgeQuestion } from './taxonomy.js';
export type {
  KnowledgeChunk,
  KnowledgeConfidence,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeEvidencePack,
  KnowledgeEvidenceResult,
  KnowledgeFrontmatter,
  KnowledgeIndexManifest,
  KnowledgeIngestReport,
  KnowledgeInitResult,
  KnowledgeRoute,
  KnowledgeSearchQuery,
  KnowledgeSourceDocument,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeUpdateResult,
  KnowledgeVisibility,
} from './types.js';

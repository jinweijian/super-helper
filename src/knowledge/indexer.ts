export {
  discoverKnowledgeDocuments,
  loadSourceDocuments,
} from './documents/discovery.js';
export {
  updateKnowledgeIndex,
  updateKnowledgeIndexWithQuality,
} from './indexes/build.js';
export {
  keywordsFromQuery,
  searchKnowledgeCompatibility as searchKnowledge,
} from '../retrieval/compatibility-search.js';
export { searchKnowledgeWithRag } from '../retrieval/legacy-rag.js';
export type { KnowledgeRagSearchQuery } from '../retrieval/legacy-rag.js';

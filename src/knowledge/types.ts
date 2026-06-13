export type KnowledgeDocumentType =
  | 'faq'
  | 'solved_case'
  | 'unresolved_case'
  | 'whitepaper_slice'
  | 'runbook'
  | 'module_overview'
  | 'glossary_term';

export type KnowledgeSourceType =
  | 'faq'
  | 'runbook'
  | 'solved_case'
  | 'unresolved_case'
  | 'whitepaper'
  | 'glossary'
  | 'module_doc'
  | 'ticket';

export type KnowledgeConfidence = 'low' | 'medium' | 'high';

export type KnowledgeStatus = 'draft' | 'review_required' | 'active' | 'deprecated' | 'archived';

export type KnowledgeVisibility = 'internal' | 'support' | 'customer_safe' | 'restricted';

export interface KnowledgeFrontmatter {
  id: string;
  title: string;
  type: KnowledgeDocumentType;
  module: string;
  intent: string;
  source_type: KnowledgeSourceType;
  confidence: KnowledgeConfidence;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  product_versions: string[];
  related_terms: string[];
  related_repos: string[];
  last_verified_at: string;
  owner: string;
  source_document?: string;
  source_document_id?: string;
  source_pages?: number[];
  section_path?: string[];
  chunking_strategy?: string;
  tags?: string[];
  review_cycle_days?: number;
}

export interface KnowledgeDocument {
  frontmatter: KnowledgeFrontmatter;
  body: string;
  headings: string[];
  path: string;
  relativePath: string;
}

export interface KnowledgeSourceDocument {
  id: string;
  source_type: string;
  path: string;
  sha256?: string;
  title: string;
  downloaded_at?: string;
  source_url?: string;
  product_versions?: string[];
  page_count?: number;
  owner?: string;
  ingest_tool_version?: string;
}

export interface KnowledgeChunk {
  chunk_id: string;
  parent_id: string;
  source: string;
  source_document?: string;
  source_document_id?: string;
  source_pages?: number[];
  module: string;
  intent: string;
  source_type: KnowledgeSourceType;
  status: KnowledgeStatus;
  confidence: KnowledgeConfidence;
  headings: string[];
  keywords: string[];
  text: string;
}

export interface KnowledgeEvidenceResult {
  evidence_id: string;
  document_id: string;
  parent_id: string;
  chunk_id?: string;
  source: string;
  source_document?: string;
  source_document_id?: string;
  source_pages?: number[];
  title: string;
  type: KnowledgeDocumentType;
  module: string;
  intent: string;
  source_type: KnowledgeSourceType;
  confidence: KnowledgeConfidence;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  last_verified_at: string;
  matched_terms: string[];
  summary: string;
  excerpt: string;
  score: number;
}

export interface KnowledgeSearchQuery {
  workspaceRoot: string;
  query: string;
  moduleCandidates?: string[];
  intentCandidates?: string[];
  sourceTypes?: KnowledgeSourceType[];
  productVersions?: string[];
  visibility?: KnowledgeVisibility[];
  limit?: number;
}

export interface KnowledgeRoute {
  normalizedQuestion: string;
  moduleCandidates: string[];
  intentCandidates: string[];
  keywords: string[];
  sourceTypes: KnowledgeSourceType[];
  codeEscalationSignals: string[];
  risks: string[];
}

export interface KnowledgeEvidencePack {
  query: {
    normalized_question: string;
    module_candidates: string[];
    intent_candidates: string[];
    keywords: string[];
  };
  results: KnowledgeEvidenceResult[];
  coverage: {
    searched_files: number;
    matched_files: number;
    filtered_out: Array<{ reason: string; count: number }>;
  };
}

export interface KnowledgeIndexManifest {
  version: 1;
  updated_at: string;
  document_count: number;
  chunk_count: number;
  source_document_count: number;
  documents: Array<{
    id: string;
    path: string;
    title: string;
    type: KnowledgeDocumentType;
    module: string;
    intent: string;
    status: KnowledgeStatus;
    confidence: KnowledgeConfidence;
  }>;
}

export interface KnowledgeInitResult {
  knowledgeRoot: string;
  created: boolean;
  directories: string[];
  files: string[];
  ingestReportPath?: string;
}

export interface KnowledgeIngestReport {
  version: 1;
  sourceDir?: string;
  parserStrategy: string;
  sourceDocuments: number;
  parentSlices: number;
  chunks: number;
  skipped: Array<{ path: string; reason: string }>;
  imported: Array<{
    sourcePath: string;
    sourceDocumentId: string;
    sourceDocumentPath: string;
    parentSliceIds: string[];
  }>;
  generatedAt: string;
}

export interface KnowledgeUpdateResult {
  knowledgeRoot: string;
  documentCount: number;
  chunkCount: number;
  sourceDocumentCount: number;
  manifestPath: string;
  chunksPath: string;
}

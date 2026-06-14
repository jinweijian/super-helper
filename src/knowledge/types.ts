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

// Pipeline stage and status enums
export type KnowledgePipelineStage =
  | 'intake'
  | 'extract'
  | 'normalize'
  | 'slice'
  | 'audit'
  | 'repair'
  | 'review'
  | 'publish'
  | 'index'
  | 'eval';

export type KnowledgePipelineStatus =
  | 'imported'
  | 'extracted'
  | 'normalized'
  | 'draft'
  | 'quality_warn'
  | 'quality_error'
  | 'review_required'
  | 'approved'
  | 'rejected'
  | 'published';

// Source block types
export type KnowledgeSourceBlockType =
  | 'heading'
  | 'paragraph'
  | 'list_item'
  | 'table'
  | 'toc'
  | 'header_footer'
  | 'image_caption'
  | 'unknown';

export interface KnowledgeSourceBlock {
  block_id: string;
  source_document_id: string;
  order: number;
  type: KnowledgeSourceBlockType;
  text: string;
  heading_level?: number;
  section_path: string[];
  raw?: string;
  parser?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeNormalizedBlock {
  block_id: string;
  source_document_id: string;
  source_block_id: string;
  order: number;
  type: KnowledgeSourceBlockType;
  text: string;
  normalized_text: string;
  section_path: string[];
  included_in_slice: boolean;
  excluded_reason?: string;
}

// Quality severity and issue codes
export type KnowledgeQualitySeverity = 'info' | 'warn' | 'error';

export type KnowledgeQualityIssueCode =
  // Source/parser issues
  | 'parser_empty'
  | 'too_many_unknown_blocks'
  | 'toc_not_removed'
  | 'header_footer_noise'
  | 'table_lost'
  | 'list_structure_lost'
  | 'heading_structure_broken'
  | 'duplicate_paragraphs'
  | 'source_provenance_missing'
  // Slice issues
  | 'empty_body'
  | 'heading_only'
  | 'toc_like'
  | 'too_short'
  | 'too_long'
  | 'duplicate_content'
  | 'multi_topic_slice'
  | 'broken_coreference'
  | 'not_answer_bearing'
  | 'missing_source_document'
  | 'missing_source_document_id'
  | 'missing_source_block_ids'
  | 'missing_source_blocks'
  | 'missing_section_path'
  | 'missing_parent'
  | 'orphan_chunk'
  | 'low_signal_terms';

export interface KnowledgeQualityIssue {
  code: KnowledgeQualityIssueCode;
  severity: KnowledgeQualitySeverity;
  message: string;
  documentId?: string;
  chunkId?: string;
  source?: string;
  sourceDocument?: string;
  sectionPath?: string[];
  contentHash?: string;
  details?: Record<string, unknown>;
}

export interface KnowledgeQualityThresholds {
  minBodyChars: number;
  maxParentChars: number;
  maxUnknownBlockRatio: number;
  minRelatedTerms: number;
  maxDuplicateNormalizedHashes: number;
  multiTopicHeadingThreshold: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: KnowledgeQualityThresholds = {
  minBodyChars: 80,
  maxParentChars: 2800,
  maxUnknownBlockRatio: 0.3,
  minRelatedTerms: 3,
  maxDuplicateNormalizedHashes: 1,
  multiTopicHeadingThreshold: 3,
};

export interface KnowledgeQualityReport {
  version: 1;
  workspaceRoot: string;
  knowledgeRoot: string;
  generatedAt: string;
  thresholds: KnowledgeQualityThresholds;
  inspected: {
    sourceDocuments: number;
    draftSlices: number;
    publishedSlices: number;
    chunks: number;
  };
  stageSummaries: Record<string, { warnings: number; errors: number; info: number }>;
  severityCounts: Record<KnowledgeQualitySeverity, number>;
  issueCounts: Record<string, number>;
  issues: KnowledgeQualityIssue[];
  recommendedActions: string[];
  gate: 'warn' | 'strict' | 'off';
}

// Frontmatter extended with optional pipeline fields
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
  // Optional pipeline fields (all must be optional for backward compatibility)
  quality_status?: 'unchecked' | 'ok' | 'warn' | 'error';
  source_block_ids?: string[];
  pipeline_stage?: KnowledgePipelineStage;
  pipeline_status?: KnowledgePipelineStatus;
  review_id?: string;
  publish_id?: string;
  repair_plan_ids?: string[];
  // Solved case review fields
  reviewer?: string;
  reviewed_at?: string;
  review_notes?: string;
  review_status?: 'pending' | 'approved' | 'rejected' | 'request_edits';
  review_action?: KnowledgeCaseReviewAction;
  review_source?: 'cli' | 'runtime' | 'api';
}

export interface KnowledgeDocument {
  frontmatter: KnowledgeFrontmatter;
  body: string;
  headings: string[];
  path: string;
  relativePath: string;
}

// Pipeline artifact reports
export interface KnowledgeExtractReport {
  version: 1;
  sourceDocumentId: string;
  generatedAt: string;
  parserStrategy: string;
  blockCounts: Record<string, number>;
  unknownBlockCount: number;
  skippedTocCount: number;
  warnings: string[];
  errors: string[];
  fatal: boolean;
}

export interface KnowledgeNormalizeReport {
  version: 1;
  sourceDocumentId: string;
  inputBlockCount: number;
  outputBlockCount: number;
  excludedBlockCounts: Record<string, number>;
  headingStructureWarnings: string[];
  generatedAt: string;
}

export interface KnowledgeDraftSliceReport {
  version: 1;
  sourceDocumentId: string;
  draftSliceCount: number;
  draftPaths: string[];
  sourceBlockCoverage: { included: number; total: number };
  coveredSourceBlockIds?: string[];
  uncoveredSourceBlockIds?: string[];
  warnings: string[];
  generatedAt: string;
}

export type KnowledgeRepairActionType =
  | 'merge_adjacent_short_slices'
  | 'split_oversized_slice'
  | 'remove_duplicate_draft'
  | 'add_section_path'
  | 'add_related_terms'
  | 'mark_review_required'
  | 'mark_quality_error'
  | 'manual_review_required';

export type KnowledgeRepairSafety = 'safe' | 'review_required';

export interface KnowledgeRepairAction {
  actionId: string;
  issueIds: string[];
  actionType: KnowledgeRepairActionType;
  targetPaths: string[];
  targetIds: string[];
  beforeSummary: string;
  afterSummary: string;
  safety: KnowledgeRepairSafety;
  requiresHumanReview: boolean;
  details?: Record<string, unknown>;
}

export interface KnowledgeRepairPlan {
  version: 1;
  planId: string;
  generatedAt: string;
  sourceReportPaths: string[];
  qualityReportPath: string;
  actions: KnowledgeRepairAction[];
  summary: { safe: number; reviewRequired: number; total: number };
  safetySummary: { safe: number; reviewRequired: number };
}

export interface KnowledgeRepairResult {
  planId: string;
  appliedActions: KnowledgeRepairAction[];
  skippedActions: KnowledgeRepairAction[];
  changedFiles: Array<{ path: string; previousHash: string; newHash: string }>;
  rollbackNotes: string[];
  generatedAt: string;
}

// Review records
export type KnowledgeCaseReviewAction = 'approve' | 'reject' | 'request_edits' | 'convert_to_unresolved' | 'accept_warnings';

export interface KnowledgeSliceReviewRecord {
  reviewId: string;
  sourceDocumentId: string;
  reviewer: string;
  action: 'approve' | 'reject' | 'request_edits' | 'accept_warnings';
  notes: string;
  reviewedIds: string[];
  previousStatuses: string[];
  nextStatuses: string[];
  qualityIssueIds: string[];
  reviewedAt: string;
}

export interface KnowledgeCaseReviewRecord {
  documentId: string;
  action: KnowledgeCaseReviewAction;
  reviewer: string;
  reviewedAt: string;
  notes: string;
  previousStatus: string;
  nextStatus: string;
  sourcePath: string;
  targetPath?: string;
  createdAt: string;
}

// Publish report
export interface KnowledgePublishReport {
  version: 1;
  publishId: string;
  generatedAt: string;
  publishedIds: string[];
  rejectedIds: string[];
  warningOverrides: Array<{ documentId: string; issueId: string; reason: string }>;
  sourceDocumentIds: string[];
  outputPaths: string[];
  indexDirty: boolean;
  qualityReportPath?: string;
  qualityReportGeneratedAt?: string;
}

// Eval types
export interface KnowledgeEvalQuestion {
  id: string;
  question: string;
  shouldHit: boolean;
  expectedDocument?: string;
  expectedSection?: string;
  expectedKeywords?: string[];
  expectedSourceType?: KnowledgeSourceType;
  expectedEscalation?: 'code' | 'human' | 'none';
}

export interface KnowledgeEvalQuestionResult {
  questionId: string;
  passed: boolean;
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt5: boolean;
  answerBearing: boolean;
  falsePositive: boolean;
  failureReason?: string;
  failureAttribution?: 'source_extraction' | 'normalization' | 'slicing' | 'retrieval' | 'evidence_judge' | 'missing_source_knowledge' | 'escalation';
  evidenceIds: string[];
  topEvidence?: {
    source: string;
    sourceDocument?: string;
    title: string;
    excerptPreview: string;
    matchedTerms: string[];
    qualityStatus?: 'ok' | 'info' | 'warn' | 'error';
  };
}

export interface KnowledgeEvalReport {
  version: 1;
  generatedAt: string;
  questionCount: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  answerBearingRate: number;
  falsePositiveCount: number;
  escalationResults: Array<{ questionId: string; escalated: boolean; reason: string }>;
  failures: Array<{ questionId: string; reason: string; attribution?: string }>;
  perQuestion: KnowledgeEvalQuestionResult[];
}

// Acceptance report types
export type KnowledgeAcceptanceSeverity = 'ok' | 'info' | 'warn' | 'error';

export interface KnowledgeAcceptanceCheck {
  id: string;
  name: string;
  severity: KnowledgeAcceptanceSeverity;
  passed: boolean;
  message: string;
  redactedDetails?: Record<string, unknown>;
}

export interface KnowledgeAcceptanceScenario {
  id: string;
  name: string;
  question: string;
  passed: boolean;
  reason: string;
  caseId?: string;
  runId?: string;
  evidenceIds: string[];
  workerCallCount: number;
  logPhases: string[];
  checks: KnowledgeAcceptanceCheck[];
}

export interface KnowledgeAcceptanceReport {
  version: 1;
  generatedAt: string;
  workspaceRoot: string;
  configSummary: Record<string, string>;
  environmentSummary: Record<string, string>;
  redactionSummary: { fieldsRedacted: string[]; secretsStripped: boolean };
  scenarios: KnowledgeAcceptanceScenario[];
  failures: Array<{ scenarioId: string; reason: string }>;
  overallPassed: boolean;
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
  // Pipeline fields
  original_path?: string;
  stored_path?: string;
  parser?: string;
  imported_at?: string;
  source_kind?: string;
  pipeline_status?: KnowledgePipelineStatus;
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
  visibility?: KnowledgeVisibility;
  headings: string[];
  keywords: string[];
  text: string;
}

export interface KnowledgeVectorRecord {
  vector_id: string;
  source: string;
  document_id: string;
  chunk_id: string;
  text_hash: string;
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  vector: number[];
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeVectorManifest {
  version: 1;
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  source_chunk_manifest_hash: string;
  vector_count: number;
  skipped_count: number;
  failed_count: number;
  generated_at: string;
  embedding_config_fingerprint: string;
}

export interface KnowledgeVectorBuildReport {
  version: 1;
  generatedAt: string;
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  vectorCount: number;
  skipped: Array<{ chunkId: string; textHash: string; reason: string }>;
  failures: Array<{ chunkId: string; textHash?: string; error: string }>;
  durationMs: number;
  vectorsPath: string;
  manifestPath: string;
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
  quality?: { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] };
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
  qualityReportPath?: string;
  sourceQualityReportPath?: string;
  qualityGateResult?: {
    passed: boolean;
    exitCode: number;
    reason?: string;
  };
  qualitySeverityCounts?: Record<KnowledgeQualitySeverity, number>;
  qualityIssueCounts?: Record<string, number>;
}

export interface KnowledgeIngestReport {
  version: 1;
  sourceDir?: string;
  parserStrategy: string;
  compatibility_mode?: 'legacy_active_publish';
  quality_gate_bypassed?: boolean;
  sourceDocuments: number;
  parentSlices: number;
  chunks: number;
  skipped: Array<{ path: string; reason: string }>;
  imported: Array<{
    sourcePath: string;
    sourceDocumentId: string;
    sourceDocumentPath: string;
    parentSliceIds: string[];
    // Pipeline artifact paths
    sourceMetaPath?: string;
    blocksPath?: string;
    normalizedBlocksPath?: string;
    draftRoot?: string;
    publishReportPath?: string;
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
  qualityReportPath?: string;
  sourceQualityReportPath?: string;
  qualityGateResult?: {
    passed: boolean;
    exitCode: number;
    reason?: string;
  };
  qualitySeverityCounts?: Record<KnowledgeQualitySeverity, number>;
  qualityIssueCounts?: Record<string, number>;
}

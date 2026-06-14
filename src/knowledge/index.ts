export { parseMarkdownDocument, parseSimpleYaml } from './frontmatter.js';
export { initKnowledgeWorkspace } from './init.js';
export { defaultSourceDirectory, ingestSourceDocuments } from './ingest.js';
export { knowledgeRoot } from './paths.js';
export { resolveKnowledgeWorkspaceRoot, workspaceKnowledgeKey } from './storage-scope.js';
export {
  discoverKnowledgeDocuments,
  keywordsFromQuery,
  loadSourceDocuments,
  searchKnowledge,
  updateKnowledgeIndex,
  updateKnowledgeIndexWithQuality,
} from './indexer.js';
export { loadKnowledgeTaxonomy, routeKnowledgeQuestion } from './taxonomy.js';
export {
  auditKnowledgeQuality,
  evaluateQualityGate,
  readKnowledgeQualityReport,
  readSourceQualityReport,
  sourceQualityReportFromQualityReport,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
  loadChunkQualityMap,
} from './quality.js';
export type { KnowledgeQualityGate } from './quality.js';
export { extractSourceBlocks, normalizeSourceBlocks, readSourceBlocks, readNormalizedBlocks, hashSourceDocument } from './extract.js';
export { buildDraftSlices, readDraftSlices } from './slicer.js';
export type { BuildDraftSlicesInput, BuildDraftSlicesResult } from './slicer.js';
export {
  generateKnowledgeRepairPlan,
  writeKnowledgeRepairPlan,
  readKnowledgeRepairPlan,
  applyKnowledgeRepairPlan,
} from './repair.js';
export { reviewDraftSlices, publishApprovedDraftSlices } from './publish.js';
export type { ReviewDraftSlicesInput, PublishApprovedDraftSlicesInput } from './publish.js';
export {
  approveSolvedCase,
  convertSolvedToUnresolved,
  loadSolvedCaseDraft,
  rejectSolvedCase,
  requestSolvedCaseEdits,
} from './case-review.js';
export { runKnowledgeEval, loadQuestions } from './eval.js';
export type { RunKnowledgeEvalInput } from './eval.js';
export type {
  // Document types
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
  // Pipeline types
  KnowledgePipelineStage,
  KnowledgePipelineStatus,
  KnowledgeSourceBlock,
  KnowledgeSourceBlockType,
  KnowledgeNormalizedBlock,
  // Quality types
  KnowledgeQualitySeverity,
  KnowledgeQualityIssueCode,
  KnowledgeQualityIssue,
  KnowledgeQualityThresholds,
  KnowledgeQualityReport,
  // Pipeline reports
  KnowledgeExtractReport,
  KnowledgeNormalizeReport,
  KnowledgeDraftSliceReport,
  KnowledgeRepairAction,
  KnowledgeRepairActionType,
  KnowledgeRepairPlan,
  KnowledgeRepairResult,
  KnowledgeRepairSafety,
  KnowledgeSliceReviewRecord,
  KnowledgeCaseReviewRecord,
  KnowledgeCaseReviewAction,
  KnowledgePublishReport,
  // Eval types
  KnowledgeEvalQuestion,
  KnowledgeEvalQuestionResult,
  KnowledgeEvalReport,
  // Acceptance types
  KnowledgeAcceptanceCheck,
  KnowledgeAcceptanceScenario,
  KnowledgeAcceptanceReport,
  KnowledgeAcceptanceSeverity,
} from './types.js';
export { DEFAULT_QUALITY_THRESHOLDS } from './types.js';

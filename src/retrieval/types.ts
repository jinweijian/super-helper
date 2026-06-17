import type {
  KnowledgeConfidence,
  KnowledgeDocumentType,
  KnowledgeEvidencePack,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeVisibility,
} from '../knowledge/types.js';

export type RecallStrategyKind = 'lexical' | 'semantic' | 'business' | 'hybrid';

export interface RetrievalInput {
  workspaceRoot: string;
  query: string;
  limit?: number;
  moduleCandidates?: string[];
  intentCandidates?: string[];
  sourceTypes?: KnowledgeSourceType[];
  visibility?: KnowledgeVisibility[];
}

export interface RetrievalCandidate {
  id: string;
  chunkId?: string;
  documentId: string;
  parentId?: string;
  source: string;
  title?: string;
  type?: KnowledgeDocumentType;
  module?: string;
  intent?: string;
  sourceType?: KnowledgeSourceType;
  confidence?: KnowledgeConfidence;
  status?: KnowledgeStatus;
  visibility?: KnowledgeVisibility;
  lastVerifiedAt?: string;
  matchedTerms?: string[];
  summary?: string;
  excerpt?: string;
  text: string;
  score: number;
  finalScore?: number;
  rerankScore?: number;
  strategyScores?: RetrievalStrategyScore[];
  metadata?: Record<string, unknown>;
}

export interface RetrievalStrategyScore {
  strategyId: string;
  score: number;
  rank: number;
}

export interface RetrievalResult {
  query: string;
  candidates: RetrievalCandidate[];
  trace: RetrievalTrace;
  evidence: KnowledgeEvidencePack;
}

export interface RetrievalTrace {
  strategies: RetrievalStrategyTrace[];
  fusion: {
    method: 'rrf' | 'none';
    inputCount: number;
    dedupedCount: number;
    finalCandidateCount: number;
  };
  rerank: {
    status: 'skipped' | 'ran' | 'failed';
    reason?: string;
    inputCount?: number;
    outputCount?: number;
  };
}

export interface RetrievalStrategyTrace {
  id: string;
  kind?: RecallStrategyKind;
  status: 'ran' | 'skipped' | 'failed';
  candidateCount: number;
  reason?: string;
}

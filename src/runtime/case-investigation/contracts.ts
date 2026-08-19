import type { AnswerGoal, Evidence } from '../../domain.js';
import type { RedmineIssueCandidate, RedmineIssueCaseDetails } from '../../mcp-servers/redmine/contracts.js';

export interface HistoricalSearchPlan {
  query: string;
  signals: string[];
  status: 'all';
  candidateLimit: 10;
  detailLimit: 3;
  degraded: boolean;
}

export interface CandidateSelection {
  issueIds: number[];
  degraded: boolean;
}

export type ReadOnlyCheckAction =
  | 'read_file'
  | 'search_workspace'
  | 'inspect_config'
  | 'inspect_log'
  | 'run_read_only_command';

export interface HistoricalVerificationCheck {
  id: string;
  action: ReadOnlyCheckAction;
  target: string;
  expectedMatch: string;
  expectedMismatch: string;
  evidenceIds: string[];
}

export interface HistoricalLead {
  id: string;
  issueId: number;
  hypothesis: string;
  evidenceIds: string[];
  conflicts: string[];
  checks: HistoricalVerificationCheck[];
}

export interface HistoricalAnalysis {
  leads: HistoricalLead[];
  degraded: boolean;
}

export type HistoricalClassification =
  | 'same_root_cause_likely'
  | 'same_symptom_different_cause'
  | 'diagnostic_lead_only'
  | 'irrelevant';

export interface HistoricalVerification {
  leadId: string;
  classification: HistoricalClassification;
  historicalEvidenceIds: string[];
  currentEvidenceIds: string[];
  supportingEvidenceIds: string[];
  conflictingEvidenceIds: string[];
}

export interface HistoricalVerificationResult {
  verifications: HistoricalVerification[];
  degraded: boolean;
}

export interface QueryPlannerInput {
  answerGoal: AnswerGoal;
}

export interface HistoricalAnalysisInput {
  details: RedmineIssueCaseDetails[];
  evidence: Evidence[];
}

export interface HistoricalVerificationInput {
  leads: HistoricalLead[];
  historicalEvidence: Evidence[];
  currentEvidence: Evidence[];
}

export interface CandidateRerankInput {
  query: string;
  candidates: RedmineIssueCandidate[];
}

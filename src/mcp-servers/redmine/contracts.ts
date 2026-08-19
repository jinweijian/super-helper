export const REDMINE_ORIGIN = 'https://redmine.codeages.work';
export const REDMINE_PROJECT_IDENTIFIER = 'itsupportknowledge';
export const REDMINE_TIMEOUT_MS = 10_000;
export const REDMINE_CASE_DETAILS_MAX_CHARACTERS = 48_000;

export interface RedmineIssueCandidate {
  issueId: number;
  subject: string;
  descriptionExcerpt: string;
  tracker?: string;
  status?: string;
  priority?: string;
  fixedVersion?: string;
  updatedAt?: string;
  sourceLocator: string;
}

export type RedmineEvidenceBlockKind =
  | 'description'
  | 'custom_field'
  | 'journal'
  | 'status_change'
  | 'relation'
  | 'attachment_metadata';

export interface RedmineEvidenceBlock {
  id: string;
  kind: RedmineEvidenceBlockKind;
  label?: string;
  text?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RedmineIssueCaseDetails {
  issueId: number;
  subject: string;
  tracker?: string;
  status?: string;
  priority?: string;
  fixedVersion?: string;
  updatedAt?: string;
  sourceLocator: string;
  evidenceBlocks: RedmineEvidenceBlock[];
}

export interface BoundedRedmineCaseDetails {
  details: RedmineIssueCaseDetails[];
  omittedBlocks: number;
  truncated: boolean;
  originalCharacters: number;
  outputCharacters: number;
}

export type RedmineProbeErrorCode =
  | 'missing_credentials'
  | 'authentication_failed'
  | 'project_forbidden'
  | 'project_not_found'
  | 'project_scope_mismatch'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_response'
  | 'service_unavailable';

export interface RedmineReadonlyClient {
  getProject(): Promise<{ id: number; identifier: string }>;
  listLatestIssue(projectId: number): Promise<Array<{ id: number; projectId: number }>>;
  getIssueDetail(issueId: number, expectedProjectId: number): Promise<{
    projectId: number;
    journalCount: number;
    relationCount: number;
    attachmentCount: number;
  }>;
}

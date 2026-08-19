export const REDMINE_ORIGIN = 'https://redmine.codeages.work';
export const REDMINE_PROJECT_IDENTIFIER = 'itsupportknowledge';
export const REDMINE_TIMEOUT_MS = 10_000;

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

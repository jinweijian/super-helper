import type { CandidateGrantStore } from '../candidate-grants.js';
import type { BoundedRedmineCaseDetails } from '../contracts.js';
import type { RedmineApiClient } from '../redmine-api/client.js';
import { boundCaseDetails } from '../redmine-api/bounding.js';
import { RedmineProbeError } from '../redmine-api/error-mapping.js';
import { normalizeIssueDetails } from '../redmine-api/normalizer.js';

export type RedmineDetailToolResult =
  | ({ status: 'completed' } & BoundedRedmineCaseDetails)
  | { status: 'timeout' | 'failed'; details: []; safeErrorCode: string };

export async function getIssueCaseDetails(input: {
  input: { searchId: string; issueIds: number[] };
  client: Pick<RedmineApiClient, 'getRawIssue'>;
  grants: CandidateGrantStore;
  projectId: number;
}): Promise<RedmineDetailToolResult> {
  const issueIds = input.grants.consume(input.input.searchId, input.input.issueIds);
  try {
    const details = [];
    for (const issueId of issueIds) {
      const issue = await input.client.getRawIssue(issueId);
      if (issue.project.id !== input.projectId) throw new RedmineProbeError('project_scope_mismatch');
      details.push(normalizeIssueDetails(issue));
    }
    return { status: 'completed', ...boundCaseDetails(details) };
  } catch (error) {
    if (error instanceof RedmineProbeError) {
      return {
        status: error.code === 'timeout' ? 'timeout' : 'failed',
        details: [],
        safeErrorCode: error.code,
      };
    }
    return { status: 'failed', details: [], safeErrorCode: 'service_unavailable' };
  }
}

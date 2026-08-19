import type { CandidateGrantStore } from '../candidate-grants.js';
import type { RedmineIssueCandidate } from '../contracts.js';
import { RedmineProbeError } from '../redmine-api/error-mapping.js';
import { normalizeIssueCandidate } from '../redmine-api/normalizer.js';
import type { RedmineIssueSearch } from '../redmine-api/search.js';

export type RedmineSearchToolResult =
  | { status: 'completed'; searchId: string; candidates: RedmineIssueCandidate[] }
  | { status: 'no_hit'; candidates: [] }
  | { status: 'timeout' | 'failed'; candidates: []; safeErrorCode: string };

export async function searchIssues(input: {
  input: { query: string; signals: string[] };
  search: RedmineIssueSearch;
  grants: CandidateGrantStore;
}): Promise<RedmineSearchToolResult> {
  try {
    const raw = await input.search.search({ ...input.input, limit: 10 });
    const candidates = raw.slice(0, 10).map(normalizeIssueCandidate);
    if (candidates.length === 0) return { status: 'no_hit', candidates: [] };
    return {
      status: 'completed',
      searchId: input.grants.issue(candidates.map((candidate) => candidate.issueId)),
      candidates,
    };
  } catch (error) {
    if (error instanceof RedmineProbeError) {
      return {
        status: error.code === 'timeout' ? 'timeout' : 'failed',
        candidates: [],
        safeErrorCode: error.code,
      };
    }
    return { status: 'failed', candidates: [], safeErrorCode: 'service_unavailable' };
  }
}

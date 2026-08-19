import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { CandidateGrantError, CandidateGrantStore } from './candidate-grants.js';
import type { RedmineApiClient } from './redmine-api/client.js';
import type { RedmineIssueSearch } from './redmine-api/search.js';
import { getIssueCaseDetails } from './tools/get-issue-case-details.js';
import { searchIssues } from './tools/search-issues.js';

export const REDMINE_SEARCH_TOOL_NAME = 'redmine_search_issues';
export const REDMINE_DETAIL_TOOL_NAME = 'redmine_get_issue_case_details';

export const RedmineSearchToolInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  signals: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
}).strict();

export const RedmineDetailToolInputSchema = z.object({
  searchId: z.string().trim().min(1).max(128),
  issueIds: z.array(z.number().int().positive()).min(1).max(3),
}).strict().refine((value) => new Set(value.issueIds).size === value.issueIds.length, {
  message: 'issueIds must be unique',
});

export function createRedmineMcpServer(input: {
  search: RedmineIssueSearch;
  client: Pick<RedmineApiClient, 'getRawIssue'>;
  projectId: number;
  grants?: CandidateGrantStore;
  createServer?: (info: { name: string; version: string }) => McpServer;
}): McpServer {
  const grants = input.grants ?? new CandidateGrantStore();
  const server = (input.createServer ?? ((info) => new McpServer(info)))({
    name: 'super-helper-redmine-readonly',
    version: '0.1.0',
  });

  server.registerTool(REDMINE_SEARCH_TOOL_NAME, {
    description: 'Searches bounded, privacy-filtered historical support tickets.',
    inputSchema: RedmineSearchToolInputSchema.shape,
  }, async (rawInput) => {
    const parsed = RedmineSearchToolInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolFailure('invalid_input');
    const result = await searchIssues({ input: parsed.data, search: input.search, grants });
    return toolSuccess(result, `redmine search ${result.status}; candidates=${result.candidates.length}`);
  });

  server.registerTool(REDMINE_DETAIL_TOOL_NAME, {
    description: 'Reads up to three details authorized by the immediately preceding search.',
    inputSchema: RedmineDetailToolInputSchema.shape,
  }, async (rawInput) => {
    const parsed = RedmineDetailToolInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolFailure('invalid_input');
    try {
      const result = await getIssueCaseDetails({
        input: parsed.data,
        client: input.client,
        grants,
        projectId: input.projectId,
      });
      return toolSuccess(result, `redmine details ${result.status}; details=${result.details.length}`);
    } catch (error) {
      if (error instanceof CandidateGrantError) return toolFailure(error.code);
      return toolFailure('service_unavailable');
    }
  });

  return server;
}

function toolSuccess<T extends object>(result: T, summary: string): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text' as const, text: summary }],
    structuredContent: { ...result } as Record<string, unknown>,
  };
}

function toolFailure(safeErrorCode: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `redmine tool failed (${safeErrorCode})` }],
    structuredContent: { status: 'failed', safeErrorCode },
  };
}

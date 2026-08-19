import assert from 'node:assert/strict';
import test from 'node:test';
import { CandidateGrantError, CandidateGrantStore } from '../dist/mcp-servers/redmine/candidate-grants.js';
import {
  RedmineDetailToolInputSchema,
  RedmineSearchToolInputSchema,
} from '../dist/mcp-servers/redmine/server.js';
import { getIssueCaseDetails } from '../dist/mcp-servers/redmine/tools/get-issue-case-details.js';
import { searchIssues } from '../dist/mcp-servers/redmine/tools/search-issues.js';

function rawIssue(id, projectId = 77) {
  return {
    id,
    project: { id: projectId, name: 'Support' },
    tracker: { id: 1, name: '工单' },
    status: { id: 1, name: '新建' },
    priority: { id: 2, name: '普通' },
    subject: `Issue ${id}`,
    description: `Description ${id}`,
    created_on: '2026-08-18T00:00:00Z',
    updated_on: '2026-08-19T00:00:00Z',
    custom_fields: [],
    journals: [],
    relations: [],
    attachments: [],
    watchers: [],
  };
}

test('tool schemas reject transport, project, credential, and oversized inputs', () => {
  assert.equal(RedmineSearchToolInputSchema.safeParse({
    query: 'video',
    signals: [],
    project: 'other',
  }).success, false);
  assert.equal(RedmineSearchToolInputSchema.safeParse({
    query: 'video',
    signals: [],
    apiKey: 'secret',
  }).success, false);
  assert.equal(RedmineDetailToolInputSchema.safeParse({
    searchId: 'grant',
    issueIds: [1, 2, 3, 4],
  }).success, false);
  assert.equal(RedmineDetailToolInputSchema.safeParse({
    searchId: 'grant',
    issueIds: [1, 1],
  }).success, false);
});

test('search returns at most ten normalized candidates and creates a live grant', async () => {
  let now = 1_000;
  const grants = new CandidateGrantStore({ ttlMs: 5_000, now: () => now, createId: () => 'grant-1' });
  const result = await searchIssues({
    input: { query: 'video', signals: [] },
    search: { backend: 'issues_scan', async search() { return Array.from({ length: 12 }, (_, index) => rawIssue(index + 1)); } },
    grants,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.searchId, 'grant-1');
  assert.equal(result.candidates.length, 10);
  assert.deepEqual(grants.consume('grant-1', [1, 2, 3]), [1, 2, 3]);
  now = 7_000;
  assert.throws(() => grants.consume('grant-1', [1]), (error) => error instanceof CandidateGrantError);
});

test('detail rejects invalid grants before fetch and bounds three unique candidates', async () => {
  const grants = new CandidateGrantStore({ ttlMs: 5_000, now: () => 1_000, createId: () => 'grant-2' });
  grants.issue([10, 11, 12]);
  let fetchCalls = 0;
  const client = {
    async getRawIssue(issueId) {
      fetchCalls += 1;
      return rawIssue(issueId);
    },
  };

  await assert.rejects(
    getIssueCaseDetails({ input: { searchId: 'unknown', issueIds: [10] }, client, grants, projectId: 77 }),
    CandidateGrantError,
  );
  assert.equal(fetchCalls, 0);

  const result = await getIssueCaseDetails({
    input: { searchId: 'grant-2', issueIds: [10, 11, 12] },
    client,
    grants,
    projectId: 77,
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.details.map((detail) => detail.issueId), [10, 11, 12]);
  assert.equal(fetchCalls, 3);
  await assert.rejects(
    getIssueCaseDetails({ input: { searchId: 'grant-2', issueIds: [10] }, client, grants, projectId: 77 }),
    CandidateGrantError,
  );
  assert.equal(fetchCalls, 3);
});

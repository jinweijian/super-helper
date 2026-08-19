import assert from 'node:assert/strict';
import test from 'node:test';
import { createRedmineReadonlyClient } from '../dist/mcp-servers/redmine/redmine-api/client.js';
import { RedmineProbeError } from '../dist/mcp-servers/redmine/redmine-api/error-mapping.js';
import { createRedmineIssueSearch } from '../dist/mcp-servers/redmine/redmine-api/search.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sequenceFetch(responses, calls = []) {
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('unexpected fetch call');
      return next;
    },
  };
}

function issue(id, subject, projectId = 77, updatedOn = '2026-08-19T00:00:00Z') {
  return {
    id,
    project: { id: projectId, name: 'Support' },
    tracker: { id: 1, name: '工单' },
    status: { id: 1, name: '新建' },
    priority: { id: 2, name: '普通' },
    subject,
    description: `${subject} description`,
    created_on: '2026-08-18T00:00:00Z',
    updated_on: updatedOn,
  };
}

test('issues_scan uses fixed GET scope, bounded pages, all statuses, and a process cache', async () => {
  const calls = [];
  const fixture = sequenceFetch([
    jsonResponse({ issues: [issue(10, '视频加载失败'), issue(11, '考试报名失败')], total_count: 3, offset: 0, limit: 2 }),
    jsonResponse({ issues: [issue(12, '视频转码失败')], total_count: 3, offset: 2, limit: 2 }),
  ], calls);
  const client = createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: fixture.fetch });
  const search = createRedmineIssueSearch({
    client,
    backend: 'issues_scan',
    projectId: 77,
    maxPages: 2,
    pageSize: 2,
    updatedWithinDays: 730,
    cacheTtlMs: 300_000,
    now: () => new Date('2026-08-20T00:00:00Z'),
  });

  const first = await search.search({ query: '视频加载', signals: ['转码'], limit: 10 });
  const second = await search.search({ query: '视频加载', signals: ['转码'], limit: 10 });

  assert.deepEqual(first.map((candidate) => candidate.id), [10, 12]);
  assert.deepEqual(second.map((candidate) => candidate.id), [10, 12]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, 'https://redmine.codeages.work');
    assert.equal(url.pathname, '/issues.json');
    assert.equal(url.searchParams.get('project_id'), '77');
    assert.equal(url.searchParams.get('status_id'), '*');
    assert.equal(url.searchParams.get('sort'), 'updated_on:desc');
    assert.equal(call.init.method, 'GET');
  }
  assert.equal(new URL(calls[0].url).searchParams.get('offset'), '0');
  assert.equal(new URL(calls[1].url).searchParams.get('offset'), '2');
});

test('rest_search verifies every returned issue against the frozen numeric project', async () => {
  const fixture = sequenceFetch([
    jsonResponse({
      results: [
        { id: 20, title: '视频加载', type: 'issue', url: 'https://redmine.codeages.work/issues/20' },
        { id: 21, title: '视频加载', type: 'issue', url: 'https://redmine.codeages.work/issues/21' },
        { id: 99, title: 'Wiki', type: 'wiki-page', url: 'https://redmine.codeages.work/projects/x/wiki/99' },
      ],
    }),
    jsonResponse({ issue: issue(20, '视频加载', 77) }),
    jsonResponse({ issue: issue(21, '视频加载', 88) }),
  ]);
  const client = createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: fixture.fetch });
  const search = createRedmineIssueSearch({
    client,
    backend: 'rest_search',
    projectId: 77,
    maxPages: 1,
    pageSize: 10,
    updatedWithinDays: 730,
    cacheTtlMs: 300_000,
  });

  const result = await search.search({ query: '视频加载', signals: [], limit: 10 });

  assert.deepEqual(result.map((candidate) => candidate.id), [20]);
  assert.equal(new URL(fixture.calls[0].url).pathname, '/search.json');
  assert.equal(new URL(fixture.calls[0].url).searchParams.get('q'), '视频加载');
  assert.equal(new URL(fixture.calls[0].url).searchParams.get('issues'), '1');
  assert.equal(fixture.calls.every((call) => call.init.method === 'GET'), true);
});

test('a frozen backend never falls back or expands scope after failure', async () => {
  const fixture = sequenceFetch([jsonResponse({ error: 'not found' }, 404)]);
  const client = createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: fixture.fetch });
  const search = createRedmineIssueSearch({
    client,
    backend: 'rest_search',
    projectId: 77,
    maxPages: 1,
    pageSize: 10,
    updatedWithinDays: 730,
    cacheTtlMs: 300_000,
  });

  await assert.rejects(search.search({ query: 'fixture', signals: [], limit: 10 }), RedmineProbeError);
  assert.equal(fixture.calls.length, 1);
  assert.equal(new URL(fixture.calls[0].url).pathname, '/search.json');
});

test('search enforces candidate and page bounds before issuing requests', async () => {
  const fixture = sequenceFetch([]);
  const client = createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: fixture.fetch });
  assert.throws(() => createRedmineIssueSearch({
    client,
    backend: 'issues_scan',
    projectId: 77,
    maxPages: 0,
    pageSize: 101,
    updatedWithinDays: 0,
    cacheTtlMs: 300_000,
  }), /invalid Redmine search bounds/);

  const search = createRedmineIssueSearch({
    client,
    backend: 'issues_scan',
    projectId: 77,
    maxPages: 1,
    pageSize: 10,
    updatedWithinDays: 30,
    cacheTtlMs: 300_000,
  });
  await assert.rejects(
    search.search({ query: 'fixture', signals: [], limit: 11 }),
    /candidate limit must be between 1 and 10/,
  );
  assert.equal(fixture.calls.length, 0);
});

test('client retries 429 and 5xx at most once and never retries auth or schema failures', async () => {
  for (const status of [429, 503]) {
    const fixture = sequenceFetch([
      jsonResponse({ error: 'transient secret' }, status),
      jsonResponse({ project: { id: 77, identifier: 'itsupportknowledge' } }),
    ]);
    const client = createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: fixture.fetch });
    assert.deepEqual(await client.getProject(), { id: 77, identifier: 'itsupportknowledge' });
    assert.equal(fixture.calls.length, 2);
  }

  for (const response of [
    jsonResponse({ error: 'auth secret' }, 401),
    jsonResponse({ project: { id: 'wrong' } }),
  ]) {
    const fixture = sequenceFetch([response]);
    const client = createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: fixture.fetch });
    await assert.rejects(client.getProject());
    assert.equal(fixture.calls.length, 1);
  }
});

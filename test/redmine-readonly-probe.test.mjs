import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  REDMINE_API_KEY_SECRET,
  runRedmineCommand,
} from '../dist/cli/command-redmine.js';
import { loadConfig } from '../dist/config.js';
import { createRedmineReadonlyClient } from '../dist/mcp-servers/redmine/redmine-api/client.js';
import { runRedmineReadonlyProbe } from '../dist/mcp-servers/redmine/probe.js';

test('redmine secret set stores a confirmed hidden value without printing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-secret-'));
  const writes = [];
  const answers = ['redmine-fixture-secret', 'redmine-fixture-secret'];
  try {
    const ok = await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => answers.shift() ?? '',
      write: (line) => writes.push(line),
    });

    const stored = readFileSync(join(root, 'secrets.json'), 'utf8');
    assert.equal(ok, true);
    assert.match(stored, new RegExp(REDMINE_API_KEY_SECRET.replaceAll('.', '\\.')));
    assert.match(stored, /redmine-fixture-secret/);
    assert.equal(statSync(join(root, 'secrets.json')).mode & 0o777, 0o600);
    assert.equal(writes.join('\n').includes('redmine-fixture-secret'), false);
    assert.deepEqual(writes, ['redmine secret: configured']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redmine secret set rejects empty or mismatched confirmation without writing a secret', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-secret-'));
  try {
    const emptyLines = [];
    assert.equal(await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => '',
      write: (line) => emptyLines.push(line),
    }), false);
    assert.deepEqual(emptyLines, ['redmine secret: failed (empty_secret)']);
    assert.equal(existsSync(join(root, 'secrets.json')), false);

    const answers = ['first-secret', 'second-secret'];
    const mismatchLines = [];
    assert.equal(await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => answers.shift() ?? '',
      write: (line) => mismatchLines.push(line),
    }), false);
    assert.deepEqual(mismatchLines, ['redmine secret: failed (confirmation_mismatch)']);
    assert.equal(existsSync(join(root, 'secrets.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sequenceFetch(responses, calls = []) {
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('unexpected fetch call');
      return response;
    },
  };
}

test('readonly Redmine client sends fixed GET requests and strips content fields', async () => {
  const fixtureSecret = 'redmine-fixture-secret';
  const fixture = sequenceFetch([
    jsonResponse({
      project: {
        id: 77,
        identifier: 'itsupportknowledge',
        name: '00技术支持工单',
        description: 'project description fixture',
      },
    }),
    jsonResponse({
      issues: [{
        id: 118740,
        project: { id: 77, name: '00技术支持工单' },
        subject: 'subject fixture',
        description: 'description fixture',
        assigned_to: { id: 1, name: 'Fixture Person' },
      }],
      total_count: 1,
    }),
    jsonResponse({
      issue: {
        id: 118740,
        project: { id: 77, name: '00技术支持工单' },
        subject: 'subject fixture',
        description: 'description fixture',
        journals: [
          { id: 1, notes: 'private note fixture', user: { name: 'Fixture Person' } },
          { id: 2, notes: 'second note fixture' },
        ],
        relations: [{ id: 9, issue_id: 118740, issue_to_id: 118736 }],
        attachments: [{
          id: 4,
          filename: 'secret.pdf',
          content_url: 'https://redmine.codeages.work/attachments/download/4/secret.pdf',
        }],
      },
    }),
  ]);
  const client = createRedmineReadonlyClient({ apiKey: fixtureSecret, fetchImpl: fixture.fetch });

  const project = await client.getProject();
  const issues = await client.listLatestIssue(project.id);
  const detail = await client.getIssueDetail(issues[0].id, project.id);

  assert.deepEqual(project, { id: 77, identifier: 'itsupportknowledge' });
  assert.deepEqual(issues, [{ id: 118740, projectId: 77 }]);
  assert.deepEqual(detail, {
    projectId: 77,
    journalCount: 2,
    relationCount: 1,
    attachmentCount: 1,
  });
  assert.deepEqual(fixture.calls.map((call) => call.url), [
    'https://redmine.codeages.work/projects/itsupportknowledge.json',
    'https://redmine.codeages.work/issues.json?project_id=77&status_id=*&sort=updated_on%3Adesc&limit=1',
    'https://redmine.codeages.work/issues/118740.json?include=journals%2Crelations%2Cattachments',
  ]);
  for (const call of fixture.calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'error');
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('X-Redmine-API-Key'), fixtureSecret);
    assert.equal(headers.has('X-Redmine-Switch-User'), false);
  }
  const parsed = JSON.stringify({ project, issues, detail });
  for (const forbidden of [
    'subject fixture',
    'description fixture',
    'private note fixture',
    'Fixture Person',
    'secret.pdf',
  ]) {
    assert.equal(parsed.includes(forbidden), false);
  }
});

test('readonly Redmine client maps HTTP failures without reading sensitive bodies', async () => {
  const cases = [
    [401, 'authentication_failed'],
    [403, 'project_forbidden'],
    [404, 'project_not_found'],
    [429, 'rate_limited'],
    [500, 'service_unavailable'],
  ];
  for (const [status, code] of cases) {
    const fixture = sequenceFetch([
      new Response('private response body fixture', { status }),
    ]);
    const client = createRedmineReadonlyClient({
      apiKey: 'redmine-fixture-secret',
      fetchImpl: fixture.fetch,
    });
    await assert.rejects(
      client.getProject(),
      (error) => error?.code === code
        && error.message === code
        && !JSON.stringify(error).includes('private response body fixture'),
    );
  }
});

test('readonly Redmine client rejects scope mismatches and invalid responses safely', async () => {
  const projectMismatch = sequenceFetch([
    jsonResponse({ project: { id: 77, identifier: 'another-project' } }),
  ]);
  await assert.rejects(
    createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: projectMismatch.fetch }).getProject(),
    (error) => error?.code === 'project_scope_mismatch',
  );

  const listMismatch = sequenceFetch([
    jsonResponse({ issues: [{ id: 118740, project: { id: 78 } }] }),
  ]);
  await assert.rejects(
    createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: listMismatch.fetch }).listLatestIssue(77),
    (error) => error?.code === 'project_scope_mismatch',
  );

  const detailMismatch = sequenceFetch([
    jsonResponse({ issue: { id: 118740, project: { id: 78 }, journals: [], relations: [], attachments: [] } }),
  ]);
  await assert.rejects(
    createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: detailMismatch.fetch })
      .getIssueDetail(118740, 77),
    (error) => error?.code === 'project_scope_mismatch',
  );

  const invalidJson = sequenceFetch([
    new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
  ]);
  await assert.rejects(
    createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: invalidJson.fetch }).getProject(),
    (error) => error?.code === 'invalid_response',
  );

  const invalidSchema = sequenceFetch([jsonResponse({ project: { id: '77' } })]);
  await assert.rejects(
    createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: invalidSchema.fetch }).getProject(),
    (error) => error?.code === 'invalid_response',
  );
});

test('readonly Redmine client maps aborts and redirects to safe errors', async () => {
  const timeoutClient = createRedmineReadonlyClient({
    apiKey: 'fixture',
    fetchImpl: async () => { throw new DOMException('aborted fixture', 'AbortError'); },
  });
  await assert.rejects(timeoutClient.getProject(), (error) => error?.code === 'timeout');

  const redirect = sequenceFetch([
    new Response(null, {
      status: 302,
      headers: { location: 'https://example.test/stolen' },
    }),
  ]);
  await assert.rejects(
    createRedmineReadonlyClient({ apiKey: 'fixture', fetchImpl: redirect.fetch }).getProject(),
    (error) => error?.code === 'service_unavailable',
  );
  assert.equal(redirect.calls[0].init.redirect, 'error');
});

function successfulProbeResponses({ issues = true } = {}) {
  return [
    jsonResponse({ project: { id: 77, identifier: 'itsupportknowledge' } }),
    jsonResponse({
      issues: issues ? [{
        id: 118740,
        project: { id: 77 },
        subject: 'subject fixture',
        description: 'description fixture',
      }] : [],
    }),
    ...(issues ? [jsonResponse({
      issue: {
        id: 118740,
        project: { id: 77 },
        subject: 'subject fixture',
        description: 'description fixture',
        journals: [
          { id: 1, notes: 'private note fixture', user: { name: 'Fixture Person' } },
          { id: 2, notes: 'second note fixture' },
        ],
        relations: [{ id: 9, issue_id: 118740, issue_to_id: 118736 }],
        attachments: [{
          id: 4,
          filename: 'secret.pdf',
          content_url: 'https://redmine.codeages.work/attachments/download/4/secret.pdf',
        }],
      },
    })] : []),
  ];
}

test('readonly Redmine probe returns only project and bounded counts', async () => {
  const fixture = sequenceFetch(successfulProbeResponses());

  const result = await runRedmineReadonlyProbe({
    apiKey: 'redmine-fixture-secret',
    fetchImpl: fixture.fetch,
  });

  assert.deepEqual(result, {
    ok: true,
    project: { identifier: 'itsupportknowledge', numericId: 77 },
    issueList: { sampleCount: 1, includesAllStatuses: true },
    issueDetail: {
      status: 'ok',
      journalCount: 2,
      relationCount: 1,
      attachmentCount: 1,
    },
  });
  assert.equal(JSON.stringify(result).includes('118740'), false);
});

test('readonly Redmine probe succeeds without requesting details when the project has no issues', async () => {
  const fixture = sequenceFetch(successfulProbeResponses({ issues: false }));

  const result = await runRedmineReadonlyProbe({
    apiKey: 'redmine-fixture-secret',
    fetchImpl: fixture.fetch,
  });

  assert.deepEqual(result, {
    ok: true,
    project: { identifier: 'itsupportknowledge', numericId: 77 },
    issueList: { sampleCount: 0, includesAllStatuses: true },
    issueDetail: {
      status: 'skipped_no_issue',
      journalCount: 0,
      relationCount: 0,
      attachmentCount: 0,
    },
  });
  assert.equal(fixture.calls.length, 2);
});

test('redmine probe refuses missing credentials before fetch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-probe-'));
  const writes = [];
  let fetchCalls = 0;
  try {
    const ok = await runRedmineCommand({
      argv: ['probe'],
      rootDir: root,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('fetch must not be called');
      },
      write: (line) => writes.push(line),
    });

    assert.equal(ok, false);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(writes, [
      'redmine readonly probe: failed (missing_credentials)',
      '请先执行: super-helper redmine secret set',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redmine probe CLI output excludes ticket content, identities, locators, and credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-probe-'));
  const secretAnswers = ['redmine-fixture-secret', 'redmine-fixture-secret'];
  const writes = [];
  const fixture = sequenceFetch(successfulProbeResponses());
  try {
    assert.equal(await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => secretAnswers.shift() ?? '',
      write: () => undefined,
    }), true);

    const ok = await runRedmineCommand({
      argv: ['probe'],
      rootDir: root,
      fetchImpl: fixture.fetch,
      write: (line) => writes.push(line),
    });

    assert.equal(ok, true);
    assert.deepEqual(writes, [
      'redmine authentication: ok',
      'redmine project: ok (identifier=itsupportknowledge, numericId=77)',
      'redmine issue list: ok (sampleCount=1, includesAllStatuses=true)',
      'redmine issue detail: ok (journals=2, relations=1, attachments=1)',
      'redmine readonly probe: passed',
    ]);
    const output = writes.join('\n');
    for (const forbidden of [
      'redmine-fixture-secret',
      '118740',
      'subject fixture',
      'description fixture',
      'private note fixture',
      'Fixture Person',
      'secret.pdf',
      '/attachments/download/',
    ]) {
      assert.equal(output.includes(forbidden), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redmine source enable and disable safely manage the current workspace integration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-source-'));
  const writes = [];
  try {
    assert.equal(await runRedmineCommand({
      argv: ['source', 'enable'], rootDir: root, mcpEntryPath: '/fixture/redmine-main.js',
      write: (line) => writes.push(line),
    }), true);
    let config = loadConfig(join(root, 'config.json'));
    const server = config.mcpTools.find((item) => item.id === 'company-redmine');
    assert.deepEqual(config.workspaces[0].historicalCaseSources, [{ serverId: 'company-redmine' }]);
    assert.equal(config.workspaces[0].mcpToolIds.includes('company-redmine'), true);
    assert.deepEqual(server.capability, { type: 'historical_case', provider: 'redmine' });
    assert.deepEqual(server.allowedToolNames, ['redmine_search_issues', 'redmine_get_issue_case_details']);
    assert.deepEqual(server.config.env.REDMINE_API_KEY, { source: 'file', key: REDMINE_API_KEY_SECRET });
    assert.deepEqual(server.config.args, ['/fixture/redmine-main.js']);
    assert.equal(config.claude.commandWhitelist.includes(process.execPath), true);
    assert.equal(JSON.stringify(config).includes('redmine-fixture-secret'), false);

    assert.equal(await runRedmineCommand({
      argv: ['source', 'disable'], rootDir: root, mcpEntryPath: '/fixture/redmine-main.js',
      write: (line) => writes.push(line),
    }), true);
    config = loadConfig(join(root, 'config.json'));
    assert.equal(config.workspaces[0].historicalCaseSources, undefined);
    assert.equal(config.workspaces[0].mcpToolIds.includes('company-redmine'), false);
    assert.equal(config.mcpTools.some((item) => item.id === 'company-redmine'), false);
    assert.deepEqual(writes, ['redmine historical source: enabled', 'redmine historical source: disabled']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Redmine readonly spike documents ownership and preserves adapter boundaries', () => {
  const root = process.cwd();
  const development = readFileSync(join(root, 'docs', 'standards', 'development.md'), 'utf8');
  const boundaries = readFileSync(join(root, 'docs', 'standards', 'module-boundaries.md'), 'utf8');
  const overview = readFileSync(join(root, 'docs', 'architecture', 'overview.md'), 'utf8');
  const clientSource = readFileSync(
    join(root, 'src', 'mcp-servers', 'redmine', 'redmine-api', 'client.ts'),
    'utf8',
  );
  const commandSource = readFileSync(join(root, 'src', 'cli', 'command-redmine.ts'), 'utf8');

  assert.match(development, /src\/mcp-servers\/redmine/);
  assert.match(boundaries, /Redmine REST 协议/);
  assert.match(overview, /Redmine 历史案例调查/);
  assert.doesNotMatch(clientSource, /FileSecretsRepository|src\/cli|src\/runtime|src\/gateway/);
  assert.doesNotMatch(commandSource, /X-Redmine-API-Key|\/issues\.json|\/projects\//);
});

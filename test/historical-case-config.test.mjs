import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig } from '../dist/config.js';

function writeConfigFixture(config) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-historical-case-config-'));
  const path = join(root, 'config.json');
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { root, path };
}

function redmineServer(overrides = {}) {
  return {
    id: 'company-redmine',
    name: 'Company Redmine',
    protocol: 'stdio',
    permission: 'read_only',
    enabled: true,
    allowedToolNames: ['redmine_search_issues', 'redmine_get_issue_case_details'],
    capability: { type: 'historical_case', provider: 'redmine' },
    config: { command: 'node', args: ['dist/mcp-servers/redmine/main.js'], env: {} },
    ...overrides,
  };
}

function configWithHistoricalCaseSource() {
  const config = defaultConfig();
  config.mcpTools.push(redmineServer());
  config.workspaces[0].mcpToolIds.push('company-redmine');
  config.workspaces[0].historicalCaseSources = [{ serverId: 'company-redmine' }];
  return config;
}

function withFixture(config, assertion) {
  const fixture = writeConfigFixture(config);
  try {
    assertion(fixture.path);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('historical case config round-trips while legacy workspace remains readable', () => {
  const config = configWithHistoricalCaseSource();
  withFixture(config, (path) => {
    const loaded = loadConfig(path);
    assert.deepEqual(loaded.workspaces[0].historicalCaseSources, [{ serverId: 'company-redmine' }]);
    assert.deepEqual(loaded.mcpTools[0].capability, { type: 'historical_case', provider: 'redmine' });
  });

  const legacy = defaultConfig();
  withFixture(legacy, (path) => {
    assert.equal(loadConfig(path).workspaces[0].historicalCaseSources, undefined);
  });
});

for (const scenario of [
  {
    name: 'unknown server',
    mutate(config) { config.workspaces[0].historicalCaseSources[0].serverId = 'missing'; },
    error: /historical case server not found: missing/,
  },
  {
    name: 'disabled server',
    mutate(config) { config.mcpTools[0].enabled = false; },
    error: /historical case server must be enabled: company-redmine/,
  },
  {
    name: 'read-write server',
    mutate(config) { config.mcpTools[0].permission = 'read_write'; },
    error: /historical case server must be read_only: company-redmine/,
  },
  {
    name: 'server outside workspace allowlist',
    mutate(config) { config.workspaces[0].mcpToolIds = []; },
    error: /historical case server not enabled for workspace: company-redmine/,
  },
  {
    name: 'wrong capability provider',
    mutate(config) { config.mcpTools[0].capability.provider = 'jira'; },
    error: /historical case capability must be historical_case\/redmine: company-redmine/,
  },
  {
    name: 'missing required tool',
    mutate(config) { config.mcpTools[0].allowedToolNames = ['redmine_search_issues']; },
    error: /historical case tools not allowlisted: company-redmine/,
  },
  {
    name: 'multiple sources',
    mutate(config) { config.workspaces[0].historicalCaseSources.push({ serverId: 'company-redmine' }); },
    error: /workspace current supports exactly one historical case source/,
  },
  {
    name: 'source transport fields',
    mutate(config) { config.workspaces[0].historicalCaseSources[0].project = 'other'; },
    error: /historical case source contains unsupported fields: project/,
  },
]) {
  test(`historical case config rejects ${scenario.name}`, () => {
    const config = configWithHistoricalCaseSource();
    scenario.mutate(config);
    withFixture(config, (path) => assert.throws(() => loadConfig(path), scenario.error));
  });
}

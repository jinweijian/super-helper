import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { defaultConfig, saveConfig } from '../dist/config.js';
import {
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
} from '../dist/onboarding/index.js';
import { onboardingDraftFixture } from './helpers/onboarding-fixtures.mjs';

function tempRoot(prefix = 'super-helper-cli-routing-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function writeDisabledProvidersConfig(home) {
  const config = { ...defaultConfig(), embedding: { ...defaultConfig().embedding, enabled: false }, rerank: { ...defaultConfig().rerank, enabled: false } };
  config.storage.rootDir = home;
  config.knowledge.rootDir = join(home, 'knowledge');
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

test('CLI routes status without starting the server', () => {
  const home = tempRoot();
  try {
    const result = runCli(['status', '--home', home]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /config: missing/);
    assert.match(result.stdout, /onboarding: not configured/);
    assert.match(result.stdout, /service: stopped/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLI routes doctor and preserves failing exit code for missing config', () => {
  const home = tempRoot();
  try {
    const result = runCli(['doctor', '--home', home]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /config: error - missing/);
    assert.match(result.stdout, /missing/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLI routes dashboard dry-run server command with binding flags', () => {
  const home = tempRoot();
  try {
    const result = runCli([
      'dashboard',
      '--home',
      home,
      '--dry-run',
      '--no-open',
      '--bind',
      'loopback',
      '--port',
      '44317',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mode: dashboard/);
    assert.match(result.stdout, /listen: 127\.0\.0\.1:44317/);
    assert.match(result.stdout, /url: http:\/\/127\.0\.0\.1:44317\/setup/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard resumes completed onboarding when config completion metadata is missing', () => {
  const home = tempRoot();
  const workspace = tempRoot('super-helper-cli-dashboard-workspace-');
  try {
    const config = defaultConfig();
    config.storage.rootDir = home;
    config.knowledge.rootDir = join(home, 'knowledge');
    saveConfig(config, join(home, 'config.json'));

    const drafts = new FileOnboardingDraftRepository(home);
    const draft = drafts.save(onboardingDraftFixture({
      workspace: { rootPath: workspace },
      knowledge: { rootDir: join(home, 'existing-knowledge') },
      server: { bindMode: 'loopback', port: 44318 },
    }));
    const validatedDraft = { ...draft, updatedAt: '2026-06-29T09:48:35.892Z' };
    writeFileSync(drafts.path, `${JSON.stringify(validatedDraft, null, 2)}\n`);
    const runs = new FileOnboardingRunRepository(home);
    runs.save({
      id: 'run_completed',
      status: 'completed',
      draftRevision: draft.revision,
      overallProgress: 100,
      stages: [],
      counters: {},
      startedAt: '2026-06-29T09:48:05.826Z',
      updatedAt: '2026-06-29T09:48:58.868Z',
      completedAt: '2026-06-29T09:48:58.868Z',
    });

    const result = runCli([
      'dashboard',
      '--home',
      home,
      '--dry-run',
      '--no-open',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mode: dashboard/);
    assert.match(result.stdout, /url: http:\/\/127\.0\.0\.1:44318\//);
    assert.doesNotMatch(result.stdout, /\/setup/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLI routes retrieval debug through configured retrieval with workspace and knowledge-root flags', () => {
  const workspace = tempRoot('super-helper-cli-workspace-');
  const knowledgeRoot = join(workspace, 'knowledge-root');
  try {
    const result = runCli([
      'retrieval',
      'debug',
      '--workspace',
      workspace,
      '--knowledge-root',
      knowledgeRoot,
      '--query',
      'missing answer',
      '--limit',
      '2',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.query, 'missing answer');
    assert.equal(parsed.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(parsed.trace.strategies.find((item) => item.id === 'embedding')?.status, 'skipped');
    assert.equal(parsed.trace.rerank.status, 'skipped');
    assert.deepEqual(parsed.candidates, []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI does not register removed knowledge query and eval commands', () => {
  const workspace = tempRoot('super-helper-cli-removed-knowledge-');
  const knowledgeRoot = join(workspace, 'knowledge-root');
  try {
    const search = runCli([
      'knowledge',
      'search',
      '--workspace',
      workspace,
      '--knowledge-root',
      knowledgeRoot,
      '--query',
      'missing answer',
    ]);
    assert.equal(search.status, 1);
    assert.match(search.stderr, /Usage: super-helper knowledge/);
    assert.doesNotMatch(search.stderr, /knowledge search/);

    const evaluation = runCli([
      'knowledge',
      'eval',
      '--workspace',
      workspace,
      '--knowledge-root',
      knowledgeRoot,
      '--questions',
      'missing.json',
    ]);
    assert.equal(evaluation.status, 1);
    assert.match(evaluation.stderr, /Usage: super-helper knowledge/);
    assert.doesNotMatch(evaluation.stderr, /knowledge eval/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI routes embedding and rerank smoke tests without network when disabled', () => {
  const home = tempRoot();
  try {
    writeDisabledProvidersConfig(home);
    const embedding = runCli(['embedding', 'test', '--home', home]);
    assert.equal(embedding.status, 0, embedding.stderr);
    assert.match(embedding.stdout, /embedding disabled/);
    assert.match(embedding.stdout, /provider: siliconflow/);

    const rerank = runCli(['rerank', 'test', '--home', home]);
    assert.equal(rerank.status, 0, rerank.stderr);
    assert.match(rerank.stdout, /rerank disabled/);
    assert.match(rerank.stdout, /provider: siliconflow/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('provider smoke CLI reads existing config without rewriting it', () => {
  const home = tempRoot();
  try {
    writeDisabledProvidersConfig(home);
    const path = join(home, 'config.json');
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(path, oldDate, oldDate);
    const before = {
      content: readFileSync(path, 'utf8'),
      mtimeMs: statSync(path).mtimeMs,
    };

    const result = runCli(['embedding', 'test', '--home', home]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /embedding disabled/);
    assert.equal(readFileSync(path, 'utf8'), before.content);
    assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('init reads existing config without rewriting it', () => {
  const userHome = tempRoot('super-helper-cli-init-home-');
  const home = join(userHome, '.super-helper');
  try {
    const config = defaultConfig();
    config.storage.rootDir = home;
    config.knowledge.rootDir = join(home, 'knowledge');
    config.onboarding = {
      version: 1,
      completedAt: '2026-06-29T09:48:58.868Z',
      lastRunId: 'run_completed',
    };
    saveConfig(config, join(home, 'config.json'));
    const path = join(home, 'config.json');
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(path, oldDate, oldDate);
    const before = {
      content: readFileSync(path, 'utf8'),
      mtimeMs: statSync(path).mtimeMs,
    };

    const result = runCli(['init'], { env: { HOME: userHome } });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`super helper config ready at ${escapeRegExp(path)}`));
    assert.equal(readFileSync(path, 'utf8'), before.content);
    assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  } finally {
    rmSync(userHome, { recursive: true, force: true });
  }
});

test('dashboard startup reads config without rewriting it when no migration is needed', async () => {
  const home = tempRoot();
  try {
    const config = defaultConfig();
    config.storage.rootDir = home;
    config.knowledge.rootDir = join(home, 'knowledge');
    config.server.bindMode = 'loopback';
    config.server.host = '127.0.0.1';
    config.server.port = 0;
    config.onboarding = {
      version: 1,
      completedAt: '2026-06-29T09:48:58.868Z',
      lastRunId: 'run_completed',
    };
    config.embedding.apiKeyRef = { source: 'env', name: 'SILICONFLOW_API_KEY' };
    config.rerank.apiKeyRef = { source: 'env', name: 'SILICONFLOW_API_KEY' };
    saveConfig(config, join(home, 'config.json'));
    const path = join(home, 'config.json');
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(path, oldDate, oldDate);
    const before = {
      content: readFileSync(path, 'utf8'),
      mtimeMs: statSync(path).mtimeMs,
    };

    const child = spawn(process.execPath, [
      'dist/cli.js',
      'dashboard',
      '--home',
      home,
      '--no-open',
      '--bind',
      'loopback',
      '--port',
      '0',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    try {
      const output = await waitForOutput(child, /super helper running at http:\/\/127\.0\.0\.1:\d+\//);
      assert.match(output, /mode: dashboard/);
    } finally {
      child.kill('SIGTERM');
      await waitForExit(child);
    }

    assert.equal(readFileSync(path, 'utf8'), before.content);
    assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('knowledge CLI preserves invalid quality gate, disabled vector, and unknown subcommand exits', () => {
  const workspace = tempRoot('super-helper-cli-knowledge-errors-');
  const knowledgeRoot = join(workspace, 'knowledge-root');
  try {
    const invalidGate = runCli([
      'knowledge',
      'update',
      '--workspace',
      workspace,
      '--knowledge-root',
      knowledgeRoot,
      '--quality-gate',
      'invalid',
    ]);
    assert.equal(invalidGate.status, 1);
    assert.match(invalidGate.stderr, /Invalid --quality-gate\. Expected warn\|strict\|off\./);

    const disabledVector = runCli([
      'knowledge',
      'vector',
      'build',
      '--workspace',
      workspace,
      '--knowledge-root',
      knowledgeRoot,
    ]);
    // 默认 enabled=true 但无 API key 且无 chunks 时优雅完成：不调用网络，返回 0 向量。
    assert.equal(disabledVector.status, 0, disabledVector.stderr);
    assert.match(disabledVector.stdout, /vectors: 0/);

    const unknown = runCli(['knowledge', 'does-not-exist', '--workspace', workspace, '--knowledge-root', knowledgeRoot]);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Usage: super-helper knowledge/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for ${pattern}; output was:\n${output}`));
    }, 5000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (pattern.test(output)) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!pattern.test(output)) {
        clearTimeout(timeout);
        reject(new Error(`process exited with ${code}; output was:\n${output}`));
      }
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('CLI preserves unknown command exit behavior and usage output', () => {
  const result = runCli(['does-not-exist']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: does-not-exist/);
  assert.match(result.stderr, /Usage: super-helper/);
});

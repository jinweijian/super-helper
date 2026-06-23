import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function tempRoot(prefix = 'super-helper-cli-routing-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runCli(args) {
  return spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
  });
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

test('CLI routes knowledge search with workspace and knowledge-root flags', () => {
  const workspace = tempRoot('super-helper-cli-workspace-');
  const knowledgeRoot = join(workspace, 'knowledge-root');
  try {
    const result = runCli([
      'knowledge',
      'search',
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
    assert.equal(parsed.query.normalized_question, 'missinganswer');
    assert.deepEqual(parsed.query.keywords, ['missinganswer']);
    assert.deepEqual(parsed.results, []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI routes embedding and rerank smoke tests without network when disabled', () => {
  const home = tempRoot();
  try {
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
    assert.equal(disabledVector.status, 1);
    assert.match(disabledVector.stdout, /embedding disabled/);
    assert.match(disabledVector.stdout, /provider: siliconflow/);

    const unknown = runCli(['knowledge', 'does-not-exist', '--workspace', workspace, '--knowledge-root', knowledgeRoot]);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Usage: super-helper knowledge/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI preserves unknown command exit behavior and usage output', () => {
  const result = runCli(['does-not-exist']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: does-not-exist/);
  assert.match(result.stderr, /Usage: super-helper/);
});

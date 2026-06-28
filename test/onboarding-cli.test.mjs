import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { resolveServerBinding } from '../dist/cli/bindings.js';
import { runDoctorCommand } from '../dist/cli/command-doctor.js';
import { runStatusCommand } from '../dist/cli/command-status.js';
import { defaultConfig, saveConfig } from '../dist/config.js';
import { FileOnboardingRunRepository } from '../dist/onboarding/index.js';

test('binding resolves loopback, lan, and explicit host precedence', () => {
  assert.equal(resolveServerBinding({ bind: 'loopback' }).listenHost, '127.0.0.1');
  assert.equal(resolveServerBinding({ bind: 'lan' }).listenHost, '0.0.0.0');
  assert.equal(resolveServerBinding({ bind: 'lan', host: '192.168.1.20' }).listenHost, '192.168.1.20');
  assert.equal(resolveServerBinding({ bind: 'lan' }).localUrl.startsWith('http://127.0.0.1:'), true);
});

test('status reads persisted onboarding state without starting server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-cli-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.onboarding = {
      version: 1,
      completedAt: '2026-06-15T00:00:00.000Z',
      lastRunId: 'run_cli',
    };
    saveConfig(config, join(root, 'config.json'));
    const runs = new FileOnboardingRunRepository(root);
    runs.save({
      id: 'run_cli',
      status: 'completed',
      draftRevision: 1,
      overallProgress: 100,
      stages: [],
      counters: {},
      startedAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:01.000Z',
      completedAt: '2026-06-15T00:00:01.000Z',
    });

    const lines = [];
    await runStatusCommand({
      rootDir: root,
      probeHealth: async () => false,
      write: (line) => lines.push(line),
    });

    assert.ok(lines.some((line) => line.includes('onboarding: completed')));
    assert.ok(lines.some((line) => line.includes('knowledge:')));
    assert.ok(lines.some((line) => line.includes('service: stopped')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor reports actionable local checks without exposing secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-doctor-'));
  try {
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(workspaceRoot, { recursive: true });
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.workspaces[0].rootPath = workspaceRoot;
    config.embedding.enabled = false;
    config.rerank.enabled = false;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'fake-agent',
      apiKeyRef: { source: 'env', name: 'SUPER_HELPER_TEST_KEY' },
    };
    config.agent.modelProvider = 'default';
    saveConfig(config, join(root, 'config.json'));

    const lines = [];
    const result = await runDoctorCommand({
      rootDir: root,
      env: { SUPER_HELPER_TEST_KEY: 'fixture-secret' },
      checkClaude: async () => ({ ok: true, version: 'test' }),
      probeHealth: async () => false,
      write: (line) => lines.push(line),
    });

    assert.equal(result.ok, true);
    assert.ok(lines.some((line) => line.includes('workspace: ok')));
    assert.equal(lines.join('\n').includes('fixture-secret'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dashboard lan uses 0.0.0.0 and prints MVP security warning', () => {
  const result = spawnSync(process.execPath, [
    'dist/cli.js',
    'dashboard',
    '--bind',
    'lan',
    '--no-open',
    '--dry-run',
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\.0\.0\.0/);
  assert.match(result.stdout, /可信内网/);
});

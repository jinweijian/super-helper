import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig, saveConfig } from '../dist/config.js';
import {
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
  FileSecretsRepository,
  materializeConfigSecrets,
  migrateLegacyConfigSecrets,
} from '../dist/onboarding/index.js';

test('secret repository stores file secrets outside config and materializes runtime config', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const secrets = new FileSecretsRepository(root);
    const ref = secrets.set('providers.agent.default', 'sk-agent-secret');
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKeyRef: ref,
    };
    config.agent.modelProvider = 'default';

    saveConfig(config, join(root, 'config.json'));
    const persisted = readFileSync(join(root, 'config.json'), 'utf8');
    assert.doesNotMatch(persisted, /sk-agent-secret/);
    assert.match(persisted, /providers\.agent\.default/);
    assert.equal(statSync(join(root, 'secrets.json')).mode & 0o777, 0o600);

    const runtime = materializeConfigSecrets(loadConfig(join(root, 'config.json')), secrets);
    assert.equal(runtime.models.providers.default.apiKey, 'sk-agent-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy inline keys migrate to file SecretRefs without leaking plaintext', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKey: 'legacy-secret',
    };
    config.agent.modelProvider = 'default';
    const secrets = new FileSecretsRepository(root);

    const migrated = migrateLegacyConfigSecrets(config, secrets);
    saveConfig(migrated, join(root, 'config.json'));

    assert.equal(migrated.models.providers.default.apiKey, undefined);
    assert.equal(migrated.models.providers.default.apiKeyRef.key, 'providers.agent.default');
    assert.doesNotMatch(readFileSync(join(root, 'config.json'), 'utf8'), /legacy-secret/);
    assert.equal(secrets.resolve(migrated.models.providers.default.apiKeyRef), 'legacy-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('draft repository increments revision and persists provider refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingDraftRepository(root);
    const saved = repository.save({
      version: 1,
      revision: 0,
      workspace: { id: 'current', name: 'Demo', rootPath: '/tmp/demo' },
      knowledge: { rootDir: '/tmp/kb', sourceDir: '/tmp/sources', buildVectorIndex: true },
      server: { bindMode: 'loopback', port: 4317 },
      agent: {
        providerId: 'default',
        provider: {
          type: 'openai-compatible',
          baseUrl: 'https://api.test/v1',
          model: 'm',
          apiKeyRef: { source: 'file', key: 'providers.agent.default' },
        },
      },
      embedding: {
        enabled: false,
        provider: 'fake',
        model: 'e',
        dimensions: 4,
        distance: 'cosine',
      },
      rerank: { enabled: false, provider: 'siliconflow', model: 'r' },
      updatedAt: new Date().toISOString(),
    });
    assert.equal(saved.revision, 1);
    assert.equal(repository.load().workspace.name, 'Demo');
    assert.match(readFileSync(join(root, 'onboarding', 'draft.json'), 'utf8'), /providers\.agent\.default/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('draft repository rejects plaintext provider secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingDraftRepository(root);
    assert.throws(() => repository.save({
      version: 1,
      revision: 0,
      workspace: { id: 'current', name: 'Demo', rootPath: '/tmp/demo' },
      knowledge: { rootDir: '/tmp/kb', buildVectorIndex: false },
      server: { bindMode: 'loopback', port: 4317 },
      agent: {
        providerId: 'default',
        provider: {
          type: 'openai-compatible',
          baseUrl: 'https://api.test/v1',
          model: 'm',
          apiKey: 'must-not-persist',
        },
      },
      embedding: {
        enabled: false,
        provider: 'fake',
        model: 'e',
        dimensions: 4,
        distance: 'cosine',
      },
      rerank: { enabled: false, provider: 'siliconflow', model: 'r' },
      updatedAt: new Date().toISOString(),
    }), /plaintext secrets/);
    assert.equal(repository.load(), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run repository recovers interrupted runs as retryable failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingRunRepository(root);
    repository.save({
      id: 'run_test',
      status: 'running',
      draftRevision: 1,
      currentStage: 'slice_sources',
      overallProgress: 45,
      stages: [],
      counters: {},
      startedAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const recovered = repository.recoverInterrupted();
    assert.equal(recovered[0].status, 'failed');
    assert.equal(recovered[0].retryableStage, 'slice_sources');
    assert.equal(recovered[0].safeError.code, 'interrupted');
    assert.equal(repository.load('run_test').status, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

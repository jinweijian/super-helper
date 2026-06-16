import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig, saveConfig } from '../dist/config.js';
import {
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
  FileSecretsRepository,
  buildOnboardingPlan,
  materializeConfigSecrets,
  migrateLegacyConfigSecrets,
  runOnboardingKnowledgePipeline,
  testOnboardingProviders,
  validateOnboardingDraft,
} from '../dist/onboarding/index.js';
import {
  embeddingFixture,
  onboardingDraftFixture,
} from './helpers/onboarding-fixtures.mjs';

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

test('validator reports missing workspace and enabled provider credentials', () => {
  const draft = onboardingDraftFixture({
    workspace: { id: 'current', name: 'Demo', rootPath: '/does/not/exist' },
    embedding: {
      ...embeddingFixture(),
      enabled: true,
      provider: 'siliconflow',
      apiKeyRef: undefined,
    },
  });
  const result = validateOnboardingDraft(draft, { resolveSecret: () => undefined });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === 'workspace.rootPath'));
  assert.ok(result.issues.some((issue) => issue.field === 'embedding.apiKeyRef'));
});

test('planner skips unchanged sources and compatible vector artifacts', () => {
  const plan = buildOnboardingPlan({
    draft: onboardingDraftFixture({
      knowledge: { sourceDir: process.cwd(), buildVectorIndex: true },
      embedding: { enabled: true },
    }),
    sourceChanges: { added: [], changed: [], unchanged: ['a.md'] },
    keywordIndexDirty: false,
    vectorCompatibility: 'compatible',
  });
  assert.equal(plan.stage('ingest_sources').action, 'skip');
  assert.equal(plan.stage('build_keyword_index').action, 'skip');
  assert.equal(plan.stage('build_vector_index').action, 'skip');
});

test('provider test runner reports agent embedding and rerank independently', async () => {
  const calls = [];
  const result = await testOnboardingProviders(onboardingDraftFixture({
    embedding: { enabled: true },
    rerank: { enabled: true },
  }), {
    testAgent: async () => (calls.push('agent'), {
      ok: true,
      model: 'agent',
      durationMs: 1,
    }),
    testEmbedding: async () => (calls.push('embedding'), {
      ok: true,
      model: 'embed',
      durationMs: 1,
      dimensions: 4,
      provider: 'fake',
    }),
    testRerank: async () => (calls.push('rerank'), {
      ok: true,
      model: 'rerank',
      durationMs: 1,
      provider: 'fake',
    }),
  });
  assert.deepEqual(new Set(calls), new Set(['agent', 'embedding', 'rerank']));
  assert.equal(result.ok, true);
  assert.equal(result.agent.ok, true);
});

test('knowledge pipeline reports real file and slice counts', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-pipeline-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-sources-'));
  try {
    writeFileSync(join(sourceDir, 'a.md'), '# A\n\nA complete answer-bearing paragraph for source A.', 'utf8');
    writeFileSync(join(sourceDir, 'b.md'), '# B\n\nA complete answer-bearing paragraph for source B.', 'utf8');
    const events = [];
    const result = await runOnboardingKnowledgePipeline({
      draft: onboardingDraftFixture({
        knowledge: { rootDir: workspaceRoot, sourceDir, buildVectorIndex: false },
      }),
      workspaceRoot,
      report: (event) => events.push(event),
    });
    assert.ok(events.some((event) =>
      event.stage === 'ingest_sources' && event.processed === 2 && event.total === 2));
    assert.ok(result.draftSlices >= 2);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig, saveConfig } from '../dist/config.js';
import {
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
  FileSecretsRepository,
  OnboardingProgressHub,
  OnboardingRunner,
  OnboardingService,
  buildOnboardingPlan,
  createOnboardingRun,
  materializeConfigSecrets,
  migrateLegacyConfigSecrets,
  runOnboardingKnowledgePipeline,
  testOnboardingProviders,
  validateOnboardingDraft,
} from '../dist/onboarding/index.js';
import {
  draftInputFixture,
  embeddingFixture,
  onboardingDraftFixture,
} from './helpers/onboarding-fixtures.mjs';
import { fullOnboardingFixture } from './helpers/full-onboarding-fixture.mjs';

function createServiceFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-service-'));
  const drafts = new FileOnboardingDraftRepository(root);
  const runs = new FileOnboardingRunRepository(root);
  const secrets = new FileSecretsRepository(root);
  const progress = new OnboardingProgressHub();
  const runner = {
    async execute(run) {
      if (options.runnerNeverCompletes) return new Promise(() => {});
      return runs.save({
        ...run,
        status: 'completed',
        overallProgress: 100,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    },
    async retry(id) {
      return this.execute(runs.load(id));
    },
  };
  const config = defaultConfig();
  config.storage.rootDir = root;
  return {
    root,
    secretsPath: join(root, 'secrets.json'),
    service: new OnboardingService({
      config,
      drafts,
      runs,
      secrets,
      progress,
      runner,
      validate: () => ({ ok: true, issues: [] }),
    }),
  };
}

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

test('service stores input secrets as refs and exposes only sanitized draft', async () => {
  const fixture = createServiceFixture();
  try {
    const state = await fixture.service.saveDraft({
      ...draftInputFixture(),
      secrets: {
        agentApiKey: 'agent-secret',
        embeddingApiKey: 'embedding-secret',
        rerankApiKey: 'rerank-secret',
      },
    });
    assert.equal(state.draft.agent.provider.hasApiKey, true);
    assert.equal(JSON.stringify(state).includes('agent-secret'), false);
    assert.equal(readFileSync(fixture.secretsPath, 'utf8').includes('agent-secret'), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('service rejects a second active onboarding run', async () => {
  const fixture = createServiceFixture({ runnerNeverCompletes: true });
  try {
    await fixture.service.saveDraft(draftInputFixture());
    await fixture.service.startRun();
    await assert.rejects(() => fixture.service.startRun(), /already active/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('runner persists real progress and commits only after health succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const order = [];
    const drafts = new FileOnboardingDraftRepository(root);
    const runs = new FileOnboardingRunRepository(root);
    const progress = new OnboardingProgressHub();
    const draft = drafts.save(onboardingDraftFixture({ revision: 0 }));
    const run = createOnboardingRun({
      id: 'run_success',
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: { added: ['a.md'], changed: [], unchanged: [] },
        keywordIndexDirty: true,
        vectorCompatibility: 'missing-index',
      }),
      now: '2026-06-15T00:00:00.000Z',
    });
    runs.save(run);
    const runner = new OnboardingRunner({
      drafts,
      runs,
      progress,
      validate: async () => order.push('validate'),
      testProviders: async () => order.push('providers'),
      prepareWorkspace: async () => order.push('prepare'),
      runKnowledge: async ({ report }) => {
        order.push('knowledge');
        report({ stage: 'slice_sources', processed: 2, total: 4, message: '2/4' });
        return { draftSlices: 4 };
      },
      healthCheck: async () => (order.push('health'), { ok: true }),
      commitConfig: async () => {
        order.push('commit');
        return { ...defaultConfig(), onboarding: { version: 1, lastRunId: run.id } };
      },
      onConfigCommitted: async () => order.push('reload'),
    });
    const completed = await runner.execute(run);
    assert.equal(completed.status, 'completed');
    assert.deepEqual(order, ['validate', 'providers', 'prepare', 'knowledge', 'health', 'commit', 'reload']);
    assert.equal(runs.load(run.id).overallProgress, 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runner failure preserves old config and retries from failed stage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    let attempts = 0;
    const drafts = new FileOnboardingDraftRepository(root);
    const runs = new FileOnboardingRunRepository(root);
    const progress = new OnboardingProgressHub();
    const draft = drafts.save(onboardingDraftFixture({ revision: 0 }));
    const run = createOnboardingRun({
      id: 'run_retry',
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: { added: ['a.md'], changed: [], unchanged: [] },
        keywordIndexDirty: true,
        vectorCompatibility: 'missing-index',
      }),
      now: '2026-06-15T00:00:00.000Z',
    });
    runs.save(run);
    const commitCalls = [];
    const runner = new OnboardingRunner({
      drafts,
      runs,
      progress,
      validate: async () => undefined,
      testProviders: async () => ({ ok: true }),
      prepareWorkspace: async () => undefined,
      runKnowledge: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('slice failed');
        return {};
      },
      healthCheck: async () => ({ ok: true }),
      commitConfig: async () => {
        commitCalls.push('commit');
        return defaultConfig();
      },
    });
    const failed = await runner.execute(run);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.retryableStage, 'ingest_sources');
    assert.equal(commitCalls.length, 0);

    const completed = await runner.retry(failed.id);
    assert.equal(completed.status, 'completed');
    assert.equal(commitCalls.length, 1);
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
    writeFileSync(
      join(sourceDir, 'a.md'),
      '# 账号登录排查\n\n当学员反馈账号无法登录时，需要先确认账号状态、密码错误次数、浏览器缓存和服务端认证日志；如果账号被锁定，运营应记录证据并引导用户完成密码重置。',
      'utf8',
    );
    writeFileSync(
      join(sourceDir, 'b.md'),
      '# 课程退款处理\n\n当学员申请课程退款时，需要检查订单支付状态、课程观看进度、退款窗口和售后凭证；如果满足规则，运营应提交退款记录并通知学员处理结果。',
      'utf8',
    );
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
    assert.ok(events.some((event) => event.stage === 'audit_slices'));
    assert.ok(events.some((event) => event.stage === 'publish_approved'));
    assert.ok(result.draftSlices >= 2);
    assert.ok(result.approvedSlices >= 2);
    assert.equal(result.pendingReviewSlices, 0);
    assert.equal(result.blockedSlices, 0);
    assert.ok(result.publishedSlices >= 2);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('knowledge pipeline reports vector build batch progress', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-pipeline-vector-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-sources-vector-'));
  try {
    writeFileSync(
      join(sourceDir, 'vector.md'),
      '# 课程访问排查\n\n当学员反馈课程无法访问时，需要检查课程发布状态、班级授权、订单支付状态和浏览器缓存；如果授权缺失，运营应补充授权记录并通知学员重新进入课程。',
      'utf8',
    );
    const events = [];
    const result = await runOnboardingKnowledgePipeline({
      draft: onboardingDraftFixture({
        knowledge: { rootDir: workspaceRoot, sourceDir, buildVectorIndex: true },
        embedding: { enabled: true, provider: 'fake', model: 'fake-vector', dimensions: 4, distance: 'cosine', batchSize: 1 },
      }),
      workspaceRoot,
      report: (event) => events.push(event),
    });

    const vectorEvents = events.filter((event) => event.stage === 'build_vector_index');
    assert.ok(vectorEvents.length >= 1);
    assert.deepEqual(
      { processed: vectorEvents.at(-1).processed, total: vectorEvents.at(-1).total },
      { processed: result.vectorCount, total: result.vectorCount },
    );
    assert.ok(result.vectorCount >= 1);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('one dashboard run configures providers, publishes clean knowledge, and commits config', async () => {
  const fixture = await fullOnboardingFixture({
    sources: {
      'login.md': [
        '# 账号登录排查',
        '',
        '当学员反馈账号无法登录时，需要先确认账号状态、密码错误次数、浏览器缓存和服务端认证日志；如果账号被锁定，运营应记录证据并引导用户完成密码重置。',
      ].join('\n'),
      'refund.md': [
        '# 课程退款处理',
        '',
        '当学员申请课程退款时，需要检查订单支付状态、课程观看进度、退款窗口和售后凭证；如果满足规则，运营应提交退款记录并通知学员处理结果。',
      ].join('\n'),
    },
  });
  try {
    await fixture.saveDraft();
    const run = await fixture.startAndWait();
    assert.equal(run.status, 'completed', run.safeError?.message);
    assert.equal(run.overallProgress, 100);
    assert.ok(run.counters.indexedDocuments >= 1);
    assert.ok(run.counters.indexedChunks >= 1);
    assert.ok(run.counters.vectorCount >= 1);

    const configJson = readFileSync(fixture.configPath, 'utf8');
    assert.equal(JSON.parse(configJson).onboarding.lastRunId, run.id);
    assert.doesNotMatch(configJson, /fixture-secret/);
    assert.equal(existsSync(join(fixture.knowledgeWorkspace, 'knowledge', 'indexes', 'manifest.json')), true);
    assert.equal(existsSync(join(fixture.knowledgeWorkspace, 'knowledge', 'indexes', 'chunks.jsonl')), true);
    assert.equal(existsSync(join(fixture.knowledgeWorkspace, 'knowledge', 'indexes', 'vector-manifest.json')), true);
  } finally {
    await fixture.close();
  }
});

test('dashboard review accepts warning slices before starting daily use', async () => {
  const fixture = await fullOnboardingFixture({
    sources: {
      'short.md': '# 短切片\n\n内容较短。',
    },
  });
  try {
    await fixture.saveDraft();
    const run = await fixture.startAndWait();
    assert.equal(run.status, 'completed', run.safeError?.message);
    assert.equal(run.counters.pendingReviewSlices, 1);

    const pending = fixture.getReviewState();
    assert.equal(pending.required, true);
    assert.equal(pending.pendingCount, 1);

    const reviewed = await fixture.submitReview({
      action: 'accept_warnings',
      reviewer: 'tester',
      notes: 'accepted warning slice in regression test',
    });
    assert.equal(reviewed.review.required, false);
    assert.equal(reviewed.publishedSlices, 1);
    assert.ok(reviewed.indexedDocuments >= 1);

    const state = fixture.getState();
    assert.equal(state.completed, true);
    assert.equal(state.needsReview, false);
    assert.equal(state.latestRun.counters.pendingReviewSlices, 0);
  } finally {
    await fixture.close();
  }
});

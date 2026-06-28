import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { startServer } from '../dist/gateway/http-server.js';
import { renderSetupApp } from '../dist/setup-ui.js';
import { draftInputFixture } from './helpers/onboarding-fixtures.mjs';

class FakeOnboardingService {
  constructor(completed = false, needsReview = false) {
    this.completed = completed;
    this.review = {
      required: needsReview,
      pendingCount: needsReview ? 1 : 0,
      blockedCount: 0,
      items: needsReview ? [{
        id: 'drf_pending',
        sourceDocumentId: 'src_pending',
        title: 'Pending slice',
        module: 'general',
        path: 'knowledge/_pipeline/drafts/src_pending/001.md',
        qualitySeverity: 'warn',
        issues: [],
        excerptPreview: 'preview',
      }] : [],
    };
    this.draft = undefined;
    this.run = undefined;
    this.listeners = new Set();
    this.lastReviewQuery = undefined;
  }
  getState() {
    return { completed: this.completed, needsReview: this.review.required, draft: this.draft, latestRun: this.run, review: this.review };
  }
  getReviewState(query) {
    this.lastReviewQuery = query;
    return this.review;
  }
  async submitReview() {
    this.review = { required: false, pendingCount: 0, blockedCount: 0, items: [] };
    return { review: this.review, publishedSlices: 1, indexedDocuments: 1, indexedChunks: 1 };
  }
  async saveDraft(input) {
    this.draft = {
      ...input.draft,
      agent: {
        ...input.draft.agent,
        provider: { ...input.draft.agent.provider, hasApiKey: Boolean(input.secrets?.agentApiKey) },
      },
    };
    return this.getState();
  }
  async validateDraft() {
    return { ok: true, issues: [] };
  }
  async startRun() {
    this.run = {
      id: 'run_http',
      status: 'running',
      draftRevision: 1,
      overallProgress: 1,
      stages: [],
      counters: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.run;
  }
  getRun(id) {
    return this.run?.id === id ? this.run : undefined;
  }
  async retryRun(id) {
    if (!this.getRun(id)) throw new Error('run not found');
    return this.startRun();
  }
  subscribe(_id, listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  completeRun() {
    this.run = {
      ...this.run,
      status: 'completed',
      overallProgress: 100,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      listener({ type: 'run.completed', runId: this.run.id, at: this.run.updatedAt, run: this.run });
    }
  }
}

async function startOnboardingServer(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-http-'));
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.server.host = '127.0.0.1';
  config.server.port = 0;
  if (options.completed) config.onboarding.completedAt = new Date().toISOString();
  const service = new FakeOnboardingService(Boolean(options.completed), Boolean(options.needsReview));
  const server = await startServer({ config, onboarding: service });
  return {
    ...server,
    root,
    service,
    startRun: () => service.startRun(),
    completeRun: () => service.completeRun(),
    async close() {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('onboarding HTTP API saves draft, starts run, and restores snapshot', async () => {
  const fixture = await startOnboardingServer();
  try {
    const saved = await fetch(`${fixture.url}/api/onboarding/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draftInputFixture()),
    }).then((res) => res.json());
    assert.equal(saved.draft.workspace.name, 'Demo');

    const started = await fetch(`${fixture.url}/api/onboarding/runs`, {
      method: 'POST',
    }).then((res) => res.json());
    assert.equal(started.run.status, 'running');

    const restored = await fetch(`${fixture.url}/api/onboarding/runs/${started.run.id}`).then((res) => res.json());
    assert.equal(restored.run.id, started.run.id);
  } finally {
    await fixture.close();
  }
});

test('setup UI contains QuickStart, advanced settings, progress, and retry controls', () => {
  const html = renderSetupApp();
  assert.match(html, /QuickStart/);
  assert.match(html, /高级设置/);
  assert.match(html, /id="topN" type="number" value="8"/);
  assert.match(html, /检查并执行/);
  assert.match(html, /EventSource/);
  assert.match(html, /从失败阶段重试/);
  assert.match(html, /可信内网/);
  assert.match(html, /审核知识切片/);
  assert.match(html, /开始使用/);
});

test('setup UI exposes paged multi-select review controls', () => {
  const html = renderSetupApp();
  assert.match(html, /id="reviewSeverity"/);
  assert.match(html, /id="reviewSearch"/);
  assert.match(html, /id="reviewPrevButton"/);
  assert.match(html, /id="reviewNextButton"/);
  assert.match(html, /id="selectReviewPageButton"/);
  assert.match(html, /id="clearReviewSelectionButton"/);
  assert.match(html, /id="acceptSelectedReviewButton"/);
  assert.match(html, /id="requestEditsReviewButton"/);
  assert.match(html, /id="rejectReviewButton"/);
  assert.match(html, /发布选中/);
  assert.match(html, /退回修改/);
  assert.match(html, /不发布选中/);
});

test('setup UI hydrates form fields from onboarding draft snapshot', () => {
  const html = renderSetupApp();
  assert.match(html, /hydrateDraft\(snapshot\.draft\)/);
  assert.match(html, /function hydrateDraft\(draft\)/);
  assert.match(html, /\$\('workspacePath'\)\.value = draft\.workspace\?\.rootPath/);
  assert.match(html, /\$\('agentBaseUrl'\)\.value = draft\.agent\?\.provider\?\.baseUrl/);
  assert.match(html, /\$\('agentKey'\)\.placeholder = draft\.agent\?\.provider\?\.hasApiKey/);
});

test('setup UI exposes the renamed path labels and directory picker buttons', () => {
  const html = renderSetupApp();
  assert.match(html, /项目目录/);
  assert.match(html, /知识库目录/);
  assert.match(html, /知识源目录/);
  assert.match(html, /id="workspacePath"/);
  assert.match(html, /id="knowledgeRoot"/);
  assert.match(html, /id="sourceDir"/);
  assert.match(html, /class="pathBrowse secondary"[\s\S]*?data-target="workspacePath"/);
  assert.match(html, /class="pathBrowse secondary"[\s\S]*?data-target="knowledgeRoot"/);
  assert.match(html, /class="pathBrowse secondary"[\s\S]*?data-target="sourceDir"/);
  assert.match(html, /\/api\/fs\/dirs/);
  assert.match(html, /placeholder="被 super helper 管理的代码根目录/);
  assert.match(html, /placeholder="知识库输出根目录/);
  assert.match(html, /placeholder="放你的产品\/技术文档的地方/);
});

test('root redirects to setup until onboarding is completed', async () => {
  const fixture = await startOnboardingServer({ completed: false });
  try {
    const response = await fetch(`${fixture.url}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/setup');
  } finally {
    await fixture.close();
  }
});

test('root redirects to setup while onboarding review is pending', async () => {
  const fixture = await startOnboardingServer({ completed: true, needsReview: true });
  try {
    const response = await fetch(`${fixture.url}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/setup');
  } finally {
    await fixture.close();
  }
});

test('onboarding review API exposes and clears pending review state', async () => {
  const fixture = await startOnboardingServer({ completed: true, needsReview: true });
  try {
    const pending = await fetch(`${fixture.url}/api/onboarding/review`).then((res) => res.json());
    assert.equal(pending.review.required, true);
    assert.equal(pending.review.pendingCount, 1);

    const reviewed = await fetch(`${fixture.url}/api/onboarding/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'accept_warnings', notes: 'accepted in test' }),
    }).then((res) => res.json());
    assert.equal(reviewed.review.required, false);
    assert.equal(reviewed.publishedSlices, 1);
  } finally {
    await fixture.close();
  }
});

test('onboarding review API passes pagination and filters to service', async () => {
  const fixture = await startOnboardingServer({ completed: true, needsReview: true });
  try {
    const response = await fetch(`${fixture.url}/api/onboarding/review?offset=20&limit=10&severity=warn&search=${encodeURIComponent('登录')}`);
    assert.equal(response.status, 200);
    assert.deepEqual(fixture.service.lastReviewQuery, {
      offset: 20,
      limit: 10,
      severity: 'warn',
      search: '登录',
    });
  } finally {
    await fixture.close();
  }
});

test('onboarding SSE emits named progress events and disconnect does not cancel run', async () => {
  const fixture = await startOnboardingServer();
  try {
    const run = await fixture.startRun();
    const response = await fetch(`${fixture.url}/api/onboarding/runs/${run.id}/events`);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: (run|stage)\./);
    await reader.cancel();
    await fixture.completeRun();
    assert.equal(fixture.service.getRun(run.id).status, 'completed');
  } finally {
    await fixture.close();
  }
});

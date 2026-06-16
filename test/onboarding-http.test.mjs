import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { startServer } from '../dist/server.js';
import { draftInputFixture } from './helpers/onboarding-fixtures.mjs';

class FakeOnboardingService {
  constructor(completed = false) {
    this.completed = completed;
    this.draft = undefined;
    this.run = undefined;
    this.listeners = new Set();
  }
  getState() {
    return { completed: this.completed, draft: this.draft, latestRun: this.run };
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
  const service = new FakeOnboardingService(Boolean(options.completed));
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

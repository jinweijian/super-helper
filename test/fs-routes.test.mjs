import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { startServer } from '../dist/server.js';

class NoopOnboardingService {
  getState() {
    return { completed: true, needsReview: false, draft: null, latestRun: null, review: { required: false, pendingCount: 0, blockedCount: 0, items: [] } };
  }
  getReviewState() {
    return { required: false, pendingCount: 0, blockedCount: 0, items: [] };
  }
  async submitReview() {
    return { review: this.getReviewState(), publishedSlices: 0, indexedDocuments: 0, indexedChunks: 0 };
  }
  async saveDraft(input) {
    return this.getState();
  }
  async validateDraft() {
    return { ok: true, issues: [] };
  }
  async startRun() {
    return {
      run: {
        id: 'run_fs',
        status: 'completed',
        draftRevision: 1,
        overallProgress: 100,
        stages: [],
        counters: {},
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    };
  }
  getRun() {
    return undefined;
  }
  async retryRun() {
    throw new Error('not used');
  }
  subscribe() {
    return () => {};
  }
  recoverInterrupted() {}
}

async function startFsServer() {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-fs-'));
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.server.host = '127.0.0.1';
  config.server.port = 0;
  const server = await startServer({ config, onboarding: new NoopOnboardingService() });
  return {
    url: server.url,
    async close() {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('GET /api/fs/home returns the home directory', async () => {
  const server = await startFsServer();
  try {
    const body = await fetch(`${server.url}/api/fs/home`).then((res) => res.json());
    assert.equal(body.root, resolve(homedir()));
  } finally {
    await server.close();
  }
});

test('GET /api/fs/dirs with no path lists the home directory', async () => {
  const server = await startFsServer();
  try {
    const body = await fetch(`${server.url}/api/fs/dirs`).then((res) => res.json());
    assert.equal(body.root, resolve(homedir()));
    assert.ok(Array.isArray(body.entries));
    assert.equal(body.current, resolve(homedir()));
  } finally {
    await server.close();
  }
});

test('GET /api/fs/dirs lists subdirectories and files separately', async () => {
  const server = await startFsServer();
  try {
    const parent = mkdtempSync(join(homedir(), '.super-helper-fs-parent-'));
    const sandbox = join(parent, 'sandbox');
    mkdirSync(sandbox);
    try {
      mkdirSync(join(sandbox, 'docs'));
      mkdirSync(join(sandbox, 'nested', 'inner'), { recursive: true });
      writeFileSync(join(sandbox, 'README.md'), 'hello');
      const body = await fetch(`${server.url}/api/fs/dirs?path=${encodeURIComponent(sandbox)}`).then((res) => res.json());
      assert.equal(body.current, sandbox);
      const docs = body.entries.find((entry) => entry.name === 'docs');
      const readme = body.entries.find((entry) => entry.name === 'README.md');
      const nested = body.entries.find((entry) => entry.name === 'nested');
      assert.equal(docs?.type, 'dir');
      assert.equal(readme?.type, 'file');
      assert.equal(nested?.type, 'dir');
      assert.equal(body.parent, parent);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  } finally {
    await server.close();
  }
});

test('GET /api/fs/dirs expands ~ to the home directory', async () => {
  const server = await startFsServer();
  try {
    const body = await fetch(`${server.url}/api/fs/dirs?path=${encodeURIComponent('~')}`).then((res) => res.json());
    assert.equal(body.current, resolve(homedir()));
  } finally {
    await server.close();
  }
});

test('GET /api/fs/dirs rejects paths outside the home directory', async () => {
  const server = await startFsServer();
  try {
    const res = await fetch(`${server.url}/api/fs/dirs?path=${encodeURIComponent('/etc')}`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'outside_allowed_root');
  } finally {
    await server.close();
  }
});

test('GET /api/fs/dirs rejects ../ traversal that escapes home', async () => {
  const server = await startFsServer();
  try {
    const insideHome = resolve(homedir(), 'Documents');
    const escaped = join(insideHome, '..', '..', 'etc');
    const res = await fetch(`${server.url}/api/fs/dirs?path=${encodeURIComponent(escaped)}`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'outside_allowed_root');
  } finally {
    await server.close();
  }
});

test('GET /api/fs/dirs returns 404 for non-existent paths under home', async () => {
  const server = await startFsServer();
  try {
    const missing = join(homedir(), '__super_helper_does_not_exist_' + Date.now());
    const res = await fetch(`${server.url}/api/fs/dirs?path=${encodeURIComponent(missing)}`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'not_found');
  } finally {
    await server.close();
  }
});

test('GET /api/fs/dirs returns 400 when path points to a file', async () => {
  const server = await startFsServer();
  try {
    const sandbox = mkdtempSync(join(homedir(), '.super-helper-fs-file-'));
    try {
      const filePath = join(sandbox, 'README.md');
      writeFileSync(filePath, 'hi');
      const res = await fetch(`${server.url}/api/fs/dirs?path=${encodeURIComponent(filePath)}`);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.code, 'not_a_directory');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  } finally {
    await server.close();
  }
});

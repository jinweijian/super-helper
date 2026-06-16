import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadConfig } from '../../dist/config.js';
import { resolveKnowledgeWorkspaceRoot } from '../../dist/knowledge/index.js';
import { createOnboardingService } from '../../dist/onboarding/index.js';
import { draftInputFixture } from './onboarding-fixtures.mjs';

export async function fullOnboardingFixture({ sources }) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-full-onboarding-'));
  const projectRoot = join(root, 'project');
  const sourceDir = join(root, 'sources');
  const configPath = join(root, 'config.json');
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  for (const [name, content] of Object.entries(sources)) {
    writeFileSync(join(sourceDir, name), content, 'utf8');
  }

  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge-store');
  config.server.port = 0;

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'provider smoke test ok' } }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  let runtimeConfig = config;
  const service = createOnboardingService({
    config,
    onConfigCommitted(nextConfig) {
      runtimeConfig = nextConfig;
    },
  });

  return {
    configPath,
    sourceDir,
    get knowledgeWorkspace() {
      const persisted = loadConfig(configPath);
      return resolveKnowledgeWorkspaceRoot(persisted, 'current');
    },
    get runtimeConfig() {
      return runtimeConfig;
    },
    async saveDraft() {
      return service.saveDraft({
        ...draftInputFixture({
          workspace: { id: 'current', name: 'Demo', rootPath: projectRoot },
          knowledge: {
            rootDir: join(root, 'knowledge-store'),
            sourceDir,
            buildVectorIndex: true,
          },
          server: { bindMode: 'loopback', port: 4317 },
          agent: {
            providerId: 'default',
            provider: {
              type: 'openai-compatible',
              baseUrl: 'https://api.example.test/v1',
              model: 'fake-agent',
            },
          },
          embedding: {
            enabled: true,
            provider: 'fake',
            model: 'fake-embedding',
            dimensions: 4,
            distance: 'cosine',
            batchSize: 2,
            timeoutMs: 1000,
          },
          rerank: { enabled: false },
        }),
        secrets: { agentApiKey: 'fixture-secret' },
      });
    },
    async startAndWait() {
      const started = await service.startRun();
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const run = service.getRun(started.id);
        if (run?.status === 'completed' || run?.status === 'failed') return run;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`onboarding run timed out: ${started.id}`);
    },
    async close() {
      globalThis.fetch = previousFetch;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

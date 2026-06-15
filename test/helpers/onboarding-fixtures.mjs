import process from 'node:process';

export function embeddingFixture(overrides = {}) {
  return {
    enabled: false,
    provider: 'fake',
    model: 'fake-embedding',
    dimensions: 4,
    distance: 'cosine',
    batchSize: 2,
    timeoutMs: 1000,
    ...overrides,
  };
}

export function rerankFixture(overrides = {}) {
  return {
    enabled: false,
    provider: 'siliconflow',
    model: 'fake-rerank',
    topN: 2,
    timeoutMs: 1000,
    ...overrides,
  };
}

export function onboardingDraftFixture(overrides = {}) {
  const base = {
    version: 1,
    revision: 1,
    workspace: { id: 'current', name: 'Demo', rootPath: process.cwd() },
    knowledge: { rootDir: `${process.cwd()}/.tmp-knowledge`, buildVectorIndex: false },
    server: { bindMode: 'loopback', port: 4317 },
    agent: {
      providerId: 'default',
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        model: 'fake-agent',
        apiKeyRef: { source: 'file', key: 'providers.agent.default' },
      },
    },
    embedding: embeddingFixture(),
    rerank: rerankFixture(),
    updatedAt: '2026-06-15T00:00:00.000Z',
  };
  return {
    ...base,
    ...overrides,
    workspace: { ...base.workspace, ...(overrides.workspace ?? {}) },
    knowledge: { ...base.knowledge, ...(overrides.knowledge ?? {}) },
    server: { ...base.server, ...(overrides.server ?? {}) },
    agent: {
      ...base.agent,
      ...(overrides.agent ?? {}),
      provider: { ...base.agent.provider, ...(overrides.agent?.provider ?? {}) },
    },
    embedding: { ...base.embedding, ...(overrides.embedding ?? {}) },
    rerank: { ...base.rerank, ...(overrides.rerank ?? {}) },
  };
}

export function draftInputFixture(overrides = {}) {
  const draft = onboardingDraftFixture(overrides);
  const { revision: _revision, updatedAt: _updatedAt, ...inputDraft } = draft;
  const {
    apiKey: _apiKey,
    apiKeyEnv: _apiKeyEnv,
    apiKeyRef: _apiKeyRef,
    ...agentProvider
  } = inputDraft.agent.provider;
  inputDraft.agent.provider = agentProvider;
  delete inputDraft.embedding.apiKey;
  delete inputDraft.embedding.apiKeyRef;
  delete inputDraft.rerank.apiKey;
  delete inputDraft.rerank.apiKeyRef;
  return { draft: inputDraft };
}

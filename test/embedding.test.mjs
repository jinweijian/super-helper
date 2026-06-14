import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig, getEmbeddingConfig, isEmbeddingEnabled } from '../dist/config.js';
import {
  EmbeddingProviderError,
  FakeEmbeddingProvider,
  createEmbeddingProvider,
  embeddingConfigFingerprint,
  isEmbeddingManifestCompatible,
  isEmbeddingProviderError,
  redactEmbeddingErrorMessage,
} from '../dist/embedding/index.js';

test('default config keeps embedding disabled and independent from agent model providers', () => {
  const config = defaultConfig();

  assert.equal(config.embedding.enabled, false);
  assert.equal(config.embedding.provider, 'minimax');
  assert.equal(config.embedding.distance, 'cosine');
  assert.equal(isEmbeddingEnabled(config), false);
  assert.equal(getEmbeddingConfig(config).provider, 'minimax');

  config.models.providers.agent = {
    type: 'openai-compatible',
    baseUrl: 'https://model.example.test/v1',
    model: 'chat-model',
    apiKeyEnv: 'MODEL_API_KEY',
  };
  config.agent.modelProvider = 'agent';
  config.embedding = {
    ...config.embedding,
    enabled: true,
    provider: 'fake',
    model: 'fake-embedding',
    dimensions: 8,
  };

  assert.equal(config.agent.modelProvider, 'agent');
  assert.equal(config.embedding.provider, 'fake');
});

test('fake embedding provider returns deterministic vectors with stable metadata', async () => {
  const provider = new FakeEmbeddingProvider({
    provider: 'fake',
    model: 'fake-embedding-v1',
    dimensions: 6,
    distance: 'cosine',
  });

  const first = await provider.embedDocuments([
    { id: 'chunk_a', text: '课程必须发布后学员端才可见', contentHash: 'hash-a' },
    { id: 'chunk_b', text: '学习日晚上8点未完成任务会提醒', contentHash: 'hash-b' },
  ]);
  const second = await provider.embedDocuments([
    { id: 'chunk_a', text: '课程必须发布后学员端才可见', contentHash: 'hash-a' },
  ]);
  const query = await provider.embedQuery({ id: 'query_1', text: '晚上8点提醒规则' });

  assert.equal(first.results.length, 2);
  assert.equal(first.results[0].id, 'chunk_a');
  assert.equal(first.results[0].provider, 'fake');
  assert.equal(first.results[0].model, 'fake-embedding-v1');
  assert.equal(first.results[0].dimensions, 6);
  assert.equal(first.results[0].distance, 'cosine');
  assert.equal(first.results[0].vector.length, 6);
  assert.deepEqual(first.results[0].vector, second.results[0].vector);
  assert.equal(query.id, 'query_1');
  assert.equal(query.vector.length, 6);
  assert.equal(first.usage?.providerRequestCount, 1);
});

test('provider factory validates config and keeps unsupported providers safe', async () => {
  assert.throws(
    () => createEmbeddingProvider({
      enabled: true,
      provider: 'unknown',
      model: 'x',
      dimensions: 3,
      distance: 'cosine',
    }),
    (error) => isEmbeddingProviderError(error) && error.code === 'unsupported_provider',
  );

  assert.throws(
    () => createEmbeddingProvider({
      enabled: true,
      provider: 'fake',
      model: 'fake',
      dimensions: 0,
      distance: 'cosine',
    }),
    (error) => isEmbeddingProviderError(error) && error.code === 'invalid_request',
  );

  const qwen = createEmbeddingProvider({
    enabled: true,
    provider: 'qwen',
    model: 'text-embedding-v4',
    dimensions: 4,
    distance: 'cosine',
  });
  await assert.rejects(
    () => qwen.embedQuery({ text: 'reserved provider' }),
    (error) => isEmbeddingProviderError(error) && error.code === 'unsupported_provider',
  );
});

test('minimax provider is docs-gated and does not guess network calls', async () => {
  let fetchCalled = false;
  const provider = createEmbeddingProvider({
    enabled: true,
    provider: 'minimax',
    model: 'minimax-embedding-placeholder',
    dimensions: 4,
    distance: 'cosine',
    apiKey: 'secret-token-should-not-leak',
  }, {
    fetch: async () => {
      fetchCalled = true;
      throw new Error('network should not be called');
    },
  });

  await assert.rejects(
    () => provider.embedQuery({ text: 'hello' }),
    (error) => (
      isEmbeddingProviderError(error) &&
      error.code === 'docs_required' &&
      !String(error.safeMessage).includes('secret-token-should-not-leak') &&
      !String(error.message).includes('secret-token-should-not-leak')
    ),
  );
  assert.equal(fetchCalled, false);
});

test('embedding error helpers redact secrets from nested values', () => {
  const error = new EmbeddingProviderError({
    provider: 'minimax',
    code: 'provider_error',
    retryable: false,
    status: 401,
    safeMessage: 'Authorization: Bearer sk-test-secret cookie=sessionid token=abc1234567890',
    cause: {
      apiKey: 'sk-test-secret',
      headers: { Authorization: 'Bearer another-secret', cookie: 'sid=private' },
    },
  });

  const redacted = redactEmbeddingErrorMessage(error);

  assert.match(redacted, /\[REDACTED\]/);
  assert.doesNotMatch(redacted, /sk-test-secret/);
  assert.doesNotMatch(redacted, /another-secret/);
  assert.doesNotMatch(redacted, /sid=private/);
});

test('embedding metadata fingerprint excludes secrets and compatibility reports mismatches', () => {
  const config = {
    enabled: true,
    provider: 'fake',
    model: 'fake-embedding-v1',
    dimensions: 6,
    distance: 'cosine',
    apiKey: 'secret-value',
    endpoint: 'https://example.test/embed',
  };

  const fingerprint = embeddingConfigFingerprint(config);
  assert.match(fingerprint, /fake/);
  assert.match(fingerprint, /fake-embedding-v1/);
  assert.doesNotMatch(fingerprint, /secret-value/);

  assert.equal(isEmbeddingManifestCompatible({
    provider: 'fake',
    model: 'fake-embedding-v1',
    dimensions: 6,
    distance: 'cosine',
  }, config).compatible, true);

  const mismatch = isEmbeddingManifestCompatible({
    provider: 'fake',
    model: 'other-model',
    dimensions: 6,
    distance: 'cosine',
  }, config);
  assert.equal(mismatch.compatible, false);
  assert.deepEqual(mismatch.mismatches, ['model']);
});

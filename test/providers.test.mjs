import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmbeddingProvider,
  runEmbeddingSmokeTest,
} from '../dist/providers/embedding/index.js';
import {
  createRerankProvider,
  runRerankSmokeTest,
} from '../dist/providers/rerank/index.js';
import {
  formatProviderSafeError,
  isProviderError,
} from '../dist/providers/index.js';

test('embedding provider module exposes direct factory and smoke test boundaries', async () => {
  const config = {
    enabled: true,
    provider: 'fake',
    model: 'fake-provider-module',
    dimensions: 4,
    distance: 'cosine',
  };
  const provider = createEmbeddingProvider(config);
  const vector = await provider.embedQuery({ text: 'provider boundary smoke' });
  const smoke = await runEmbeddingSmokeTest({ config });

  assert.equal(provider.id, 'fake');
  assert.equal(vector.vector.length, 4);
  assert.equal(smoke.ok, true);
  assert.equal(smoke.provider, 'fake');
});

test('rerank provider module exposes direct factory and smoke test boundaries', async () => {
  const config = {
    enabled: true,
    provider: 'fake',
    model: 'fake-rerank-provider-module',
    topN: 1,
  };
  const provider = createRerankProvider(config);
  const result = await provider.rerank({
    query: 'alpha',
    documents: [
      { id: 'a', text: 'alpha match' },
      { id: 'b', text: 'beta other' },
    ],
  });
  const smoke = await runRerankSmokeTest({ config });

  assert.equal(provider.id, 'fake');
  assert.deepEqual(result.results.map((item) => item.id), ['a']);
  assert.equal(smoke.ok, true);
  assert.equal(smoke.provider, 'fake');
});

test('provider root errors are shared and redacted across capabilities', () => {
  assert.throws(
    () => createEmbeddingProvider({
      enabled: true,
      provider: 'unknown',
      model: 'x',
      dimensions: 3,
      distance: 'cosine',
    }),
    (error) => (
      isProviderError(error) &&
      error.code === 'unsupported_provider' &&
      !formatProviderSafeError(error).includes('sk-secret')
    ),
  );
});

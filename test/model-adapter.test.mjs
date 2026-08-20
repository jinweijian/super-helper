import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelClient } from '../dist/providers/model/adapter.js';

test('DeepSeek model requests can disable thinking without leaking the vendor option to other providers', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const deepseek = createModelClient({
      type: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
    });
    const compatible = createModelClient({
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'test-key',
      model: 'example-model',
    });

    await deepseek.complete([{ role: 'user', content: 'json' }], { json: true });
    await deepseek.complete([{ role: 'user', content: 'json' }], { json: true, thinking: 'enabled' });
    await compatible.complete([{ role: 'user', content: 'json' }], { json: true, thinking: 'disabled' });

    assert.deepEqual(requests[0].body.thinking, { type: 'disabled' });
    assert.deepEqual(requests[1].body.thinking, { type: 'enabled' });
    assert.equal('thinking' in requests[2].body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

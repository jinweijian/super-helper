import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createExperienceIndexProvider } from '../dist/providers/experience-index/index.js';
import { isProviderError } from '../dist/providers/index.js';

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function provider(baseUrl) {
  return createExperienceIndexProvider({
    enabled: true,
    provider: 'cognee',
    baseUrl,
    token: 'synthetic-token',
    timeoutMs: 100,
  });
}

const query = {
  query: '缓存配置为什么没有生效',
  datasetId: '11111111-1111-4111-8111-111111111111',
  topK: 3,
};

test('Cognee query sends bounded context-only request and maps source references', async () => {
  await withServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      assert.equal(request.headers.authorization, 'Bearer synthetic-token');
      assert.deepEqual(parsed, {
        query: query.query,
        search_type: 'CHUNKS',
        dataset_ids: [query.datasetId],
        top_k: 3,
        only_context: true,
        context_format: 'context',
        verbose: true,
        include_references: true,
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{
        dataset_id: query.datasetId,
        context_result: ['缓存配置需在重启后重新加载。'],
        evidence: [{
          kind: 'segment',
          artifact_id: 'chunk-1',
          dataset_id: query.datasetId,
          data_id: '22222222-2222-4222-8222-222222222222',
          chunk_id: 'chunk-1',
          rank: 0,
          score: 0.91,
        }],
      }]));
    });
  }, async (baseUrl) => {
    const result = await provider(baseUrl).query(query);
    assert.equal(result.status, 'completed');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].source.dataId, '22222222-2222-4222-8222-222222222222');
    assert.equal(result.candidates[0].text, '缓存配置需在重启后重新加载。');
  });
});

test('Cognee query rejects authentication failure without exposing response body', async () => {
  await withServer((_request, response) => {
    response.statusCode = 403;
    response.end('secret upstream detail sk-sensitive');
  }, async (baseUrl) => {
    await assert.rejects(provider(baseUrl).query(query), (error) => (
      isProviderError(error) && error.code === 'missing_credentials' && !error.message.includes('sk-sensitive')
    ));
  });
});

test('Cognee query timeout covers delayed response body', async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('[');
    setTimeout(() => response.end(']'), 250);
  }, async (baseUrl) => {
    await assert.rejects(provider(baseUrl).query(query, { timeoutMs: 30 }), (error) => (
      isProviderError(error) && error.code === 'timeout'
    ));
  });
});

test('Cognee query distinguishes caller cancellation from timeout', async () => {
  await withServer((_request, response) => {
    setTimeout(() => response.end('[]'), 250);
  }, async (baseUrl) => {
    const controller = new AbortController();
    const pending = provider(baseUrl).query(query, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => isProviderError(error) && error.code === 'cancelled');
  });
});

test('Cognee query rejects an already cancelled request before transport starts', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const index = createExperienceIndexProvider({
    enabled: true,
    provider: 'cognee',
    baseUrl: 'https://cognee.invalid',
    token: 'synthetic-token',
  }, {
    fetch: async () => {
      calls += 1;
      return new Response('[]');
    },
  });

  await assert.rejects(index.query(query, { signal: controller.signal }), (error) => (
    isProviderError(error) && error.code === 'cancelled'
  ));
  assert.equal(calls, 0);
});

test('Cognee query rejects malformed and source-less responses', async (t) => {
  await t.test('malformed JSON', async () => {
    await withServer((_request, response) => response.end('{broken'), async (baseUrl) => {
      await assert.rejects(provider(baseUrl).query(query), (error) => (
        isProviderError(error) && error.code === 'malformed_response'
      ));
    });
  });
  await t.test('candidate without data reference', async () => {
    await withServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{
        dataset_id: query.datasetId,
        context_result: ['没有来源的生成摘要'],
        evidence: [],
      }]));
    }, async (baseUrl) => {
      await assert.rejects(provider(baseUrl).query(query), (error) => (
        isProviderError(error) && error.code === 'malformed_response'
      ));
    });
  });
});

test('Cognee provider exposes the governed dataset lifecycle without a delete-all operation', async () => {
  const datasetId = query.datasetId;
  const dataId = '22222222-2222-4222-8222-222222222222';
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ id: datasetId, name: 'generation-1' }), { status: 200 }),
    new Response(JSON.stringify({ pipeline_run_id: 'run-add', status: 'PipelineRunCompleted' }), { status: 200 }),
    new Response(JSON.stringify({ [datasetId]: { pipeline_run_id: 'run-build', status: 'PipelineRunStarted' } }), { status: 200 }),
    new Response(JSON.stringify({ [datasetId]: 'completed' }), { status: 200 }),
    new Response(JSON.stringify([{ id: dataId, name: 'exp.md', datasetId, externalMetadata: {
      experience_id: 'exp-1', revision: 'r1', content_hash: 'hash-1',
    } }]), { status: 200 }),
    new Response(new TextEncoder().encode('# experience'), { status: 200 }),
    new Response(null, { status: 204 }),
  ];
  const index = createExperienceIndexProvider({
    enabled: true,
    provider: 'cognee',
    baseUrl: 'https://cognee.invalid',
    token: 'synthetic-token',
  }, {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return responses.shift();
    },
  });

  assert.deepEqual(await index.createDataset('generation-1'), { id: datasetId, name: 'generation-1' });
  assert.equal((await index.ingest(datasetId, {
    fileName: 'exp.md', markdown: '# experience', experienceId: 'exp-1', revision: 'r1', contentHash: 'hash-1',
  })).runId, 'run-add');
  assert.equal((await index.startBuild(datasetId)).runId, 'run-build');
  assert.equal(await index.getBuildStatus(datasetId), 'completed');
  assert.equal((await index.listSources(datasetId))[0].metadata.content_hash, 'hash-1');
  assert.equal(new TextDecoder().decode(await index.readSource(datasetId, dataId)), '# experience');
  await index.removeSource(datasetId, dataId);

  assert.equal(calls[1].init.body instanceof FormData, true);
  assert.equal(calls[1].init.body.get('datasetId'), datasetId);
  assert.equal(calls[1].init.body.get('external_metadata'), JSON.stringify([{
    experience_id: 'exp-1', revision: 'r1', content_hash: 'hash-1',
  }]));
  assert.equal(JSON.parse(calls[2].init.body).run_in_background, true);
  assert.match(calls[3].url, /dataset=11111111-1111-4111-8111-111111111111/);
  assert.equal(calls[6].init.method, 'DELETE');
  assert.equal('deleteAll' in index, false);
});

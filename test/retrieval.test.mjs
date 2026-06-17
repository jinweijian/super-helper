import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildKnowledgeVectorIndex } from '../dist/knowledge/index.js';
import {
  createBm25RecallStrategy,
  createEmbeddingRecallStrategy,
  createRetrievalService,
} from '../dist/retrieval/index.js';

function tempWorkspace() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-retrieval-'));
  const indexesRoot = join(workspaceRoot, 'knowledge', 'indexes');
  mkdirSync(indexesRoot, { recursive: true });
  return { workspaceRoot, indexesRoot };
}

function writeChunks(indexesRoot, chunks) {
  writeFileSync(join(indexesRoot, 'chunks.jsonl'), chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n', 'utf8');
}

function baseChunk(overrides) {
  return {
    chunk_id: overrides.chunk_id,
    parent_id: overrides.parent_id ?? overrides.chunk_id.replace(/^chk_/, 'doc_'),
    source: overrides.source ?? `knowledge/faq/${overrides.chunk_id}.md`,
    module: overrides.module ?? 'general',
    intent: overrides.intent ?? 'how_to',
    source_type: overrides.source_type ?? 'faq',
    status: overrides.status ?? 'active',
    confidence: overrides.confidence ?? 'high',
    visibility: overrides.visibility ?? 'internal',
    headings: overrides.headings ?? [],
    keywords: overrides.keywords ?? [],
    text: overrides.text,
  };
}

test('BM25-only retrieval recalls local chunks without embedding provider', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_reminder',
        keywords: ['reminder', 'deadline'],
        text: 'Learning day deadline reminders are sent at 8pm when tasks are incomplete.',
      }),
      baseChunk({
        chunk_id: 'chk_invoice',
        keywords: ['invoice'],
        text: 'Invoices are exported from the billing workspace after reconciliation.',
      }),
    ]);

    const service = createRetrievalService({
      strategies: [createBm25RecallStrategy()],
    });
    const result = await service.retrieve({
      workspaceRoot,
      query: 'when does the 8pm task reminder happen',
      limit: 2,
    });

    assert.equal(result.candidates[0].chunkId, 'chk_reminder');
    assert.equal(result.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(result.trace.rerank.status, 'skipped');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('embedding-only retrieval uses vector artifacts and query embedding provider', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_vector_target',
        text: 'Surface wording alpha should still be selected by semantic vector.',
      }),
      baseChunk({
        chunk_id: 'chk_vector_other',
        text: 'Surface wording beta should rank lower for this semantic query.',
      }),
    ]);
    const provider = directionalEmbeddingProvider('chk_vector_target');
    const embeddingConfig = {
      enabled: true,
      provider: 'fake',
      model: provider.model,
      dimensions: provider.dimensions,
      distance: provider.distance,
    };
    await buildKnowledgeVectorIndex({ workspaceRoot, provider, config: embeddingConfig });

    const service = createRetrievalService({
      strategies: [createEmbeddingRecallStrategy({ provider, embeddingConfig })],
    });
    const result = await service.retrieve({
      workspaceRoot,
      query: 'semantic target query',
      limit: 2,
    });

    assert.equal(result.candidates[0].chunkId, 'chk_vector_target');
    assert.equal(result.trace.strategies.find((item) => item.id === 'embedding')?.status, 'ran');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('retrieval service fuses enabled strategies, skips disabled strategies, and falls back from failures', async () => {
  const service = createRetrievalService({
    strategies: [
      stubStrategy({
        id: 'bm25',
        kind: 'lexical',
        candidates: [
          stubCandidate('chk_a', 0.9),
          stubCandidate('chk_b', 0.7),
        ],
      }),
      stubStrategy({
        id: 'embedding',
        kind: 'semantic',
        candidates: [
          stubCandidate('chk_a', 0.95),
          stubCandidate('chk_c', 0.8),
        ],
      }),
      stubStrategy({ id: 'business', kind: 'business', enabled: false, reason: 'not configured' }),
      stubStrategy({ id: 'unstable', kind: 'business', fail: true }),
    ],
  });

  const result = await service.retrieve({
    workspaceRoot: '/tmp/not-used',
    query: 'fusion query',
    limit: 3,
  });

  assert.deepEqual(result.candidates.map((item) => item.chunkId), ['chk_a', 'chk_b', 'chk_c']);
  assert.deepEqual(
    result.candidates[0].strategyScores.map((item) => item.strategyId).sort(),
    ['bm25', 'embedding'],
  );
  assert.equal(result.trace.strategies.find((item) => item.id === 'business')?.status, 'skipped');
  assert.equal(result.trace.strategies.find((item) => item.id === 'unstable')?.status, 'failed');
  assert.equal(result.trace.fusion.method, 'rrf');
  assert.equal(result.trace.fusion.dedupedCount, 1);
});

test('retrieval service applies optional rerank only after fusion', async () => {
  const seenByReranker = [];
  const service = createRetrievalService({
    strategies: [
      stubStrategy({
        id: 'bm25',
        kind: 'lexical',
        candidates: [
          stubCandidate('chk_first', 0.9),
          stubCandidate('chk_second', 0.8),
        ],
      }),
    ],
    reranker: {
      async rerank(input) {
        seenByReranker.push(input.candidates.map((item) => item.chunkId));
        return {
          candidates: input.candidates.slice().reverse().map((candidate, index) => ({
            ...candidate,
            rerankScore: 1 - index * 0.1,
          })),
        };
      },
    },
  });

  const result = await service.retrieve({
    workspaceRoot: '/tmp/not-used',
    query: 'rerank after fusion',
    limit: 2,
  });

  assert.deepEqual(seenByReranker, [['chk_first', 'chk_second']]);
  assert.deepEqual(result.candidates.map((item) => item.chunkId), ['chk_second', 'chk_first']);
  assert.equal(result.trace.rerank.status, 'ran');
});

function directionalEmbeddingProvider(targetChunkId) {
  return {
    id: 'fake',
    model: 'directional-test-vector',
    dimensions: 2,
    distance: 'cosine',
    async embedDocuments(input) {
      return {
        provider: this.id,
        model: this.model,
        dimensions: this.dimensions,
        distance: this.distance,
        results: input.map((item) => ({
          id: item.id,
          provider: this.id,
          model: this.model,
          dimensions: this.dimensions,
          distance: this.distance,
          vector: item.id === targetChunkId ? [1, 0] : [0, 1],
          contentHash: item.contentHash,
          metadata: item.metadata,
        })),
      };
    },
    async embedQuery(input) {
      return {
        id: input.id ?? 'query',
        provider: this.id,
        model: this.model,
        dimensions: this.dimensions,
        distance: this.distance,
        vector: [1, 0],
        metadata: input.metadata,
      };
    },
  };
}

function stubStrategy(input) {
  return {
    id: input.id,
    kind: input.kind,
    enabled: () => (
      input.enabled === false
        ? { enabled: false, reason: input.reason ?? 'disabled by test' }
        : { enabled: true }
    ),
    async recall() {
      if (input.fail) {
        throw new Error(`${input.id} failed`);
      }
      return { candidates: input.candidates ?? [] };
    },
  };
}

function stubCandidate(chunkId, score) {
  return {
    id: chunkId,
    chunkId,
    documentId: chunkId.replace(/^chk_/, 'doc_'),
    source: `knowledge/faq/${chunkId}.md`,
    text: `${chunkId} text`,
    score,
  };
}

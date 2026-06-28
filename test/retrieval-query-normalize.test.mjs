import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAndExpandQuery } from '../dist/retrieval/query/normalize.js';
import { createRetrievalService } from '../dist/retrieval/service.js';

test('normalizeAndExpandQuery converts fullwidth to halfwidth and collapses whitespace', () => {
  const result = normalizeAndExpandQuery({ query: 'ＡＩ－Ａｇｅｎｔ　ｖ２　检索' });
  assert.equal(result.normalized, 'AI-Agent v2 检索');
  assert.equal(result.original, 'ＡＩ－Ａｇｅｎｔ　ｖ２　检索');
  assert.deepEqual(result.expandedTerms, []);
});

test('normalizeAndExpandQuery converts common traditional characters to simplified', () => {
  const result = normalizeAndExpandQuery({ query: '課程發佈可見性規則' });
  assert.equal(result.normalized, '课程发布可见性规则');
});

test('normalizeAndExpandQuery expands aliases whose alias text appears in the normalized query', () => {
  const result = normalizeAndExpandQuery({
    query: '课程上架后学员看不到加入入口',
    aliases: [
      { alias: '上架', term: '发布' },
      { alias: '看不到', term: '不可见' },
      { alias: '无关词', term: '不应扩展' },
    ],
  });
  assert.ok(result.expandedTerms.includes('发布'));
  assert.ok(result.expandedTerms.includes('不可见'));
  assert.equal(result.expandedTerms.includes('不应扩展'), false);
});

test('normalizeAndExpandQuery strips boundary punctuation and normalizes aliases before matching', () => {
  const result = normalizeAndExpandQuery({
    query: '，課程上架？',
    aliases: [
      { alias: '課程上架', term: '發布' },
    ],
  });
  assert.equal(result.normalized, '课程上架');
  assert.deepEqual(result.expandedTerms, ['发布']);
});

test('retrieval service passes normalized query to recall strategies but original query to reranker', async () => {
  const seenRecall = [];
  const seenRerank = [];
  const service = createRetrievalService({
    strategies: [
      {
        id: 'bm25',
        kind: 'lexical',
        enabled: () => true,
        async recall(input) {
          seenRecall.push({
            query: input.query,
            normalized: input.normalizedQuery?.normalized,
            expanded: input.normalizedQuery?.expandedTerms,
          });
          return { candidates: [{ id: 'chk_a', chunkId: 'chk_a', documentId: 'doc_a', source: 'a.md', text: 'a', score: 0.5 }] };
        },
      },
    ],
    reranker: {
      async rerank(input) {
        seenRerank.push(input.query);
        return { candidates: input.candidates };
      },
    },
    queryNormalizer: (query) => normalizeAndExpandQuery({ query, aliases: [{ alias: '上架', term: '发布' }] }),
  });

  await service.retrieve({ workspaceRoot: '/tmp', query: '课程上架', limit: 1 });

  assert.equal(seenRecall[0].query, '课程上架');
  assert.equal(seenRecall[0].normalized, '课程上架');
  assert.deepEqual(seenRecall[0].expanded, ['发布']);
  // rerank 收到 original，不是 normalized/expanded
  assert.deepEqual(seenRerank, ['课程上架']);
});

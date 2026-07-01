import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceCoverageService } from '../dist/runtime/evidence-coverage-service.js';

function fakeModel(response) {
  return {
    async complete() {
      return response;
    },
  };
}

const sampleEvidence = [{
  evidence_id: 'ev_001',
  title: '学员数据统计补跑命令',
  summary: '学员数据统计缺失时可用命令行补跑',
  answer_span: '执行 php app/console student:statistics:rebuild --month=2024-06 补跑',
  excerpt: '步骤1：执行 php app/console student:statistics:rebuild',
}];

test('coverage service returns covered when model says covered', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ coverage: 'covered', missing_elements: [], reason: '证据包含补跑命令' })),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑学员数据统计', evidence: sampleEvidence });
  assert.equal(result.coverage, 'covered');
  assert.deepEqual(result.missingElements, []);
});

test('coverage service returns not_covered when model says not_covered', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ coverage: 'not_covered', missing_elements: ['补跑步骤', '命令行名称'], reason: '只命中功能说明' })),
    'spec',
  );
  const result = await service.evaluate({ question: '学员数据统计缺失如何补，有没有命令行', evidence: sampleEvidence });
  assert.equal(result.coverage, 'not_covered');
  assert.equal(result.missingElements.length, 2);
});

test('coverage service returns partial when model says partial', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ coverage: 'partial', missing_elements: ['命令行参数'], reason: '有步骤但缺命令' })),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑数据', evidence: sampleEvidence });
  assert.equal(result.coverage, 'partial');
});

test('coverage service degrades to unknown when model throws', async () => {
  const throwingModel = {
    async complete() { throw new Error('model unavailable'); },
  };
  const service = new EvidenceCoverageService(throwingModel, 'spec');
  const result = await service.evaluate({ question: '如何补跑', evidence: sampleEvidence });
  assert.equal(result.coverage, 'unknown');
  assert.match(result.reason, /coverage evaluation failed/);
});

test('coverage service degrades to unknown when model returns non-json', async () => {
  const service = new EvidenceCoverageService(
    fakeModel('not json at all'),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑', evidence: sampleEvidence });
  assert.equal(result.coverage, 'unknown');
});

test('coverage service degrades to unknown when coverage field missing', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ missing_elements: [], reason: 'no coverage field' })),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑', evidence: sampleEvidence });
  assert.equal(result.coverage, 'unknown');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RagAnswerabilityService } from '../dist/runtime/rag-answerability-service.js';
import { buildAnswerContract } from '../dist/runtime/answer-contract.js';

const evidence = [{
  evidence_id: 'ev_stat_task',
  title: '用户数据统计',
  summary: '用户数据统计由定时任务生成。',
  answer_span: '用户数据统计由定时任务每日生成。',
  excerpt: '用户数据统计由定时任务每日生成。',
  source: 'knowledge/faq/stats.md',
  status: 'active',
  confidence: 'high',
}];

function model(json) {
  return { complete: async () => json };
}

test('rag answerability extracts partial covered claims and requests escalation', async () => {
  const contract = buildAnswerContract({
    originalQuestion: '学员数据统计缺少6月份，如何补上，有没有命令行处理',
    resolvedQuestion: '学员数据统计缺少6月份，如何补上，有没有命令行处理',
  });
  const service = new RagAnswerabilityService(model(JSON.stringify({
    answerability: 'partial',
    selectedEvidenceIds: ['ev_stat_task'],
    coveredClaims: [{
      id: 'rag_claim_1',
      text: '用户数据统计由定时任务生成。',
      evidenceIds: ['ev_stat_task'],
      coveredRequirementIds: ['generation_source'],
      usefulness: '可作为补数排查背景',
    }],
    missingElements: ['现成命令名称', '月份参数', '执行验证方式'],
    shouldEscalate: true,
    escalationFocus: '查找统计补数命令、定时任务实现和历史重算入口',
    reason: '知识库只说明生成来源，未覆盖补数命令。',
  })), 'agent spec');

  const result = await service.evaluate({ contract, evidence });

  assert.equal(result.answerability, 'partial');
  assert.equal(result.shouldEscalate, true);
  assert.deepEqual(result.selectedEvidenceIds, ['ev_stat_task']);
  assert.match(result.coveredClaims[0].text, /定时任务/);
  assert.match(result.escalationFocus, /补数命令/);
});

test('rag answerability rejects nonexistent evidence ids', async () => {
  const contract = buildAnswerContract({
    originalQuestion: '班课在哪配置的',
    resolvedQuestion: '班课在哪配置的',
  });
  const service = new RagAnswerabilityService(model(JSON.stringify({
    answerability: 'full',
    selectedEvidenceIds: ['ev_missing'],
    coveredClaims: [{
      id: 'rag_claim_1',
      text: '班课在后台配置。',
      evidenceIds: ['ev_missing'],
      coveredRequirementIds: ['entry_path'],
      usefulness: '直接回答入口',
    }],
    missingElements: [],
    shouldEscalate: false,
    escalationFocus: '',
    reason: 'bad ids',
  })), 'agent spec');

  const result = await service.evaluate({ contract, evidence });

  assert.equal(result.answerability, 'unknown');
  assert.equal(result.shouldEscalate, true);
  assert.match(result.reason, /invalid evidence/i);
});

test('rag answerability rejects full results that do not cover every mustAnswer requirement', async () => {
  const contract = buildAnswerContract({
    originalQuestion: '班课在哪配置的',
    resolvedQuestion: '班课在哪配置的',
  });
  const service = new RagAnswerabilityService(model(JSON.stringify({
    answerability: 'full',
    selectedEvidenceIds: ['ev_stat_task'],
    coveredClaims: [{
      id: 'rag_claim_entry',
      text: '班课在后台管理中配置。',
      evidenceIds: ['ev_stat_task'],
      coveredRequirementIds: ['entry_path'],
      usefulness: '只回答入口。',
    }],
    missingElements: [],
    shouldEscalate: false,
    escalationFocus: '',
    reason: '错误地认为已覆盖全部问题。',
  })), 'agent spec');

  const result = await service.evaluate({ contract, evidence });

  assert.equal(result.answerability, 'unknown');
  assert.equal(result.shouldEscalate, true);
  assert.match(result.reason, /mustAnswer|requirement/i);
});

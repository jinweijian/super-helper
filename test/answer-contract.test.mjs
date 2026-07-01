import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerContract } from '../dist/runtime/answer-contract.js';

test('builds operation procedure contract for statistics backfill command questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '学员管理的学员数据统计里面缺少6月份的数据，已经确认是定时任务没执行的问题，现在已经解决了定时任务。如何补上这个数据统计。有没有现成的命令行处理',
    resolvedQuestion: '学员管理的学员数据统计里面缺少6月份的数据，如何补上这个数据统计，有没有现成的命令行处理',
  });

  assert.equal(contract.questionType, 'operation_procedure');
  assert.equal(contract.missingTolerance, 'partial_allowed_with_escalation');
  assert.deepEqual(contract.mustAnswer.map((item) => item.id), [
    'operation_method',
    'command_or_entry',
    'scope_or_parameters',
    'verification_or_caveat',
  ]);
  assert.match(contract.finalAnswerExpectation, /可执行|命令|步骤/);
});

test('builds operation procedure contract for create or generate how-to questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: 'AI伴学助手如何制定学习计划？',
    resolvedQuestion: 'AI伴学助手如何制定学习计划？',
  });

  assert.equal(contract.questionType, 'operation_procedure');
  assert.ok(contract.mustAnswer.some((item) => item.id === 'operation_method'));
  assert.ok(contract.mustAnswer.some((item) => item.id === 'command_or_entry'));
});

test('builds configuration location contract for entry questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '班课在哪配置的',
    resolvedQuestion: '班课在哪配置的',
  });

  assert.equal(contract.questionType, 'configuration_location');
  assert.deepEqual(contract.mustAnswer.map((item) => item.id), [
    'entry_path',
    'permission_or_role',
    'configurable_items',
  ]);
});

test('builds feature overview contract for what-is-and-functions questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '班课是什么，有什么功能',
    resolvedQuestion: '班课是什么，有什么功能',
  });

  assert.equal(contract.questionType, 'feature_overview');
  assert.ok(contract.mustAnswer.some((item) => item.id === 'definition'));
  assert.ok(contract.mustAnswer.some((item) => item.id === 'capabilities'));
});

test('prioritizes troubleshooting cause for failed scheduled task questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '定时任务为什么没有执行',
    resolvedQuestion: '定时任务为什么没有执行',
  });

  assert.equal(contract.questionType, 'troubleshooting_cause');
});

test('builds bug or behavior contract for bug versus design questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '这个是系统bug还是设计使然',
    resolvedQuestion: '这个是系统bug还是设计使然',
  });

  assert.equal(contract.questionType, 'bug_or_behavior');
});

test('builds rule explanation contract for rule questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '优惠券使用规则是什么',
    resolvedQuestion: '优惠券使用规则是什么',
  });

  assert.equal(contract.questionType, 'rule_explanation');
});

test('classifies command failure questions as troubleshooting cause', () => {
  const contract = buildAnswerContract({
    originalQuestion: '同步命令为什么失败',
    resolvedQuestion: '同步命令为什么失败',
  });

  assert.equal(contract.questionType, 'troubleshooting_cause');
  assert.ok(contract.mustAnswer.some((item) => item.id === 'cause_or_likely_cause'));
});

test('troubleshooting intent wins over command-line operation words', () => {
  for (const question of ['命令行为什么失败', '补跑为什么报错', '重跑失败原因', '手动执行同步为什么失败']) {
    const contract = buildAnswerContract({ originalQuestion: question, resolvedQuestion: question });
    assert.equal(contract.questionType, 'troubleshooting_cause', question);
  }
});

test('troubleshooting intent wins over configuration location words', () => {
  for (const question of ['配置入口为什么报错', '设置路径打不开为什么']) {
    const contract = buildAnswerContract({ originalQuestion: question, resolvedQuestion: question });
    assert.equal(contract.questionType, 'troubleshooting_cause', question);
  }
});

test('pure operation questions remain operation procedure', () => {
  for (const question of ['如何补跑数据', '怎么手动执行同步命令', '有没有命令行处理']) {
    const contract = buildAnswerContract({ originalQuestion: question, resolvedQuestion: question });
    assert.equal(contract.questionType, 'operation_procedure', question);
  }
});

test('known missed execution background does not override operation procedure intent', () => {
  for (const question of [
    '已确认定时任务没有执行，如何补上数据统计',
    '定时任务未执行后如何补跑 6 月数据',
    '怎么手动执行没有执行的任务',
  ]) {
    const contract = buildAnswerContract({ originalQuestion: question, resolvedQuestion: question });
    assert.equal(contract.questionType, 'operation_procedure', question);
  }
});

test('failure or error background does not override operation procedure intent', () => {
  for (const question of [
    '失败任务如何重跑',
    '同步失败后如何补跑 6 月数据',
    '异常数据如何补跑',
    '报错任务怎么重跑',
  ]) {
    const contract = buildAnswerContract({ originalQuestion: question, resolvedQuestion: question });
    assert.equal(contract.questionType, 'operation_procedure', question);
  }
});

test('failure or error without operation intent remains troubleshooting cause', () => {
  for (const question of ['同步失败', '任务报错', '数据异常']) {
    const contract = buildAnswerContract({ originalQuestion: question, resolvedQuestion: question });
    assert.equal(contract.questionType, 'troubleshooting_cause', question);
  }
});

test('operation words inside rule or definition questions do not force operation procedure', () => {
  const expectations = new Map([
    ['定时任务执行规则是什么', 'rule_explanation'],
    ['运行机制是什么', 'rule_explanation'],
    ['导入参数是什么', 'rule_explanation'],
  ]);
  for (const [question, expectedType] of expectations) {
    const contract = buildAnswerContract({ originalQuestion: question, resolvedQuestion: question });
    assert.equal(contract.questionType, expectedType, question);
  }
});

test('bare bug words do not force bug-or-behavior classification', () => {
  const overview = buildAnswerContract({
    originalQuestion: 'bug 管理功能有哪些',
    resolvedQuestion: 'bug 管理功能有哪些',
  });
  assert.equal(overview.questionType, 'feature_overview');

  const definition = buildAnswerContract({
    originalQuestion: 'bug 是什么',
    resolvedQuestion: 'bug 是什么',
  });
  assert.equal(definition.questionType, 'definition');
});

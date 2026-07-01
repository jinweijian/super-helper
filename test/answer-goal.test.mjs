import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAnswerGoal, followUpAnswerGoal } from '../dist/runtime/answer-goal.js';

function resolvedTurn(question, overrides = {}) {
  return {
    resolvedQuery: question,
    latestUserMessage: question,
    latestUserMessageId: 'msg_01',
    confirmedFacts: [],
    userClaims: [],
    hypotheses: [],
    unknowns: [],
    isFollowUp: false,
    sourceMessageIds: ['msg_01'],
    ...overrides,
  };
}

test('builds a stable AnswerGoal without classifying Chinese question phrasing', () => {
  const questions = [
    'APP发现页是空白的，显示不出来，是什么问题',
    'APP发现页空白应该怎么排查',
    '后台运营 APP 发现页不显示，下一步给什么信息',
    '本地视频文件存在 edusoho 下面哪个目录',
    '网校能不能隐藏登录入口',
  ];

  const goals = questions.map((question) => buildAnswerGoal({
    rawUserQuestion: question,
    resolvedTurn: resolvedTurn(question),
  }));

  assert.deepEqual([...new Set(goals.map((goal) => goal.mustAnswerItems.join(',')))], ['direct_answer']);
  assert.equal(goals[0].rawUserQuestion, questions[0]);
  assert.equal(goals[0].resolvedQuestion, questions[0]);
  assert.deepEqual(goals[0].sourceMessageIds, ['msg_01']);
});

test('extracts answer object from concrete file paths while preserving the real question', () => {
  const goal = buildAnswerGoal({
    rawUserQuestion: '请解释 package.json 的脚本配置，需要引用文件证据。',
    resolvedTurn: resolvedTurn('请解释 package.json 的脚本配置，需要引用文件证据。'),
  });

  assert.equal(goal.answerObject, 'package.json');
  assert.equal(goal.mustAnswerItems[0], 'direct_answer');
  assert.match(goal.diagnosticObjective, /package\.json/);
});

test('follow-up keeps the original user-visible question and only changes internal objective', () => {
  const original = buildAnswerGoal({
    rawUserQuestion: 'APP发现页是空白的，显示不出来，是什么问题',
    resolvedTurn: resolvedTurn('APP发现页是空白的，显示不出来，是什么问题'),
  });

  const followUp = followUpAnswerGoal({
    previous: original,
    diagnosticObjective: '继续追查上一轮缺少的 Network 状态码和 Console 报错。',
  });

  assert.equal(followUp.rawUserQuestion, original.rawUserQuestion);
  assert.equal(followUp.resolvedQuestion, original.resolvedQuestion);
  assert.match(followUp.diagnosticObjective, /继续追查/);
});

test('main-answer path does not reintroduce question-phrase gates or AnswerContract', () => {
  const files = [
    'src/runtime/presenter.ts',
    'src/runtime/review-presentation.ts',
    'src/runtime/result-validator.ts',
    'src/agents/main.md',
    'src/agents/output-review.md',
    'src/agents/presentation.md',
  ];
  for (const file of files) {
    const content = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(content, /AnswerContract|answerContract|buildAnswerContract/, file);
    assert.doesNotMatch(content, /先判断用户问题类型/, file);
    assert.doesNotMatch(
      content,
      /\/[^/\n]*(?:能不能|给你什么|哪个目录|哪些信息|什么信息)[^/\n]*\|[^/\n]*\//,
      file,
    );
  }
});

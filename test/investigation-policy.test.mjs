import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInvestigation, nextInvestigation, hasEvidenceProgress } from '../dist/runtime/investigation-policy.js';

const request = (context = {}) => ({ context, answerGoal: { sourceMessageIds: ['message_1'] } });
test('手动偏好优先，自动使用结构化候选与复杂度', () => {
  assert.equal(resolveInvestigation('fast', request(), true).execution.resolvedProfile, 'fast');
  assert.equal(resolveInvestigation('deep', request()).execution.resolvedProfile, 'deep');
  assert.equal(resolveInvestigation('auto', request(), true).reasonCode, 'historical_verification');
  assert.equal(resolveInvestigation('auto', request()).execution.resolvedProfile, 'deep');
  const bounded = request({deepQuery: {artifactTargets:['src/a.ts']}});
  assert.equal(resolveInvestigation('auto', bounded).execution.resolvedProfile, 'fast');
  bounded.context.knowledge = {judge: {conflicts:['conflict']}};
  assert.equal(resolveInvestigation('auto', bounded).execution.resolvedProfile, 'deep');
});
test('自动快速最多一次升级，手动快速和最终结论不升级', () => {
  const fast = resolveInvestigation('auto', request({deepQuery:{artifactTargets:['a']}})).execution;
  const deep = nextInvestigation(fast, 'partial');
  assert.equal(deep.attempt, 2);
  assert.equal(deep.resolvedProfile, 'deep');
  assert.equal(nextInvestigation(deep, 'partial'), undefined);
  assert.equal(nextInvestigation({...fast, requestedMode:'fast', escalationAllowed:false}, 'partial'), undefined);
  assert.equal(nextInvestigation(fast, 'final'), undefined);
});
test('进展以审核后新证据内容比较，不被新 ID 或空结果欺骗', () => {
  const old = {kind:'workspace',source:'a.ts',summary:'checked',confidence:'high'};
  const previous = {context:{previousRuns:[{evidence:[old]}]}};
  assert.equal(hasEvidenceProgress(previous, {evidence:[{...old,id:'new'}]}), false);
  assert.equal(hasEvidenceProgress(previous, {evidence:[]}), false);
  assert.equal(hasEvidenceProgress(previous, {evidence:[{...old,summary:'new finding'}]}), true);
  assert.equal(hasEvidenceProgress(previous, {evidence:[{...old,kind:'unknown',summary:'new'}]}), false);
});

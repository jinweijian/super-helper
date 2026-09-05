import assert from 'node:assert/strict';
import test from 'node:test';
import { InvestigationControl } from '../dist/runtime/investigation-control.js';

test('取消只影响目标 Case 的当前消息，排队消息不能取消', () => {
  const control = new InvestigationControl();
  control.begin('a','m1','auto'); control.begin('b','m2','deep');
  assert.equal(control.cancel('a','queued'), false);
  assert.equal(control.cancel('a','m1'), true);
  assert.equal(control.options('a').signal.aborted, true);
  assert.equal(control.options('b').signal.aborted, false);
  control.finish('a','m1');
  assert.equal(control.snapshot('a','m1'), undefined);
  assert.equal(control.cancel('a','m1'), false);
});
test('进度只复制允许字段，旧回调不能覆盖下一回合', () => {
  const control = new InvestigationControl();
  control.begin('a','m1','fast');
  const options = control.options('a');
  options.onProgress({stage:'reading',searchCount:2,filesRead:1,lastActivityAt:new Date().toISOString(),secret:'no'});
  assert.equal(control.snapshot('a','m1').filesRead, 1);
  assert.equal(JSON.stringify(control.snapshot('a','m1')).includes('secret'), false);
  control.finish('a','m1'); control.begin('a','m2','deep');
  options.onProgress({stage:'reading',searchCount:8,filesRead:8,lastActivityAt:new Date().toISOString()});
  assert.equal(control.snapshot('a','m2').filesRead, 0);
});

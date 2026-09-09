import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveState } from '../src/save-state.ts';

test('编辑器同步与其他保存回调不能提前解除未保存保护',()=>{
  const state=new SaveState();state.changed(true);const revision=state.revision;
  assert.equal(state.confirm(revision,'current',['previous']),false);
  assert.equal(state.dirty,true);
  assert.equal(state.confirm(revision,'current',['current']),true);
  assert.equal(state.dirty,true,'编辑器仍有未同步输入');
  state.changed(false);assert.equal(state.dirty,true,'同步到编辑服务不等于保存回文件');
  state.confirm(revision,'current',['current']);assert.equal(state.dirty,false);
});
test('保存期间的新修改不能被旧保存结果覆盖',()=>{
  const state=new SaveState();state.changed(true);state.changed(false);const revision=state.revision;
  state.changed(true);state.changed(false);
  assert.equal(state.confirm(revision,'first',['first']),true);
  assert.equal(state.dirty,true);
  state.confirm(state.revision,'second',['first','second']);assert.equal(state.dirty,false);
});

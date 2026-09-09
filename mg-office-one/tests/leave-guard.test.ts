import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficeLeaveGuard} from '../src/leave-guard.ts';

test('保存期间拒绝关闭；关闭与切页共用一次未保存确认，取消后仍保留编辑状态',async()=>{
 const state={dirty:true,busy:true};let count=0,answer:(choice:boolean)=>void=()=>{};
 const guard=createOfficeLeaveGuard(()=>state,()=>{count++;return new Promise<boolean>(resolve=>{answer=resolve})});
 assert.equal(await guard(),false);assert.equal(count,0);
 state.busy=false;const close=guard(),navigate=guard();assert.equal(count,1);
 answer(false);assert.equal(await close,false);assert.equal(await navigate,false);assert.equal(state.dirty,true);
 const retry=guard();answer(true);assert.equal(await retry,true);
});
test('确认过程中开始保存也不能离开；保存完成且无脏数据时不弹窗',async()=>{
 const state={dirty:true,busy:false};let answer:(choice:boolean)=>void=()=>{},count=0;
 const guard=createOfficeLeaveGuard(()=>state,()=>{count++;return new Promise<boolean>(resolve=>{answer=resolve})});
 const closing=guard();state.busy=true;answer(true);assert.equal(await closing,false);
 state.busy=false;state.dirty=false;assert.equal(await guard(),true);assert.equal(count,1);
});

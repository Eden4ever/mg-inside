import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDialogDefinitions, isDialogParams, isDialogData, isDialogResult } from '../packages/frontend/desktop-contracts/src/index.ts';
const definition = { id: 'external-application', title: '外链应用', path: '/applications/editor', width: 560, height: 640 };
test('注册弹窗只接受有限、唯一且为应用内部路径的元数据', () => {
  assert.deepEqual(validateDialogDefinitions([definition]), [definition]);
  for (const item of [{ ...definition, path: 'https://example.com' }, { ...definition, path: '/applications/../security' }, { ...definition, path: '/applications/editor?token=secret' }, { ...definition, width: 2001 }, { ...definition, height: 1 }, { ...definition, component: '任意代码' }]) assert.throws(() => validateDialogDefinitions([item]));
  assert.throws(() => validateDialogDefinitions([definition, definition]));
  assert.throws(() => validateDialogDefinitions(Array.from({ length: 33 }, (_, index) => ({ ...definition, id: `dialog-${index}` }))));
});
test('弹窗参数与结果限制为 16KiB 和 8 层的 JSON 数据', () => {
  assert.ok(isDialogParams({ applicationId: 'external-123', filters: [1, null, true] }));
  assert.equal(isDialogParams([]), false);
  assert.equal(isDialogData({ data: '中'.repeat(6000) }), false);
  assert.equal(isDialogData({ data: Infinity }), false);
  assert.equal(isDialogData({ callback() {} }), false);
  assert.equal(isDialogData(new Date()), false);
  const cyclic = {}; cyclic.self = cyclic; assert.equal(isDialogData(cyclic), false);
  let nested = {}; for (let i = 0; i < 10; i++) nested = { nested }; assert.equal(isDialogData(nested), false);
  assert.ok(isDialogResult({ outcome: 'completed', value: { applicationId: 'external-123' } }));
  assert.ok(isDialogResult({ outcome: 'cancelled', message: '弹窗未注册' }));
  assert.equal(isDialogResult({ outcome: 'unknown' }), false);
  assert.equal(isDialogResult({ outcome: 'completed', value: 'x'.repeat(17000) }), false);
});

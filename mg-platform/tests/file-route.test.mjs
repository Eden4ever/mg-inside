import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAppPath } from '../packages/frontend/desktop-contracts/src/index.ts';
test('文件路由仅保留资源 UUID 和已知操作，不保留认证信息或任意动作', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.equal(safeAppPath(`/my-files?open=${id}&intent=rename&token=secret#draft`), `/my-files?open=${id}&intent=rename`);
  assert.equal(safeAppPath('/my-files?open=https://example.com&intent=execute'), '/my-files');
  assert.equal(safeAppPath('/my-files/desktop?intent=new-folder'), '/my-files/desktop?intent=new-folder');
});

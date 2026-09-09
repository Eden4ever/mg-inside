import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasVisibleEditingDialog, observeEditingDialogs } from '@/desktop-close-state';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('桌面编辑弹窗保护', () => {
  it('追踪传送到 body 的弹窗及显示隐藏，而不把普通正文作为未保存状态', async () => {
    const changed = vi.fn();
    const stop = observeEditingDialogs(changed);
    expect(changed).toHaveBeenLastCalledWith(false);
    const dialog = document.createElement('div');
    dialog.className = 'el-overlay-dialog';
    vi.spyOn(dialog, 'getClientRects').mockImplementation(() => (dialog.style.display === 'none' ? [] : [{}]) as unknown as DOMRectList);
    document.body.append(dialog);
    await Promise.resolve();
    expect(changed).toHaveBeenLastCalledWith(true);
    dialog.style.display = 'none';
    await Promise.resolve();
    expect(changed).toHaveBeenLastCalledWith(false);
    dialog.style.display = '';
    await Promise.resolve();
    expect(changed).toHaveBeenLastCalledWith(true);
    stop();
    changed.mockClear();
    dialog.remove();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
  });

  it('忽略已经隐藏的弹窗，保护仍可见的确认框', () => {
    document.body.innerHTML = '<div class="el-dialog__wrapper" style="visibility:hidden"></div><div class="el-message-box__wrapper"></div>';
    for (const el of document.body.children) vi.spyOn(el, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    expect(hasVisibleEditingDialog()).toBe(true);
    document.querySelector('.el-message-box__wrapper')?.remove();
    expect(hasVisibleEditingDialog()).toBe(false);
  });
});

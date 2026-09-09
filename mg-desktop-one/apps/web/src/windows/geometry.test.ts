import { describe, expect, it } from 'vitest';
import { cascadeRect, clampRect, floatingRect, modeRect } from './geometry';
import { appAllowsPath, safeAppPath } from '../../../../../mg-platform/packages/frontend/desktop-contracts/src/index';
describe('桌面空间与深链接边界', () => {
  it('多窗口恢复错开标题栏，适配当前视口且不挤到同一角落', () => {
    const area = { width: 1440, height: 850 };
    const rectangles = Array.from({ length: 7 }, (_, index) => cascadeRect(index, 7, area, { width: 900, height: 520 }));
    expect(new Set(rectangles.map(rect => `${rect.x},${rect.y}`)).size).toBe(7);
    for (const [index, rect] of rectangles.entries()) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(area.width + .01); expect(rect.y + rect.height).toBeLessThanOrEqual(area.height + .01);
      if (index) expect(rect.y).toBeGreaterThan(rectangles[index - 1]!.y);
    }
  });
  it('窄屏下应用最小宽度不会把标题栏挤出屏幕', () => {
    expect(clampRect({ x: 900, y: -500, width: 1200, height: 900 }, { width: 390, height: 640 }, { width: 900, height: 480 }))
      .toEqual({ x: 0, y: 0, width: 390, height: 640 });
  });
  it('外部持久化的非法数值不能造成不可达窗口', () => {
    const value = clampRect({ x: NaN, y: Infinity, width: NaN, height: -1 }, { width: 1440, height: 800 });
    expect(Object.values(value).every(Number.isFinite)).toBe(true); expect(value.x).toBe(0); expect(value.y).toBe(0);
  });
  it('左右贴靠无重叠，窄屏自动单窗口', () => {
    const rect = { x: 80, y: 60, width: 800, height: 600 }, area = { width: 1440, height: 800 };
    const left = modeRect('left', rect, area), right = modeRect('right', rect, area);
    expect(left.x + left.width).toBe(right.x);
    expect(left).toEqual({ x: 0, y: 0, width: 720, height: 800 });
    expect(right.x + right.width).toBe(area.width);
    expect(modeRect('normal', rect, { width: 768, height: 640 })).toEqual({ x: 0, y: 0, width: 768, height: 640 });
    expect(modeRect('maximized', rect, area)).toEqual({ x: 0, y: 0, width: 1440, height: 800 });
  });
  it('布局与分享链接不能带回令牌或越权加载来源', () => {
    expect(safeAppPath('/systems/123?token=secret&module=portrait#sso_token=secret')).toBe('/systems/123?module=portrait');
    for (const path of ['//evil.example', '/\\evil.example', '/%2e%2e/private', 'https://evil.example']) expect(safeAppPath(path)).toBe('/');
    expect(appAllowsPath({ allowedPaths: ['/systems'] } as any, '/systems/123')).toBe(true);
    expect(appAllowsPath({ allowedPaths: ['/systems'] } as any, '/systems-admin')).toBe(false);
  });
  it('浮窗可进入 Dock 区域，但最大化和半屏停在工作区底边', () => {
    const area = { width: 1440, height: 800 }, rect = { x: 100, y: 600, width: 700, height: 320 };
    const floating = modeRect('normal', rect, area, 92);
    expect(floating.y).toBe(600);
    expect(modeRect('maximized', rect, area, 92).height).toBe(800);
    expect(modeRect('left', rect, area, 92).height).toBe(800);
  });
  it('最大化和半屏摆放后仍可保持尺寸自由移动，标题区始终可找回', () => {
    const area = { width: 1440, height: 892 };
    expect(floatingRect({ x: 100, y: 80, width: 1440, height: 800 }, area)).toEqual({ x: 100, y: 80, width: 1440, height: 800 });
    const half = floatingRect({ x: 250, y: 150, width: 720, height: 800 }, area);
    expect(half).toEqual({ x: 250, y: 150, width: 720, height: 800 });
    const far = floatingRect({ ...half, x: -9999, y: 9999 }, area);
    expect(far.x + far.width).toBe(240); expect(far.y).toBe(850);
  });
});

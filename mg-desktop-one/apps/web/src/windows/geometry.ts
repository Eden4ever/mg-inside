import type { Rect, WindowMode } from '../../../../../mg-platform/packages/frontend/desktop-contracts/src/index';
export interface WorkArea { width: number; height: number; }
/** 刷新后按层级错开；不沿用旧视口坐标，避免多个窗口被边界钳到同一角落。 */
export function cascadeRect(index: number, count: number, area: WorkArea, min = { width: 680, height: 480 }): Rect {
  const steps = Math.max(1, count - 1);
  const width = Math.min(area.width, Math.max(min.width, area.width * .74));
  const height = Math.min(area.height, Math.max(min.height, area.height * .72));
  const dx = Math.min(36, Math.max(0, (area.width - width) / steps));
  const dy = Math.min(42, Math.max(0, (area.height - height) / steps));
  return { x: index * dx, y: index * dy, width, height };
}
export function clampRect(rect: Rect, area: WorkArea, min = { width: 480, height: 320 }): Rect {
  const available = { width: Math.max(1, area.width), height: Math.max(1, area.height) };
  const number = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
  const width = Math.min(available.width, Math.max(Math.min(min.width, available.width), number(rect.width, available.width)));
  const height = Math.min(available.height, Math.max(Math.min(min.height, available.height), number(rect.height, available.height)));
  return { width, height, x: Math.max(0, Math.min(number(rect.x, 0), available.width - width)), y: Math.max(0, Math.min(number(rect.y, 0), available.height - height)) };
}
/** 自由移动允许窗口跨出边界，但保留可抓取的标题区，避免窗口完全丢失。 */
export function floatingRect(rect: Rect, area: WorkArea, min = { width: 480, height: 320 }): Rect {
  const sized = clampRect(rect, area, min);
  // 右侧四个控制按钮占184px，余下区域必须仍可抓取，不能只露出按钮。
  const visibleTitle = Math.min(240, sized.width, area.width);
  const x = Number.isFinite(rect.x) ? rect.x : 0, y = Number.isFinite(rect.y) ? rect.y : 0;
  return { ...sized, x: Math.max(visibleTitle - sized.width, Math.min(x, area.width - visibleTitle)), y: Math.max(0, Math.min(y, area.height - Math.min(42, sized.height))) };
}
/** 唯一边界规则：浮窗包含 Dock 区域，铺排窗口截止 Dock 顶部；所有模式均为零边距。 */
export function windowBounds(mode: WindowMode, area: WorkArea, dockHeight = 0): WorkArea {
  return { width: Math.max(1, area.width), height: Math.max(1, area.height + (mode === 'normal' && area.width >= 1024 ? dockHeight : 0)) };
}
export function modeRect(mode: WindowMode, normal: Rect, area: WorkArea, dockHeight = 0): Rect {
  const bounds = windowBounds(mode, area, dockHeight);
  if (mode === 'normal' && area.width >= 1024) return floatingRect(normal, bounds);
  const split = area.width >= 1024 && (mode === 'left' || mode === 'right');
  const width = bounds.width / (split ? 2 : 1);
  return { x: split && mode === 'right' ? width : 0, y: 0, width, height: bounds.height };
}

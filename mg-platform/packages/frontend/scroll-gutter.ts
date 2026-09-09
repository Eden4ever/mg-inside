/** 将滚动轨道放在页面既有留白中，正文可用宽度与固定标题保持一致。 */
export function observePageScrollGutter(element: HTMLElement) {
  let previous = -1;
  let frame = 0;
  const update = () => {
    if (!element.getClientRects().length) return;
    const style = getComputedStyle(element);
    const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    const width = Math.max(0, element.offsetWidth - element.clientWidth - borders);
    if (width === previous) return;
    previous = width;
    element.style.setProperty('--inside-page-scrollbar-width', `${width}px`);
  };
  element.classList.add('mg-aligned-page-scroll');
  update();
  const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); });
  observer.observe(element);
  return () => { observer.disconnect(); cancelAnimationFrame(frame); element.classList.remove('mg-aligned-page-scroll'); element.style.removeProperty('--inside-page-scrollbar-width'); };
}

/** 兼容尚未迁入 PageFrame 的一级页面；不处理表格、卡片内部或阅读目录。 */
export function observeLegacyPageScrollGutters(root: HTMLElement) {
  const elements = new Map<HTMLElement, () => void>();
  let frame = 0;
  const scan = () => {
    frame = 0;
    for (const [element, dispose] of elements) if (!root.contains(element)) { dispose(); elements.delete(element); }
    for (const element of root.querySelectorAll<HTMLElement>('.primary-page > .primary-page-scroll, .primary-page-layout > .primary-page-scroll')) {
      if (!elements.has(element)) elements.set(element, observePageScrollGutter(element));
      if (element.parentElement?.classList.contains('primary-page-layout')) element.parentElement.classList.add('mg-aligned-scroll-layout');
    }
  };
  const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
  observer.observe(root, { childList: true, subtree: true });
  scan();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); for (const dispose of elements.values()) dispose(); elements.clear(); };
}

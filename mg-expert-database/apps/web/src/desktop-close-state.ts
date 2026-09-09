/** Element Plus 弹窗会传送到 body；关闭保护不能只观察工作台组件内部。 */
export function hasVisibleEditingDialog(root: ParentNode = document): boolean {
  return [...root.querySelectorAll<HTMLElement>('.el-overlay-dialog, .el-dialog__wrapper, .el-message-box__wrapper')]
    .some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

export function observeEditingDialogs(onChange: (open: boolean) => void): () => void {
  let previous: boolean | undefined;
  const sync = () => {
    const open = hasVisibleEditingDialog();
    if (previous !== open) { previous = open; onChange(open); }
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
  sync();
  return () => observer.disconnect();
}

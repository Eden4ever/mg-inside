import { markRaw, shallowRef, type Component } from 'vue';
import type { createDesktopApplication } from '../desktop-sdk/src/application';
import { isDialogData, isDialogParams, validateDialogDefinitions, type DesktopDialogDefinition, type DesktopDialogResult } from '../desktop-contracts/src/index';

export interface ApplicationDialogDefinition extends DesktopDialogDefinition { component: Component }
export interface ApplicationDialogController {
  complete(value?: unknown): void;
  cancel(): Promise<boolean>;
  setState(state: { dirty: boolean; busy?: boolean }): void;
  setTitle(title: string): void;
  onBeforeClose(handler: () => boolean | Promise<boolean>): () => void;
}
export interface ApplicationDialogInstance {
  definition: ApplicationDialogDefinition;
  params: Record<string, unknown>;
  controller: ApplicationDialogController;
  dirty: boolean;
  busy: boolean;
}
export function createApplicationDialogs(options: { desktop: ReturnType<typeof createDesktopApplication>; dialogs: ApplicationDialogDefinition[] }) {
  const { desktop } = options;
  const metadata = validateDialogDefinitions(options.dialogs.map(({ component: _, ...definition }) => definition));
  const definitions = metadata.map((item, index) => ({ ...item, component: markRaw(options.dialogs[index]!.component) }));
  const active = shallowRef<ApplicationDialogInstance | null>(null), error = shallowRef('');
  const dialogId = new URLSearchParams(location.search).get('platformDialog');
  const isDialogWindow = desktop.enabled && !!dialogId;
  let closeGuard: (() => boolean | Promise<boolean>) | undefined, pendingClose: Promise<boolean> | undefined;
  let settle: ((result: DesktopDialogResult) => void) | undefined;
  let acceptedClose = false;
  desktop.registerDialogs(metadata);
  function setState(state: { dirty: boolean; busy?: boolean }) {
    if (!active.value) return;
    acceptedClose = false;
    active.value = { ...active.value, dirty: state.dirty, busy: !!state.busy };
    desktop.setState(state);
  }
  function finish(result: DesktopDialogResult) {
    if (!active.value) return;
    if (result.value !== undefined && !isDialogData(result.value)) throw new Error('弹窗返回结果超过允许的数据范围');
    const cloned = JSON.parse(JSON.stringify(result)) as DesktopDialogResult;
    desktop.clearEdits(); desktop.setState({ dirty: false, busy: false });
    if (isDialogWindow) { if (cloned.outcome === 'completed') desktop.completeDialog(cloned.value); else desktop.cancelDialog(); }
    else { active.value = null; closeGuard = undefined; settle?.(cloned); settle = undefined; }
  }
  async function canClose(): Promise<boolean> {
    if (!active.value) return true;
    if (active.value.busy) return false;
    if (acceptedClose) return true;
    if (!pendingClose) pendingClose = Promise.resolve().then(() => closeGuard ? closeGuard() : !active.value?.dirty).then(Boolean).catch(() => false).finally(() => { pendingClose = undefined; });
    return pendingClose;
  }
  async function cancel() { const allowed = await canClose(); if (allowed) { acceptedClose = true; finish({ outcome: 'cancelled' }); } return allowed; }
  function begin(definition: ApplicationDialogDefinition, params: Record<string, unknown>) {
    closeGuard = undefined; acceptedClose = false;
    const controller: ApplicationDialogController = {
      complete: value => finish(value === undefined ? { outcome: 'completed' } : { outcome: 'completed', value }),
      cancel, setState,
      setTitle(title) { if (!active.value || !title.trim() || title.length > 120) return; active.value = { ...active.value, definition: { ...active.value.definition, title } }; if (isDialogWindow) desktop.setTitle(title); },
      onBeforeClose(handler) { closeGuard = handler; return () => { if (closeGuard === handler) closeGuard = undefined; }; },
    };
    active.value = { definition, params: JSON.parse(JSON.stringify(params)), controller, dirty: false, busy: false };
    desktop.setState({ dirty: false, busy: false });
  }
  if (isDialogWindow) {
    const definition = definitions.find(item => item.id === dialogId);
    if (!definition) error.value = '此弹窗未注册，请关闭后从应用重新打开';
    else desktop.waitForDialogContext().then(context => { if (context.dialogId !== definition.id) throw new Error('弹窗上下文不匹配'); begin(definition, context.params); desktop.setTitle(definition.title); }).catch(value => { error.value = value instanceof Error ? value.message : '无法读取弹窗上下文'; });
  }
  return {
    active, error, isDialogWindow, definitions, canClose, cancel,
    async open(id: string, params: Record<string, unknown> = {}): Promise<DesktopDialogResult> {
      if (!isDialogParams(params)) throw new Error('弹窗参数必须是 16KiB 以内、深度不超过 8 层的 JSON 对象');
      const definition = definitions.find(item => item.id === id);
      if (!definition) throw new Error(`弹窗“${id}”未注册`);
      if (desktop.enabled) return desktop.openDialog(id, params);
      if (active.value) return { outcome: 'cancelled', message: '请先完成当前弹窗' };
      return new Promise(resolve => { settle = resolve; begin(definition, params); });
    },
    dispose() { settle?.({ outcome: 'cancelled' }); settle = undefined; active.value = null; closeGuard = undefined; },
  };
}
export type ApplicationDialogs = ReturnType<typeof createApplicationDialogs>;


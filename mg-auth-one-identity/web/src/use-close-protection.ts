import { onScopeDispose, watch, type Ref } from 'vue';
import { desktop } from './desktop';

const forms = new Map<symbol, { dirty: boolean; busy: boolean }>();
function publish() {
  desktop.setState({ dirty: [...forms.values()].some(s => s.dirty), busy: [...forms.values()].some(s => s.busy) });
}
export function useCloseProtection(dirty: Ref<boolean>, busy: Ref<boolean>) {
  const key = Symbol();
  watch([dirty, busy], ([dirty, busy]) => { forms.set(key, { dirty, busy }); publish(); }, { immediate: true, flush: 'sync' });
  onScopeDispose(() => { forms.delete(key); publish(); });
}

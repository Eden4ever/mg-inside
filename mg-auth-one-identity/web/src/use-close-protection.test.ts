import { effectScope, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { desktop } from './desktop';
import { useCloseProtection } from './use-close-protection';
vi.mock('./desktop', () => ({ desktop: { setState: vi.fn() } }));
describe('页面配置关闭保护', () => {
  it('未编辑不提示，失败保留草稿，保存或离开后清除', () => {
    const scope = effectScope(), dirty = ref(false), busy = ref(false);
    scope.run(() => useCloseProtection(dirty, busy));
    expect(desktop.setState).toHaveBeenLastCalledWith({ dirty: false, busy: false });
    dirty.value = true; busy.value = true; busy.value = false;
    expect(desktop.setState).toHaveBeenLastCalledWith({ dirty: true, busy: false });
    dirty.value = false;
    expect(desktop.setState).toHaveBeenLastCalledWith({ dirty: false, busy: false });
    dirty.value = true; scope.stop();
    expect(desktop.setState).toHaveBeenLastCalledWith({ dirty: false, busy: false });
  });
  it('一个表单卸载不会清掉另一个表单的草稿或任务状态', () => {
    const first=effectScope(),second=effectScope();
    first.run(()=>useCloseProtection(ref(true),ref(false)));
    second.run(()=>useCloseProtection(ref(true),ref(true)));
    first.stop();expect(desktop.setState).toHaveBeenLastCalledWith({dirty:true,busy:true});
    second.stop();expect(desktop.setState).toHaveBeenLastCalledWith({dirty:false,busy:false});
  });
});

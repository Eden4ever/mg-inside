import { createApplicationDialogs } from '@mg-inside/frontend';
import { desktop, leaveGuard, setPending } from './desktop';
import { watch } from 'vue';
import NameEditor from './components/NameEditor.vue';
import MoveEditor from './components/MoveEditor.vue';
import FilePreview from './components/FilePreview.vue';
export const dialogs = createApplicationDialogs({ desktop, dialogs: [
  { id: 'file-name', title: '文件名称', path: '/dialogs/name', width: 500, height: 330, component: NameEditor },
  { id: 'file-move', title: '移动到文件夹', path: '/dialogs/move', width: 560, height: 420, component: MoveEditor },
  { id: 'file-preview', title: '文件预览', path: '/dialogs/preview', width: 900, height: 740, component: FilePreview },
] });
leaveGuard(() => dialogs.canClose());
watch(dialogs.active, value => setPending('dialog', !!(value?.dirty || value?.busy)));

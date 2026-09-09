import { createApplicationDialogs } from '@mg-inside/frontend';
import { desktop, registerLeaveGuard } from './desktop';
import ExternalApplicationEditor from './components/ExternalApplicationEditor.vue';
export const dialogs = createApplicationDialogs({ desktop, dialogs: [{ id: 'external-application', title: '外链应用', path: '/applications/editor', width: 560, height: 640, component: ExternalApplicationEditor }] });
registerLeaveGuard(() => dialogs.canClose(), () => Boolean(dialogs.active.value?.dirty || dialogs.active.value?.busy));

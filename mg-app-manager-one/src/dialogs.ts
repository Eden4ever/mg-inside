import { createApplicationDialogs } from '@mg-inside/frontend';
import { desktop, registerLeaveGuard } from './desktop';
import ExternalApplicationEditor from './components/ExternalApplicationEditor.vue';
import ApplicationDetails from './components/ApplicationDetails.vue';
import ApplicationRegistration from './components/ApplicationRegistration.vue';
export const dialogs = createApplicationDialogs({ desktop, dialogs: [
  { id: 'application-registration', title: '注册应用', path: '/applications/register', width: 560, height: 680, component: ApplicationRegistration },
  { id: 'external-application', title: '外链应用', path: '/applications/editor', width: 560, height: 720, component: ExternalApplicationEditor },
  { id: 'application-details', title: '应用详情', path: '/applications/details', width: 640, height: 760, component: ApplicationDetails },
] });
registerLeaveGuard(() => dialogs.canClose(), () => Boolean(dialogs.active.value?.dirty || dialogs.active.value?.busy));

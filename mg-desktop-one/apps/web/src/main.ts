import { configurePlatformOrigin } from '../../../../mg-platform/packages/frontend/auth/platform-origin';
import '../../../../mg-platform/packages/frontend/typography.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './desktop.css';
configurePlatformOrigin(location.origin);
createApp(App).use(createPinia()).mount('#app');

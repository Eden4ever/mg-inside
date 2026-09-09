import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import './style.css';
import App from './App.vue';
import { router } from './router';
createApp(App).use(ElementPlus,{locale:zhCn}).use(router).mount('#app');

import "./styles/mg-shell.css";
import "./styles/primary-pages.css";
import "./styles/identity-pages.css";

import '@mg-inside/frontend/embedded.css';
import '@mg-inside/frontend/layout.css';
import '@mg-inside/frontend/overlays.css';

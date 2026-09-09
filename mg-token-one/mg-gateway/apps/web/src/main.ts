import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import '@mg-inside/frontend/shell.css'
import '@/styles/global.css'
import App from './App.vue'
import { PageFrame } from '@mg-inside/frontend'
import router from './router'

const app = createApp(App)
app.component('MgPage', PageFrame)
app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')

import '@mg-inside/frontend/embedded.css';
import '@mg-inside/frontend/layout.css';
import '@mg-inside/frontend/overlays.css';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { applicationVersion } from '../mg-platform/packages/frontend/services/version-plugin';
import { fileURLToPath, URL } from 'node:url';
const platform = fileURLToPath(new URL('../mg-platform/packages/frontend', import.meta.url));
export default defineConfig({ base: process.env.VITE_APP_BASE || "/", plugins: [vue(), applicationVersion('app-manager')], resolve: { alias: { '@mg-inside/frontend': platform }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 14341, strictPort: true, fs: { allow: ['.', platform] } } });

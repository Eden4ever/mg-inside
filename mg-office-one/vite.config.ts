import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
const platform = fileURLToPath(new URL('../mg-platform/packages/frontend', import.meta.url));
export default defineConfig({ base: process.env.VITE_APP_BASE || '/', plugins: [vue()], resolve: { alias: { '@mg-inside/frontend': platform }, dedupe: ['vue'] }, server: { fs: { allow: ['.', platform] } } });

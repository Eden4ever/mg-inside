import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const rawBase = process.env.VITE_APP_BASE || env.VITE_APP_BASE || '/';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(rawBase)) throw new Error('VITE_APP_BASE 必须为站内路径，例如 / 或 /apps/identity/');
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  return { base, plugins:[vue()], resolve:{dedupe:['vue'],alias:{'@mg-inside/frontend':fileURLToPath(new URL('../../mg-platform/packages/frontend',import.meta.url)),'@':fileURLToPath(new URL('./src',import.meta.url))}}, server:{port:4201,fs:{allow:['..','../../mg-platform/packages/frontend']},proxy:{'/api':'http://127.0.0.1:4200','/interaction':'http://127.0.0.1:4200'}}, build:{outDir:'dist',chunkSizeWarningLimit:1100} };
});

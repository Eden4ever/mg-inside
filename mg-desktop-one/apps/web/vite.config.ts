import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue(), { name: 'public-platform-fonts', configureServer(server) {
    server.middlewares.use((req, res, next) => { if (req.url?.startsWith('/fonts/')) res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
  } }],
  resolve: { dedupe: ['vue'] },
  // API 的来源/凭据规则由桌面后端校验，预检也必须完整转发。
  server: { port: 4301, strictPort: true, cors: false, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url)), fileURLToPath(new URL('../../../mg-platform', import.meta.url))] },
    proxy: { '/api': 'http://127.0.0.1:4300', '/auth': 'http://127.0.0.1:4300' } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});

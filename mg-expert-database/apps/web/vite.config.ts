import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.VITE_APP_BASE_URL || '/',
  plugins: [vue(), {
    name: 'local-login-defaults',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__local-login-defaults', (req, res) => {
        const address = req.socket.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '') || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const env = loadEnv('development', fileURLToPath(new URL('../..', import.meta.url)), 'SEED_ADMIN_');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ username: env.SEED_ADMIN_USERNAME || 'admin', password: env.SEED_ADMIN_PASSWORD || '' }));
      });
    },
  }],
  resolve: {
    dedupe: ['vue'],
    alias: {
      '@mg-inside/frontend': fileURLToPath(new URL('../../../mg-platform/packages/frontend', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    headers: { 'Content-Security-Policy': `frame-ancestors 'self' ${process.env.VITE_DESKTOP_ORIGIN || 'https://desktop.meta-gravity.com'}` },
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
    },
    fs: {
      allow: ['../..', '../../../mg-platform/packages/frontend'],
    },
  },
  test: {
    maxWorkers: 2,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
  },
});

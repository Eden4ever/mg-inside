import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    dedupe: ['vue'],
    alias: {
      '@mg-inside/frontend': fileURLToPath(new URL('../../../../mg-platform/packages/frontend', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['.', '../../../../mg-platform/packages/frontend'] },
    headers: { 'Content-Security-Policy': `frame-ancestors 'self' ${process.env.VITE_DESKTOP_ORIGIN || 'https://desktop.meta-gravity.com'}` },
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/v1': { target: process.env.VITE_TOKEN_PROXY || 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})

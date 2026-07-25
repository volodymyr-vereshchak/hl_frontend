/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Backend to proxy /api to during `npm run dev`.
// v2 stack runs FastAPI on :8001. Override with VITE_PROXY_TARGET.
const PROXY_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      // The app calls the backend under /api; strip the prefix on the way out.
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/xlsx')) return 'vendor-xlsx'
          if (id.includes('/recharts') || id.includes('/d3-')) return 'vendor-charts'
          if (id.includes('/@mantine/')) return 'vendor-mantine'
          if (id.includes('/@tanstack/')) return 'vendor-table'
          if (id.includes('/react-router') || id.includes('/react-dom')) return 'vendor-react'
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})

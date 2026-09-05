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
          // recharts and its d3 packages are deliberately NOT named here.
          // Naming them made one chunk that the entry ended up importing
          // a shared helper from, so all 358 KB sat on the critical path
          // even though only chart views need it. Unnamed, it lands in
          // the lazy route chunks that actually draw charts.
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

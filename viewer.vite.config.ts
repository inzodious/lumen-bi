/**
 * The published-dashboard viewer: a static, self-contained web app (src/renderer/viewer/index.html) that Lumen copies
 * next to `report.wbi` when publishing. Built into out/viewer with relative URLs so it runs from any folder.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer/viewer'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve(import.meta.dirname, 'src/core'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared')
    }
  },
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    outDir: resolve(import.meta.dirname, 'out/viewer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/viewer/index.html') }
  }
})

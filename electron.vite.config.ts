import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { lumenIconData } from './scripts/icons/icon-data-plugin.ts'

const alias = {
  '@core': resolve(import.meta.dirname, 'src/core'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
  '@shared': resolve(import.meta.dirname, 'src/shared')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    resolve: { alias },
    // icon libraries: per-set data chunks loaded on demand (docs/ICONS.md)
    plugins: [react(), lumenIconData()],
    worker: { format: 'es' },
    optimizeDeps: { include: ['sql.js'] }
  }
})

import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(import.meta.dirname, 'src/core'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@parity/lakehouse/node': resolve(import.meta.dirname, 'tests/support/lakehouse/node-entry.ts'),
      '@parity/lakehouse': resolve(import.meta.dirname, 'tests/support/lakehouse/index.ts')
    }
  },
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'datasets/**/*.test.ts', 'scripts/**/*.test.mjs', 'server/**/*.test.mjs'], exclude: ['**/node_modules/**', 'datasets/out/**'],
    testTimeout: 60000
  }
})

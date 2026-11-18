/**
 * Runs the reference-table generators (scripts/docs/gen-*.gen.ts) under vitest, so they can import the
 * TypeScript registries (DAX functions, M standard library, connectors) with the app's path aliases.
 *
 *   npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts            # all tables
 *   npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts gen-dax    # one table
 *
 * They are not part of `npm test` (the main config only picks up *.test.* files).
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const ROOT = resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: ROOT,
  resolve: {
    alias: {
      '@core': resolve(ROOT, 'src/core'),
      '@renderer': resolve(ROOT, 'src/renderer/src'),
      '@shared': resolve(ROOT, 'src/shared')
    }
  },
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['scripts/docs/gen-*.gen.ts'],
    testTimeout: 60000
  }
})

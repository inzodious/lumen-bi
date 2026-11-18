/**
 * End-to-end UI journeys (Playwright Electron driver against the built app). Run with `e2e/run.sh`
 * (builds, then runs under xvfb-run). Each *.e2e.ts file owns one app instance; files run in parallel workers.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // keep vite's cache in the shared node_modules (not e2e/node_modules)
  cacheDir: '../node_modules/.vite-e2e',
  test: {
    root: import.meta.dirname,
    include: ['**/*.e2e.ts'],
    testTimeout: 120_000,
    hookTimeout: 150_000,
    // expect.poll: UI reacts asynchronously (queries, previews, refresh); default 1 s is too tight
    expect: { poll: { timeout: 20_000, interval: 100 } },
    // each worker drives its own Electron process; keep the machine responsive
    maxWorkers: Number(process.env['LUMEN_E2E_WORKERS'] ?? 3),
    fileParallelism: process.env['LUMEN_E2E_WORKERS'] !== '1',
    reporters: process.env['CI'] ? ['default'] : ['verbose']
  }
})

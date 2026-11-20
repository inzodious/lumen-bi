import { resolve } from 'node:path'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { build as viteBuild, type Plugin } from 'vite'

const alias = {
  '@core': resolve(import.meta.dirname, 'src/core'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
  '@shared': resolve(import.meta.dirname, 'src/shared')
}

/**
 * Code visual frame (src/renderer/codeframe): the runtime of the sandboxed iframe and the React runtime it loads for
 * JSX, each bundled as one classic script (IIFE; the frame has an opaque origin, so no module scripts), plus frame.html.
 * Emitted as `codeframe/*` next to the renderer build; served to the frame by the main process (src/main/codeFrame.ts).
 * In dev (`npm run dev`) the files are written to out/renderer/codeframe, where the main process looks for them.
 */
function codeFramePlugin(): Plugin {
  const dir = resolve(import.meta.dirname, 'src/renderer/codeframe')
  const bundle = async (entry: string, name: string): Promise<string> => {
    const out: any = await viteBuild({
      configFile: false,
      logLevel: 'warn',
      resolve: { alias },
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        write: false,
        minify: true,
        assetsInlineLimit: 1_000_000,
        lib: { entry: resolve(dir, entry), formats: ['iife'], name, fileName: () => `${name}.js` }
      }
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o: any) => o.output ?? [])
    const chunk = outputs.find((o: any) => o.type === 'chunk')
    if (!chunk) throw new Error(`codeframe: no output for ${entry}`)
    return chunk.code as string
  }
  const fontDir = resolve(import.meta.dirname, 'src/renderer/src/assets/fonts/selawik')
  const files = async (): Promise<Record<string, string | Uint8Array>> => ({
    'codeframe/frame.html': readFileSync(resolve(dir, 'frame.html'), 'utf8'),
    'codeframe/frame.js': await bundle('frame.ts', 'lumenCodeFrame'),
    'codeframe/react.js': await bundle('react.ts', 'lumenCodeReact'),
    ...Object.fromEntries(readdirSync(fontDir).filter((f) => f.endsWith('.woff2')).map((f) => [`codeframe/fonts/${f}`, new Uint8Array(readFileSync(resolve(fontDir, f)))]))
  })
  let command: 'build' | 'serve' = 'build'
  return {
    name: 'lumen-codeframe',
    configResolved(c) {
      command = c.command
    },
    async generateBundle() {
      if (command !== 'build') return
      for (const [fileName, source] of Object.entries(await files())) this.emitFile({ type: 'asset', fileName, source })
    },
    async configureServer() {
      const outDir = resolve(import.meta.dirname, 'out/renderer')
      for (const [f, source] of Object.entries(await files())) {
        mkdirSync(resolve(outDir, f, '..'), { recursive: true })
        writeFileSync(resolve(outDir, f), source)
      }
    }
  }
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
    plugins: [react(), codeFramePlugin()],
    worker: { format: 'es' },
    optimizeDeps: { include: ['sql.js'] }
  }
})

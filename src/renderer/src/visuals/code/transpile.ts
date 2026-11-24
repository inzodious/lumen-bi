/**
 * Code visual: JSX (and TypeScript-flavoured JSX) → CommonJS for the frame, with Sucrase, loaded lazily (its chunk is
 * fetched the first time a visual with JSX renders or the JSX tab is edited; reports without JSX never load it).
 *
 * Sucrase keeps line numbers (each output line comes from the same input line), so runtime errors in the frame map back
 * to the author's line directly. Transpile errors carry Sucrase's `loc` (line / column).
 */

export type TranspileResult = { ok: true; code: string } | { ok: false; message: string; line?: number; column?: number }

type SucraseTransform = (code: string, opts: Record<string, unknown>) => { code: string }

let loader: Promise<SucraseTransform> | null = null
function loadSucrase(): Promise<SucraseTransform> {
  loader ??= import('sucrase').then((m) => m.transform as unknown as SucraseTransform)
  return loader
}

const cache = new Map<string, TranspileResult>()

/** Synchronous cache lookup (a visual re-rendering with unchanged code). */
export function cachedTranspile(src: string): TranspileResult | undefined {
  return cache.get(src)
}

export async function transpileJsx(src: string): Promise<TranspileResult> {
  const hit = cache.get(src)
  if (hit) return hit
  const transform = await loadSucrase()
  let out: TranspileResult
  try {
    const r = transform(src, { transforms: ['jsx', 'typescript', 'imports'], jsxRuntime: 'classic', production: true, filePath: 'visual.jsx' })
    out = { ok: true, code: r.code }
  } catch (e) {
    const err = e as Error & { loc?: { line: number; column: number } }
    const message = String(err.message ?? e).replace(/\s*\(\d+:\d+\)\s*$/, '')
    out = { ok: false, message, ...(err.loc ? { line: err.loc.line, column: err.loc.column + 1 } : {}) }
  }
  if (cache.size > 64) cache.clear()
  cache.set(src, out)
  return out
}

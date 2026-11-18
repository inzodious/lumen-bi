/**
 * Performance analyzer metering for the canvas: each visual's host context gets an engine proxy that times the
 * query calls the visual makes (summarize / distinctValues / evaluateScalar / runDaxQuery…) and remembers the requests,
 * so the container can log "DAX query" vs "Visual display" time like PBI's Performance analyzer.
 * Cache hits (cachedEngine) are timed too — they show up as ~0 ms queries, which matches PBI's cached-query behavior.
 */
import type { QueryEngine } from '@core/engine/api'

export interface PerfMeter {
  queryMs: number
  queries: string[]
}

const QUERY_METHODS = new Set(['summarize', 'distinctValues', 'evaluateScalar', 'runDaxQuery', 'resolveFieldParameter', 'evaluateVisualCalculations'])
const MAX_QUERIES = 20
/** Timed but not listed by "Copy query": metadata lookups that are not a query PBI would show (field parameters). */
const UNLISTED_METHODS = new Set(['resolveFieldParameter'])

/** The DAX text PBI's "Copy query" would give, when the engine can produce it; else the request as JSON. */
export function describe(method: string, args: unknown[], engine?: QueryEngine): string {
  try {
    // the engine's DAX forms already start with PBI's "// DAX Query" header
    if (method === 'summarize' && engine?.toDaxQuery) return engine.toDaxQuery(args[0] as never)
    // visuals with visual calculations: PBI's DEFINE COLUMN '__DS0VisualCalcs'[…] … WITH VISUAL SHAPE / DENSIFY form
    if (method === 'evaluateVisualCalculations' && engine?.toVisualCalcDaxQuery) return engine.toVisualCalcDaxQuery(args[0] as never)
    if (method === 'runDaxQuery' && typeof args[0] === 'string') return `// DAX Query\n${args[0]}`
    if (method === 'evaluateScalar' && typeof args[0] === 'string') return `// DAX Query\nEVALUATE { ${args[0]} }`
  } catch {
    // fall through to the request form
  }
  try {
    const body = JSON.stringify(args.length === 1 ? args[0] : args, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2)
    return `// ${method}\n${body}`
  } catch {
    return `// ${method}`
  }
}

export function newMeter(): PerfMeter {
  return { queryMs: 0, queries: [] }
}

/** Wrap an engine so query calls are timed into `meter` (only while `enabled()`). */
export function meteredEngine(engine: QueryEngine, meter: PerfMeter, enabled: () => boolean): QueryEngine {
  return new Proxy(engine, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver)
      if (typeof v !== 'function') return v
      const name = String(prop)
      if (!QUERY_METHODS.has(name)) return (v as (...a: unknown[]) => unknown).bind(target)
      return (...args: unknown[]) => {
        if (!enabled()) return (v as (...a: unknown[]) => unknown).apply(target, args)
        const t0 = performance.now()
        try {
          const out = (v as (...a: unknown[]) => unknown).apply(target, args)
          if (out && typeof (out as Promise<unknown>).then === 'function') {
            return (out as Promise<unknown>).finally(() => {
              meter.queryMs += performance.now() - t0
            })
          }
          return out
        } finally {
          meter.queryMs += performance.now() - t0
          if (meter.queries.length < MAX_QUERIES && !UNLISTED_METHODS.has(name)) meter.queries.push(describe(name, args, target))
        }
      }
    }
  })
}

/** ctx → meter (set by the host; read by the container when logging). */
export const meters = new WeakMap<object, PerfMeter>()

/**
 * Query memoization for the canvas: wraps a QueryEngine so identical visual queries (same request JSON —
 * i.e. same fields, filters, sort) are answered from an LRU cache. One cache per engine instance: the store
 * rebuilds the engine on data / model changes, which naturally invalidates everything. Dragging / resizing
 * a visual re-renders it but re-runs no query.
 */
import type { QueryEngine } from '@core/engine/api'

const LIMIT = 600

class Lru<V> {
  private map = new Map<string, V>()
  get(k: string): V | undefined {
    const v = this.map.get(k)
    if (v !== undefined) {
      this.map.delete(k)
      this.map.set(k, v)
    }
    return v
  }
  set(k: string, v: V): void {
    this.map.set(k, v)
    if (this.map.size > LIMIT) this.map.delete(this.map.keys().next().value as string)
  }
  clear(): void {
    this.map.clear()
  }
}

function keyOf(method: string, args: unknown[]): string | undefined {
  try {
    return method + ':' + JSON.stringify(args, (_k, v) => (v instanceof Date ? `\u0000d${v.getTime()}` : v))
  } catch {
    return undefined
  }
}

const CACHED = new Set(['summarize', 'distinctValues', 'evaluateScalar', 'describeField', 'resolveFieldParameter'])
const wrappers = new WeakMap<QueryEngine, QueryEngine>()

export function cachedEngine(engine: QueryEngine): QueryEngine {
  const hit = wrappers.get(engine)
  if (hit) return hit
  const cache = new Lru<{ value?: unknown; error?: unknown }>()
  const proxy = new Proxy(engine, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver)
      if (typeof v !== 'function') return v
      const name = String(prop)
      if (name === 'invalidate' || name === 'processCalculated') {
        return (...args: unknown[]) => {
          cache.clear()
          return (v as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      if (!CACHED.has(name)) return (v as (...a: unknown[]) => unknown).bind(target)
      return (...args: unknown[]) => {
        const k = keyOf(name, args)
        if (k !== undefined) {
          const c = cache.get(k)
          if (c) {
            if ('error' in c) throw c.error
            return c.value
          }
        }
        try {
          const value = (v as (...a: unknown[]) => unknown).apply(target, args)
          if (k !== undefined) cache.set(k, { value })
          return value
        } catch (error) {
          if (k !== undefined) cache.set(k, { error })
          throw error
        }
      }
    }
  })
  wrappers.set(engine, proxy)
  return proxy
}

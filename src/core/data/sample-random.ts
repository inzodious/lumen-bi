/**
 * Deterministic randomness for the built-in sample project (src/core/data/sample.ts).
 * Everything here is seeded so two calls to `createSampleProject()` produce identical data,
 * identical object names and an identical report.
 */

/** mulberry32: tiny, fast, good-enough 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number

/** Integer in [min, max] (inclusive). */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** Poisson-distributed integer (Knuth; fine for the small means used here). */
export function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0
  if (mean > 30) {
    // normal approximation keeps it O(1) for large means
    const g = gaussian(rng)
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * g))
  }
  const limit = Math.exp(-mean)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > limit)
  return k - 1
}

/** Standard normal deviate (Box–Muller). */
export function gaussian(rng: Rng): number {
  let u = 0
  while (u === 0) u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Draw indexes proportionally to fixed weights (cumulative table + binary search). */
export class WeightedPicker {
  private readonly cum: Float64Array
  private readonly total: number

  constructor(weights: readonly number[]) {
    this.cum = new Float64Array(weights.length)
    let acc = 0
    for (let i = 0; i < weights.length; i++) {
      acc += Math.max(0, weights[i])
      this.cum[i] = acc
    }
    this.total = acc
  }

  /** Index drawn among the first `limit` items only (all by default). */
  pick(rng: Rng, limit = this.cum.length): number {
    const n = Math.min(limit, this.cum.length)
    if (n <= 0) return 0
    const target = rng() * (n === this.cum.length ? this.total : this.cum[n - 1])
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.cum[mid] > target) hi = mid
      else lo = mid + 1
    }
    return lo
  }
}

export function pickOne<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

/**
 * Deterministic 20-character hex id derived from a string (PBIR-style object names, e.g. visual
 * folder names). FNV-1a based; stable across runs and platforms.
 */
export function hexId(key: string): string {
  let out = ''
  let salt = 0
  while (out.length < 20) {
    let h = 0x811c9dc5 ^ salt
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += (h >>> 0).toString(16).padStart(8, '0')
    salt = (salt + 0x9e3779b9) >>> 0
  }
  return out.slice(0, 20)
}

/** Deterministic RFC-4122-shaped (v4 layout) UUID derived from a string — used for lineage tags. */
export function stableUuid(key: string): string {
  const a = hexId(key + '#a')
  const b = hexId(key + '#b')
  const hex = (a + b).slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

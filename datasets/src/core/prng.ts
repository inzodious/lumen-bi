/**
 * Deterministic pseudo-random numbers and distributions.
 *
 * `Rng` is an sfc32 generator seeded from a string (cyrb128). Every generator can `fork(label)` a
 * child stream whose sequence depends only on the parent's seed string and the label, so the
 * output of one table never shifts when another table draws more or fewer numbers.
 * Same seed string => identical sequence on every platform (pure 32-bit integer arithmetic).
 */

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** 32-bit string hash (stable across runs/platforms). */
export function hash32(str: string): number {
  return cyrb128(str)[0]
}

/** Deterministic RFC-4122-shaped UUID derived from a string (version nibble 5, variant 8-b). */
export function uuidFrom(str: string): string {
  const [a, b, c, d] = cyrb128(str)
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  const s = hex(a) + hex(b) + hex(c) + hex(d)
  const variant = ((parseInt(s[16], 16) & 0x3) | 0x8).toString(16)
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-5${s.slice(13, 16)}-${variant}${s.slice(17, 20)}-${s.slice(20, 32)}`
}

/** Cumulative-weight picker with binary search (O(log n) per draw). */
export interface WeightedPicker<T> {
  (rng: Rng): T
  items: readonly T[]
}

export class Rng {
  readonly seed: string
  private a: number
  private b: number
  private c: number
  private d: number
  private spare: number | null = null

  constructor(seed: string | number) {
    this.seed = String(seed)
    const [a, b, c, d] = cyrb128(this.seed)
    this.a = a
    this.b = b
    this.c = c
    this.d = d
    for (let i = 0; i < 12; i++) this.nextU32()
  }

  /** Independent child stream: depends only on (this.seed, label). */
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`)
  }

  nextU32(): number {
    this.a >>>= 0
    this.b >>>= 0
    this.c >>>= 0
    this.d >>>= 0
    let t = (this.a + this.b) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = (this.c << 21) | (this.c >>> 11)
    this.d = (this.d + 1) | 0
    t = (t + this.d) | 0
    this.c = (this.c + t) | 0
    return t >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list')
    return items[Math.floor(this.next() * items.length)]
  }

  /** Weighted choice; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0
    for (const w of weights) total += w
    let r = this.next() * total
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]
      if (r < 0) return items[i]
    }
    return items[items.length - 1]
  }

  /** Standard normal via Box-Muller (cached pair). */
  gauss(): number {
    if (this.spare !== null) {
      const s = this.spare
      this.spare = null
      return s
    }
    let u = 0
    while (u === 0) u = this.next()
    const v = this.next()
    const r = Math.sqrt(-2 * Math.log(u))
    this.spare = r * Math.sin(2 * Math.PI * v)
    return r * Math.cos(2 * Math.PI * v)
  }

  normal(mean: number, sd: number): number {
    return mean + sd * this.gauss()
  }

  /** Normal clamped to [min, max]. */
  normalClamped(mean: number, sd: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.normal(mean, sd)))
  }

  /** Log-normal parameterised by its median and log-space sigma (right-skewed amounts). */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.gauss())
  }

  exponential(mean: number): number {
    let u = 0
    while (u === 0) u = this.next()
    return -Math.log(u) * mean
  }

  /** Poisson count (Knuth for small lambda, normal approximation for large). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0
    if (lambda > 40) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))))
    const l = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > l)
    return k - 1
  }

  /** Gamma(shape, scale) via Marsaglia–Tsang. */
  gamma(shape: number, scale = 1): number {
    if (shape < 1) {
      const u = this.next()
      return this.gamma(1 + shape, scale) * Math.pow(u === 0 ? 1e-12 : u, 1 / shape)
    }
    const d = shape - 1 / 3
    const c = 1 / Math.sqrt(9 * d)
    for (;;) {
      let x = 0
      let v = 0
      do {
        x = this.gauss()
        v = 1 + c * x
      } while (v <= 0)
      v = v * v * v
      const u = this.next()
      if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale
    }
  }

  /** Beta(alpha, beta) in (0, 1). */
  beta(alpha: number, beta: number): number {
    const x = this.gamma(alpha)
    const y = this.gamma(beta)
    return x / (x + y)
  }

  /** Beta parameterised by mean (0..1) and concentration (higher = tighter). */
  betaMean(mean: number, concentration: number): number {
    return this.beta(Math.max(1e-3, mean * concentration), Math.max(1e-3, (1 - mean) * concentration))
  }

  triangular(min: number, mode: number, max: number): number {
    const u = this.next()
    const f = (mode - min) / (max - min)
    return u < f ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode))
  }

  /** Fisher–Yates in place; returns the array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = items[i]
      items[i] = items[j]
      items[j] = t
    }
    return items
  }

  /** k distinct items (order random). */
  sample<T>(items: readonly T[], k: number): T[] {
    const copy = items.slice()
    const n = Math.min(k, copy.length)
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(this.next() * (copy.length - i))
      const t = copy[i]
      copy[i] = copy[j]
      copy[j] = t
    }
    return copy.slice(0, n)
  }

  /** Random string from an alphabet. */
  chars(n: number, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string {
    let s = ''
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(this.next() * alphabet.length)]
    return s
  }
}

/** Build a reusable weighted picker (cumulative weights + binary search). */
export function weightedPicker<T>(items: readonly T[], weights: readonly number[]): WeightedPicker<T> {
  if (items.length !== weights.length || items.length === 0) throw new Error('weightedPicker: bad input')
  const cum = new Float64Array(items.length)
  let total = 0
  for (let i = 0; i < items.length; i++) {
    total += Math.max(0, weights[i])
    cum[i] = total
  }
  const fn = ((rng: Rng) => {
    const r = rng.next() * total
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] > r) hi = mid
      else lo = mid + 1
    }
    return items[lo]
  }) as WeightedPicker<T>
  fn.items = items
  return fn
}

/** Zipf-like weights 1/(i+1)^s — a few items dominate (best sellers, busy stations...). */
export function zipfWeights(n: number, s = 1): number[] {
  const w: number[] = []
  for (let i = 0; i < n; i++) w.push(1 / Math.pow(i + 1, s))
  return w
}

export function round(v: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

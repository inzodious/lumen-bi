/** Mock-data helpers for the live dashboards (all deterministic: every generator takes a seeded rng). */
import { rng } from '../templates/lib.mjs'

export { rng }

/** The period every dashboard covers: two calendar years, the second through October (complete months only). */
export const START = '2025-01-01'
export const END = '2026-10-31'

const utc = (s) => new Date(`${s}T00:00:00Z`)

export function days(start = START, end = END) {
  const out = []
  for (let d = utc(start); d <= utc(end); d = new Date(d.getTime() + 86400000)) out.push(d)
  return out
}

export function monthStarts(start = START, end = END) {
  return days(start, end).filter((d) => d.getUTCDate() === 1)
}

export const iso = (d) => d.toISOString().slice(0, 10)
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000)
export const daysInMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()

/** Months since the start of the period (0 for January 2025): drives growth trends. */
export const monthIndex = (d) => (d.getUTCFullYear() - 2025) * 12 + d.getUTCMonth()

/** Seasonal multiplier: peak in month `peak` (0-based, may be fractional), amplitude `amp`. */
export function season(d, peak, amp) {
  const m = d.getUTCMonth() + (d.getUTCDate() - 1) / 31
  return 1 + amp * Math.cos(((m - peak) / 12) * Math.PI * 2)
}

/** Multiplicative noise around 1. */
export const wobble = (r, spread) => 1 + (r() * 2 - 1) * spread

/** Poisson draw (Knuth; fine for the small rates used here). */
export function poisson(r, lambda) {
  if (lambda <= 0) return 0
  if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(r)))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= r()
  } while (p > L)
  return k - 1
}

export function normal(r) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())
}

/** Weighted pick from [[value, weight], …]. */
export function pick(r, weighted) {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let x = r() * total
  for (const [v, w] of weighted) if ((x -= w) <= 0) return v
  return weighted[weighted.length - 1][0]
}

export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

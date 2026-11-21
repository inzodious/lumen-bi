/** Sample-data helpers shared by the template designs (all deterministic). */
import { rng } from './lib.mjs'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const monthColumns = [
  { name: 'Month', type: 'string', sortBy: 'MonthNo' },
  { name: 'MonthNo', type: 'int64', hidden: true, summarize: 'none' }
]

/** Every combination of the given dimension lists: [[a1, b1], [a1, b2], …]. */
export function cross(...lists) {
  return lists.reduce((acc, list) => acc.flatMap((row) => list.map((v) => [...row, v])), [[]])
}

/** Seasonal multiplier for a month (0-based): peak at `peak`, amplitude `amp`. */
export function season(mi, peak = 11, amp = 0.15) {
  return 1 + amp * Math.cos(((mi - peak) / 12) * Math.PI * 2)
}

export function jitter(seed, spread = 0.08) {
  const r = rng(seed)
  return () => 1 + (r() * 2 - 1) * spread
}

export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d

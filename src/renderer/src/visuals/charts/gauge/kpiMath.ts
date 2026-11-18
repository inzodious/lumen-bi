/**
 * KPI status / goal math (pure).
 *
 *  - Direction: `goals.direction` ('High is good' | 'Low is good') or the older
 *    `status.direction` ('Positive' | 'Negative'); default High is good.
 *  - One goal: good when the value meets the goal (≥ for High is good, ≤ for Low is good), else bad.
 *  - Two goals (PBI supports up to two targets): beyond the better goal = good, beyond the worse
 *    goal = bad, between them = neutral.
 *  - No goal: no status (no icon, neutral gray trend).
 *  - Distance = value − goal; percent distance = (value − goal) / |goal| (null when goal is 0).
 */
import { formatFixed } from '../../common/units'

export type KpiDirection = 'high' | 'low'
export type KpiStatus = 'good' | 'neutral' | 'bad' | 'none'

export function kpiDirection(goalsDirection: string | undefined, statusDirection: string | undefined): KpiDirection {
  if (goalsDirection) return /low/i.test(goalsDirection) ? 'low' : 'high'
  if (statusDirection) return /neg|low/i.test(statusDirection) ? 'low' : 'high'
  return 'high'
}

export function kpiStatus(value: number | null, goals: Array<number | null>, direction: KpiDirection): KpiStatus {
  const g = goals.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  if (value === null || !Number.isFinite(value) || !g.length) return 'none'
  if (g.length === 1) {
    const ok = direction === 'high' ? value >= g[0] : value <= g[0]
    return ok ? 'good' : 'bad'
  }
  const lo = Math.min(g[0], g[1])
  const hi = Math.max(g[0], g[1])
  if (direction === 'high') return value >= hi ? 'good' : value < lo ? 'bad' : 'neutral'
  return value <= lo ? 'good' : value > hi ? 'bad' : 'neutral'
}

export function kpiDistance(value: number, goal: number): { abs: number; pct: number | null } {
  const abs = value - goal
  return { abs, pct: goal === 0 ? null : abs / Math.abs(goal) }
}

/** Signed percent text, e.g. "+12.34%" / "-3.10%". */
export function signedPercent(ratio: number | null, decimals = 2): string {
  if (ratio === null || !Number.isFinite(ratio)) return ''
  const v = ratio * 100
  return (v >= 0 ? '+' : '-') + formatFixed(Math.abs(v), decimals) + '%'
}

/**
 * Distance label per `goals.distanceLabel` ('Percent' default | 'Value' | 'Value, percent').
 * `valueText` is the formatted absolute distance (already signed by the caller).
 */
export function distanceText(kind: string | undefined, pctText: string, valueText: string): string {
  if (kind === 'Value') return valueText
  if (kind === 'Value, percent') return pctText ? `${valueText}, ${pctText}` : valueText
  return pctText
}

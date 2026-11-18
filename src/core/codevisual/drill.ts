/**
 * Code visual: the saved drill state (`lumenCode.drill`, JSON text). Native visuals keep drill state at runtime only;
 * a code visual also saves it in its visual.json so it survives save / reopen and undo covers it.
 *
 *   { "level": 1, "expandedLevel": 2, "path": [ [ { "expr": <SQ expr>, "value": "'Bikes'" } ] ] }
 * Values are PBIR literals (`'text'`, `12L`, `datetime'…'`), so dates and numbers round-trip exactly.
 */
import type { DataPointIdentity } from '../report/sq'
import { decodeLiteral, encodeLiteral } from '../report/literal'
import type { Scalar } from '../model/data'

export interface SavedDrill {
  level: number
  path: DataPointIdentity[]
  expandedLevel?: number
}

export function serializeDrill(d: SavedDrill | undefined): string | undefined {
  if (!d || (d.level === 0 && !d.path.length && !d.expandedLevel)) return undefined
  const out: Record<string, unknown> = { level: d.level }
  if (d.expandedLevel) out.expandedLevel = d.expandedLevel
  out.path = d.path.map((id) => id.fields.map((f) => ({ expr: f.expr, value: encodeLiteral(f.value as Scalar) })))
  return JSON.stringify(out)
}

export function parseDrill(text: string): SavedDrill | undefined {
  if (!text) return undefined
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object') return undefined
    const level = Number.isInteger(o.level) && o.level >= 0 && o.level < 64 ? o.level : 0
    const path: DataPointIdentity[] = Array.isArray(o.path)
      ? o.path
          .filter((id: unknown) => Array.isArray(id))
          .map((id: any[]) => ({ fields: id.filter((f) => f && typeof f === 'object' && f.expr).map((f) => ({ expr: f.expr, value: decodeLiteral(f.value) })) }))
      : []
    const out: SavedDrill = { level, path }
    if (Number.isInteger(o.expandedLevel) && o.expandedLevel > 0) out.expandedLevel = o.expandedLevel
    return out
  } catch {
    return undefined
  }
}

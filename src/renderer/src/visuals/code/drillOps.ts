/**
 * Code visual: drill transitions, the same ones the visual header and the context menu apply to native visuals
 * (report/Overlays.tsx buildVisualMenu): drill into a row, drill up, show next level, expand to next level.
 */
import { fieldKey, type DataPointIdentity, type SQExpr } from '@core/report/sq'
import type { DrillState } from '../contract'

/** Level of the deepest hierarchy field in an identity (-1 when none of its fields is a hierarchy level). */
export function pointLevel(levels: SQExpr[], id: DataPointIdentity): number {
  const keys = levels.map((e) => fieldKey(e))
  return Math.max(-1, ...id.fields.map((f) => keys.indexOf(fieldKey(f.expr))))
}

export function drillInto(d: DrillState, levels: SQExpr[], id: DataPointIdentity): DrillState | undefined {
  const lvl = pointLevel(levels, id)
  if (lvl < 0 || lvl >= levels.length - 1) return undefined
  return { ...d, level: lvl + 1, expandedLevel: undefined, path: [...d.path, id] }
}

export function drillUp(d: DrillState): DrillState | undefined {
  if (d.level === 0 && !d.path.length && !d.expandedLevel) return undefined
  if (d.expandedLevel && d.expandedLevel > d.level) return { ...d, expandedLevel: d.expandedLevel - 1 > d.level ? d.expandedLevel - 1 : undefined }
  return { ...d, path: d.path.slice(0, -1), level: Math.max(0, d.level - 1), expandedLevel: undefined }
}

export function nextLevel(d: DrillState, levelCount: number): DrillState | undefined {
  return d.level >= levelCount - 1 ? undefined : { ...d, level: d.level + 1, expandedLevel: undefined }
}

export function expandNextLevel(d: DrillState, levelCount: number): DrillState | undefined {
  const to = d.expandedLevel ?? d.level
  return to >= levelCount - 1 ? undefined : { ...d, expandedLevel: to + 1 }
}

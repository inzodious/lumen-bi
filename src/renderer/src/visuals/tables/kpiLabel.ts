/**
 * Display names of AS-style KPI parts. The engine exposes a KPI's goal / status / trend as hidden
 * measures named `_<measure> Goal|Status|Trend` (TOM naming); Power BI Desktop shows them in the field
 * list as "Goal" / "Status" / "Trend" under the KPI and labels them "<measure> Status" etc. in visuals
 * (column headers, card category labels) unless the projection was renamed.
 */
import type { FieldDescription } from '@core/engine/api'

const PART_NAME = { goal: 'Goal', status: 'Status', trend: 'Trend' } as const

/** "<measure> Status" for a KPI part description, else undefined. */
export function kpiPartLabel(d: Pick<FieldDescription, 'kpi'> | undefined): string | undefined {
  const k = d?.kpi
  if (!k?.measure || !k.part) return undefined
  return `${k.measure} ${PART_NAME[k.part] ?? k.part}`
}

/** Label of a projection: explicit display name, else the KPI part label, else `fallback`. */
export function kpiAwareLabel(displayName: string | undefined, d: Pick<FieldDescription, 'kpi'> | undefined, fallback: () => string): string {
  return displayName ?? kpiPartLabel(d) ?? fallback()
}

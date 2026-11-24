/**
 * Base theme resources of a report. Power BI writes the base theme it applied as a file
 * (`StaticResources/SharedResources/BaseThemes/<name>.json`), registers it in `report.json` `resourcePackages`
 * (`SharedResources` / item type `BaseTheme`) and records `reportVersionAtImport` in `themeCollection.baseTheme`
 * (required by the report schema). Reports Lumen creates reference `CY24SU10` by name only; `withBaseThemeResource`
 * completes the reference before a save so saved reports carry what Desktop's own files carry.
 *
 * Approximation: Lumen does not know the exact `reportVersionAtImport` Desktop would record for a new report; it writes
 * DEFAULT_REPORT_VERSION_AT_IMPORT, the value Lumen's legacy-layout conversion derives from layout version 5.61 (the
 * version current Desktop records for CY24SU10 in legacy layouts).
 */
import type { ResourceFile } from '../report/types'
import { DEFAULT_BASE_THEME } from '../report/theme'
import { themeVersion } from './legacy'
import { makeResource } from './resources'

export const DEFAULT_REPORT_VERSION_AT_IMPORT: { visual: string; report: string; page: string } = themeVersion('5.61') as never

export interface ThemedReport {
  report: any
  resources: Record<string, ResourceFile>
  /** true when anything was added */
  changed: boolean
}

/**
 * Complete the base theme reference of `report`: `reportVersionAtImport`, the theme file (when Lumen has the theme's
 * JSON: `json`, or the bundled CY24SU10) and its `resourcePackages` item. Inputs are not mutated.
 */
export function withBaseThemeResource(report: any, resources: Record<string, ResourceFile>, json?: unknown): ThemedReport {
  const base = report?.themeCollection?.baseTheme
  if (!base?.name) return { report, resources, changed: false }
  let changed = false
  let r = report
  if (!base.reportVersionAtImport) {
    const { name, type, ...rest } = base
    r = { ...r, themeCollection: { ...r.themeCollection, baseTheme: { name, reportVersionAtImport: { ...DEFAULT_REPORT_VERSION_AT_IMPORT }, type: type ?? 'SharedResources', ...rest } } }
    changed = true
  }
  if ((r.themeCollection.baseTheme.type ?? 'SharedResources') !== 'SharedResources') return { report: r, resources, changed }
  const pkgs: any[] = Array.isArray(r.resourcePackages) ? r.resourcePackages : []
  const shared = pkgs.find((p) => p?.type === 'SharedResources' || p?.name === 'SharedResources')
  const item = shared?.items?.find((i: any) => i?.name === base.name)
  const rel: string = item?.path ?? `BaseThemes/${base.name}.json`
  const path = `StaticResources/SharedResources/${rel}`
  let res = resources
  if (!res[path]) {
    const theme = json ?? (base.name === DEFAULT_BASE_THEME?.name ? DEFAULT_BASE_THEME : undefined)
    if (theme) {
      res = { ...res, [path]: makeResource(path, new TextEncoder().encode(JSON.stringify(theme))) }
      changed = true
    }
  }
  if (res[path] && !item) {
    const newItem = { name: base.name, path: rel, type: 'BaseTheme' }
    const next = shared
      ? pkgs.map((p) => (p === shared ? { ...p, items: [...(p.items ?? []), newItem] } : p))
      : [{ name: 'SharedResources', type: 'SharedResources', items: [newItem] }, ...pkgs]
    r = { ...r, resourcePackages: next }
    changed = true
  }
  return { report: r, resources: res, changed }
}

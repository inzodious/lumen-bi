/**
 * Headless refresh before a scripted package save (`refresh=1`, scripts/export-pbix.sh): refreshes every refreshable
 * table from its sources like the Refresh dialog does, without UI, and logs the outcome per table.
 */
import { refreshProject, refreshableTables } from '@core/data/refresh'
import { useApp } from '../state/store'
import { refreshHost } from '../views/powerquery/credentials'

export async function refreshProjectHeadless(): Promise<void> {
  const p = useApp.getState().project
  if (!p) return
  const res = await refreshProject(p, refreshHost(), { tables: refreshableTables(p.model) })
  useApp.getState().dataChanged()
  for (const t of res.tables) console.info(`[refresh] ${t.table}: ${t.ok ? `${t.rows ?? 0} rows` : `failed: ${t.error ?? ''}`}`)
}

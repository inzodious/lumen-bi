/** Filter scopes (visual / page / report) and the undoable card-list mutator. */
import type { ReportDocument } from '@core/report/types'
import { useApp } from '../../state/store'
import { findPage, findVisual, type FilterCard } from '../../report/pbir'

export type FilterScope = { level: 'visual'; page: string; visual: string } | { level: 'page'; page: string } | { level: 'report' }

/** JSON object that holds the scope's filterConfig (draft-safe: call inside mutateReport). */
export function scopeJson(r: ReportDocument, scope: FilterScope): any {
  if (scope.level === 'report') return r.report
  const page = findPage(r, scope.page)
  if (!page) return undefined
  if (scope.level === 'page') return page.json
  return findVisual(page, scope.visual)?.json
}

/** Mutate the card list of a scope (creates filterConfig when needed). */
export function mutateCards(scope: FilterScope, label: string, fn: (cards: FilterCard[]) => void): void {
  useApp.getState().mutateReport(label, (r) => {
    const json = scopeJson(r, scope)
    if (!json) return
    json.filterConfig ??= {}
    json.filterConfig.filters ??= []
    fn(json.filterConfig.filters)
    if (!json.filterConfig.filters.length) {
      delete json.filterConfig.filters
      if (!Object.keys(json.filterConfig).length) delete json.filterConfig
    }
  })
}


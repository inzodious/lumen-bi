/**
 * React hook: effective filters for every visual on a page, recomputed when the page / report filters or
 * the page's interaction state change. Per-visual results keep their identity while their content is
 * unchanged so memoized visuals don't re-render (or re-query) needlessly.
 */
import { useMemo, useRef } from 'react'
import type { PageDocument, ReportDocument } from '@core/report/types'
import type { DataPointIdentity, SQFilter } from '@core/report/sq'
import { useInteraction } from '../state/interaction'
import { getVisual } from '../visuals/registry'
import { computeVisualFilters, filtersKey, type EffectiveFilters } from './filters'
import { drillFiltersOthers, isGroup, isSlicerType } from './pbir'
import { pageSlicerFilters } from './runtime'

const EMPTY: SQFilter[] = []

export function supportsHighlight(visualType: string): boolean {
  return getVisual(visualType)?.supportsHighlight === true
}

function isSlicer(visualType: string): boolean {
  return getVisual(visualType)?.isSlicer ?? isSlicerType(visualType)
}

export function usePageFilters(report: ReportDocument, page: PageDocument, extraFilters?: SQFilter[]): Map<string, EffectiveFilters> {
  const applied = useInteraction((s) => s.slicers[page.name])
  const crossFilter = useInteraction((s) => s.crossFilter[page.name])
  const drillAll = useInteraction((s) => s.drill)
  const drillthrough = useInteraction((s) => s.drillthrough[page.name])
  const prev = useRef(new Map<string, { key: string; value: EffectiveFilters }>())

  const prefix = page.name + '/'
  const drillSig = Object.keys(drillAll)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k + JSON.stringify(drillAll[k]))
    .join('|')

  return useMemo(() => {
    const slicerFilters = pageSlicerFilters(page, applied)
    const drillOf = (name: string): DataPointIdentity[] | undefined => drillAll[prefix + name]?.path
    const otherDrillPaths: Record<string, DataPointIdentity[]> = {}
    for (const v of page.visuals) {
      const p = drillOf(v.name)
      if (p?.length && drillFiltersOthers(report, v.json)) otherDrillPaths[v.name] = p
    }
    const out = new Map<string, EffectiveFilters>()
    const nextPrev = new Map<string, { key: string; value: EffectiveFilters }>()
    for (const v of page.visuals) {
      if (isGroup(v)) continue
      const eff = computeVisualFilters({
        report,
        page,
        visualName: v.name,
        slicerFilters,
        crossFilter,
        drillPath: drillOf(v.name),
        otherDrillPaths,
        drillthrough: drillthrough ?? null,
        extraFilters,
        supportsHighlight,
        isSlicer
      })
      const key = filtersKey(eff.filters) + '#' + filtersKey(eff.highlightFilters)
      const old = prev.current.get(v.name)
      const value = old && old.key === key ? old.value : { filters: eff.filters.length ? eff.filters : EMPTY, highlightFilters: eff.highlightFilters.length ? eff.highlightFilters : EMPTY }
      nextPrev.set(v.name, { key, value })
      out.set(v.name, value)
    }
    prev.current = nextPrev
    return out
    // drillAll is represented by drillSig (only this page's entries matter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.report?.filterConfig, report.report?.settings, page, applied, crossFilter, drillSig, drillthrough, extraFilters])
}

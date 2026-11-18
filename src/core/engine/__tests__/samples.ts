/** Helpers for tests / profiling over the Microsoft public sample PBIX files (no client data). */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openProject } from '../../io/open'
import { nodeFs } from '../../io/nodefs'
import type { ProjectDocument } from '../../project'
import { fieldInfo, type SQFilter } from '../../report/sq'
import { createEngine } from '../engine'
import type { QueryEngine, SummarizeRequest } from '../api'

export const DIR = process.env.LUMEN_SAMPLES_DIR ?? process.env.WBI_PBIX_SAMPLES_DIR ?? resolve(import.meta.dirname, '../../../../../pbix-samples')
export const VERBOSE = !!process.env.WBI_SAMPLES_VERBOSE
export const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.pbix$/i.test(f)).sort() : []

/** Visual query approximated from the field wells (what runVisualQuery sends for most visuals). */
export function visualRequests(doc: ProjectDocument): Array<{ page: string; visual: string; req: SummarizeRequest }> {
  const out: Array<{ page: string; visual: string; req: SummarizeRequest }> = []
  const rep = doc.report
  if (!rep) return out
  const reportFilters: SQFilter[] = (rep.report?.filterConfig?.filters ?? []).map((f: any) => f.filter).filter(Boolean)
  for (const p of rep.pages) {
    const pageFilters: SQFilter[] = (p.json?.filterConfig?.filters ?? []).map((f: any) => f.filter).filter(Boolean)
    for (const v of p.visuals) {
      const qs = v.json?.visual?.query?.queryState
      if (!qs) continue
      const groupBy: SummarizeRequest['groupBy'] = []
      const values: SummarizeRequest['values'] = []
      for (const [role, bucket] of Object.entries<any>(qs)) {
        // hierarchy roles show one level at a time (the active one, else the top level), like runVisualQuery's drill level
        let projs: any[] = bucket?.projections ?? []
        const levels = projs.filter((p) => p.field?.HierarchyLevel)
        if (levels.length > 1) {
          const active = levels.find((p) => p.active) ?? levels[0]
          projs = projs.filter((p) => !p.field?.HierarchyLevel || p === active)
        }
        for (const pr of projs) {
          const info = fieldInfo(pr.field)
          if (info.kind === 'measure' || info.kind === 'aggregation') values.push({ id: `${role}|${pr.queryRef}|${values.length}`, expr: { kind: 'sq', expr: pr.field } })
          else if (!groupBy.some((g) => JSON.stringify(g) === JSON.stringify({ kind: 'sq', expr: pr.field }))) groupBy.push({ kind: 'sq', expr: pr.field })
        }
      }
      if (!groupBy.length && !values.length) continue
      const visualFilters: SQFilter[] = (v.json?.filterConfig?.filters ?? []).map((f: any) => f.filter).filter(Boolean)
      out.push({ page: p.json?.displayName ?? p.name, visual: `${v.json?.visual?.visualType ?? '?'}:${v.name}`, req: { groupBy, values, filters: [...reportFilters, ...pageFilters, ...visualFilters], limit: 30000 } })
    }
  }
  return out
}

export async function openSample(file: string): Promise<{ doc: ProjectDocument; engine: QueryEngine }> {
  const doc = await openProject(join(DIR, file), nodeFs)
  const engine = createEngine(doc.model, doc.data)
  engine.processCalculated()
  return { doc, engine }
}


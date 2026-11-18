/**
 * Query preview for the Power Query Editor: evaluates any M query text of the project (optionally up to
 * a given applied step) against real sources through the fetch-and-replay driver, with a data cache that
 * lives as long as the editor session (so clicking through steps doesn't refetch). "Refresh Preview"
 * clears the cache.
 */
import type { ProjectDocument } from '../project'
import { evaluateQuery, preview as previewValue, type ErrorInfo, type Preview } from '../m/engine.ts'
import { outlineQuery, stepRef, type QueryOutline } from '../m/editor.ts'
import { DataCache, DriverError, runWithData, type DataFetcher } from '../m/driver.ts'
import type { DataRequest } from '../m/host.ts'
import { kindOf, type ValueKind } from '../m/values.ts'
import { queryMap } from './queries'
import { createFetcher, privacyPlan, sourcesOfQuery, type RefreshHost } from './fetcher'

export const PREVIEW_ROW_LIMIT = 1000

export interface PreviewRequest {
  /** M text of the query being previewed */
  source: string
  /** query name (excluded from the cross-query scope so a query can't see its own draft as another query) */
  name?: string
  /** preview the value of this applied step instead of the query result */
  step?: string | null
  /** rows to materialize for the grid / column profile (default 1000, like PBI's profiling window) */
  rowLimit?: number
  /** other queries' sources overriding the model's (unsaved edits in the editor), name → M */
  queries?: Record<string, string>
  signal?: AbortSignal
  onFetch?: (requests: DataRequest[]) => void
}

export type PreviewOutcome = { ok: true; kind: ValueKind; preview: Preview } | { ok: false; error: ErrorInfo }

export interface QueryPreview {
  /** Applied steps (null when the query isn't a `let … in` expression) */
  outline: QueryOutline | null
  /** the step whose value is shown (null = query result) */
  step: string | null
  result: PreviewOutcome
  ms: number
  /** privacy-level notices (filters kept local, …) */
  warnings?: string[]
}

/** One Power Query Editor session: data cache + fetcher over the app host. */
export class QuerySession {
  readonly cache = new DataCache()
  private fetcher: DataFetcher

  constructor(
    private project: ProjectDocument,
    private readonly host: RefreshHost
  ) {
    this.fetcher = createFetcher(host)
  }

  setProject(project: ProjectDocument): void {
    this.project = project
  }

  /** Forget fetched data (Refresh Preview). */
  clearCache(): void {
    this.cache.clear()
  }

  /** Forget failed fetches only (after credentials changed). */
  clearErrors(): void {
    this.cache.clearErrors()
  }

  async preview(req: PreviewRequest): Promise<QueryPreview> {
    const t0 = Date.now()
    const outline = outlineQuery(req.source)
    const step = req.step && outline?.steps.some((s) => s.name === req.step) ? req.step : null
    const source = step && outline ? withResult(req.source, outline, step) : req.source
    const queries = { ...queryMap(this.project.model), ...(req.queries ?? {}) }
    if (req.name) delete queries[req.name]
    const limit = req.rowLimit ?? PREVIEW_ROW_LIMIT
    const privacy = privacyPlan(sourcesOfQuery(this.project.model, req.source, queries), this.host.privacy?.bind(this.host))
    const warnings = privacy.warnings.length ? privacy.warnings : undefined
    try {
      const result = await runWithData(
        (host): PreviewOutcome => {
          const ev = evaluateQuery(source, { host, queries, previewSteps: false })
          if (!ev.result.ok) return { ok: false, error: ev.result.error }
          // build the preview inside the pass so lazily fetched cells are part of it
          return { ok: true, kind: kindOf(ev.result.value), preview: previewValue(ev.result.value, limit) }
        },
        this.fetcher,
        { cache: this.cache, signal: req.signal, onFetch: req.onFetch, localOffsetMinutes: -new Date().getTimezoneOffset(), foldComputed: privacy.foldComputed }
      )
      return { outline, step, result, ms: Date.now() - t0, warnings }
    } catch (e) {
      if (req.signal?.aborted) throw e
      const message = e instanceof DriverError || e instanceof Error ? e.message : String(e)
      return { outline, step, result: { ok: false, error: { reason: 'Expression.Error', message } }, ms: Date.now() - t0 }
    }
  }
}

/** The query text with its `in` expression replaced by a reference to `step`. */
function withResult(source: string, outline: QueryOutline, step: string): string {
  const body = outline.result.trim()
  const idx = source.lastIndexOf(body)
  if (idx >= 0) return source.slice(0, idx) + stepRef(step) + source.slice(idx + body.length)
  return source
}

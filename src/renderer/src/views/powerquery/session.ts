/**
 * Preview evaluation for the Power Query Editor: one `QuerySession` per editor (its data cache makes
 * clicking through steps cheap), the draft's queries passed as overrides so unsaved edits are visible
 * to queries that reference them, and a runner that keeps the store's preview in sync with the
 * selection (stale evaluations are aborted).
 */
import { useEffect } from 'react'
import { QuerySession, type QueryPreview } from '@core/data/preview'
import type { DataRequest } from '@core/m/host.ts'
import type { ProjectDocument } from '@core/project'
import { useApp } from '../../state/store'
import { refreshHost } from './credentials'
import type { Draft, DraftQuery } from './logic/draft'
import { outlineQuery } from './logic/steps'
import { usePq } from './pqStore'

let session: QuerySession | null = null
let sessionProject: ProjectDocument | null = null

/** The editor's query session (created lazily for the open project). */
export function pqSession(): QuerySession | null {
  const project = useApp.getState().project
  if (!project) return null
  if (!session) session = new QuerySession(project, safeHost())
  if (sessionProject !== project) {
    session.setProject(project)
    sessionProject = project
  }
  return session
}

/** Drop the session (another project was opened). */
export function resetSession(): void {
  session = null
  sessionProject = null
}

function safeHost() {
  if (typeof window !== 'undefined' && window.wbi) return refreshHost()
  // no Electron bridge (tests / plain browser): sources fail with a clear error, #table queries work
  const fail = () => Promise.reject(new Error('No host available'))
  return {
    fs: { readFile: fail, writeFile: fail, list: fail, exists: () => Promise.resolve(false), stat: fail, mkdir: fail, remove: fail } as never,
    connectors: { sqlQuery: fail, sqlListItems: fail, http: fail } as never,
    now: () => new Date()
  }
}

/** name → M of every draft query (overrides the model's queries during evaluation). */
export function draftSources(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of draft.queries) out[q.name] = q.source
  return out
}

/** Human label of a pending data request ("Waiting for <label>…"). */
export function describeRequest(r: DataRequest): string {
  switch (r.kind) {
    case 'sql':
    case 'sql-items':
      return `${r.server}${r.database ? `;${r.database}` : ''}`
    case 'sql-databases':
      return r.server
    case 'file':
    case 'folder':
      return r.path
    case 'http':
      return r.url
    case 'decode':
      return r.format === 'xlsx' ? 'Excel workbook' : 'Parquet file'
    case 'lakehouse-contents':
      return 'Lakehouse'
    case 'sharepoint-files':
      return r.url
    case 'db':
    case 'db-items':
      return r.driver === 'sqlite' ? r.server : `${r.server}${r.database ? `;${r.database}` : ''}`
    case 'db-databases':
      return r.server
    case 'firestore-collections':
      return `Firestore ${r.project}${r.parent ? `/${r.parent}` : ''}`
    case 'firestore-query':
      return `Firestore ${r.project}/${r.parent ? `${r.parent}/` : ''}${r.collection}`
    case 's3-list':
      return `s3://${r.bucket}/${r.prefix}`
    case 's3-object':
      return `s3://${r.bucket}/${r.key}`
  }
}

export interface PreviewOptions {
  step?: string | null
  rowLimit?: number
  signal?: AbortSignal
  onFetch?(requests: DataRequest[]): void
  /** override the draft (dialogs previewing other queries) */
  draft?: Draft
}

/** Evaluates a draft query (optionally up to a step). */
export function previewDraftQuery(q: Pick<DraftQuery, 'name' | 'source'>, opts: PreviewOptions = {}): Promise<QueryPreview> {
  const s = pqSession()
  if (!s) return Promise.reject(new Error('No project is open.'))
  const draft = opts.draft ?? usePq.getState().draft
  return s.preview({ source: q.source, name: q.name, step: opts.step ?? null, rowLimit: opts.rowLimit, queries: draftSources(draft), signal: opts.signal, onFetch: opts.onFetch })
}

/** The selected step of a query, normalised: null when it is the last step (or doesn't exist). */
export function effectiveStep(source: string, step: string | null | undefined): string | null {
  if (!step) return null
  const o = outlineQuery(source)
  if (!o) return null
  const i = o.steps.findIndex((s) => s.name === step)
  if (i < 0 || i === o.steps.length - 1) return null
  return step
}

function sourcesSignature(draft: Draft, selfId: string): string {
  let h = 0
  for (const q of draft.queries) {
    if (q.id === selfId) continue
    const s = `${q.name}\u0000${q.source}`
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  }
  return String(h)
}

let current: AbortController | null = null
let scan: AbortController | null = null

/** Re-evaluate the shown preview now (also used after credentials changed). */
export function requestPreview(force = false): void {
  if (force) usePq.setState((s) => ({ nonce: s.nonce + 1 }))
}

/** Finds the first failing step of a query (for the Applied Steps warning icon / Go To Error). */
async function scanErrorStep(q: DraftQuery, signal: AbortSignal): Promise<void> {
  const outline = outlineQuery(q.source)
  if (!outline || outline.steps.length < 2) {
    if (outline?.steps[0]) usePq.setState((s) => ({ errorSteps: { ...s.errorSteps, [q.id]: outline.steps[0]!.name } }))
    return
  }
  for (const step of outline.steps.slice(0, 40)) {
    if (signal.aborted) return
    try {
      const r = await previewDraftQuery(q, { step: step.name, rowLimit: 20, signal })
      if (signal.aborted) return
      if (!r.result.ok) {
        usePq.setState((s) => ({ errorSteps: { ...s.errorSteps, [q.id]: step.name } }))
        return
      }
    } catch {
      return
    }
  }
}

/**
 * Keeps `usePq.preview` in sync with the selected query + step. Mount once (the editor does).
 * Returns nothing; read the store.
 */
export function usePreviewRunner(): void {
  const q = usePq((s) => s.draft.queries.find((x) => x.id === s.selectedId) ?? null)
  const rawStep = usePq((s) => (s.selectedId ? (s.steps[s.selectedId] ?? null) : null))
  const nonce = usePq((s) => s.nonce)
  const others = usePq((s) => (s.selectedId ? sourcesSignature(s.draft, s.selectedId) : ''))
  const project = useApp((s) => s.project)

  const step = q ? effectiveStep(q.source, rawStep) : null
  const key = q ? JSON.stringify([q.id, q.name, q.source, step, others, nonce]) : ''

  useEffect(() => {
    if (!q || !project) {
      current?.abort()
      usePq.setState({ preview: { key: '', queryId: null, running: false, waiting: null, result: null, at: null } })
      return
    }
    const st = usePq.getState()
    if (st.preview.key === key && (st.preview.result || st.preview.running)) return
    current?.abort()
    scan?.abort()
    const ctl = new AbortController()
    current = ctl
    usePq.setState((s) => ({ preview: { ...s.preview, key, queryId: q.id, running: true, waiting: null } }))
    const onFetch = (reqs: DataRequest[]) => {
      if (ctl.signal.aborted || !reqs.length) return
      const label = describeRequest(reqs[0]!)
      usePq.setState((s) => (s.preview.key === key ? { preview: { ...s.preview, waiting: label } } : {}))
    }
    previewDraftQuery(q, { step, signal: ctl.signal, onFetch })
      .then((result) => {
        if (ctl.signal.aborted) return
        usePq.setState((s) => {
          const errors = { ...s.errors }
          const errorSteps = { ...s.errorSteps }
          const outputs = { ...s.outputs }
          if (step === null) {
            if (result.result.ok) {
              delete errors[q.id]
              delete errorSteps[q.id]
              if (result.result.preview.kind === 'table') outputs[q.id] = result.result.preview.columns
            } else errors[q.id] = result.result.error
          } else if (!result.result.ok) errorSteps[q.id] ??= step
          // keep the column selection when the columns still exist
          const cols = result.result.ok && result.result.preview.kind === 'table' ? new Set(result.result.preview.columns.map((c) => c.name)) : new Set<string>()
          const selectedCols = s.selectedCols.filter((c) => cols.has(c))
          return { preview: { key, queryId: q.id, running: false, waiting: null, result, at: Date.now() }, errors, errorSteps, outputs, selectedCols, colAnchor: selectedCols.length ? s.colAnchor : null }
        })
        if (step === null && !result.result.ok) {
          const sc = new AbortController()
          scan = sc
          void scanErrorStep(q, sc.signal)
        }
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        const message = e instanceof Error ? e.message : String(e)
        usePq.setState({
          preview: { key, queryId: q.id, running: false, waiting: null, at: Date.now(), result: { outline: outlineQuery(q.source), step, result: { ok: false, error: { reason: 'Expression.Error', message } }, ms: 0 } }
        })
      })
    // the effect re-runs only when the key changes; aborting on unmount happens in the editor
  }, [key, project])
}

/** Abort any running evaluation (editor unmount). */
export function abortPreviews(): void {
  current?.abort()
  scan?.abort()
  current = null
  scan = null
}

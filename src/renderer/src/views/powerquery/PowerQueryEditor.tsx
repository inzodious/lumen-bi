/**
 * Power Query Editor (full window below the title bar, like Power BI Desktop):
 *
 *   ┌ ribbon: File · Home · Transform · Add Column · View ───────────────────────────────┐
 *   ├ Queries [N] ┬ fx formula bar ─────────────────────────────┬ Query Settings ───────┤
 *   │ groups      │ data preview grid (quality / distribution)  │ PROPERTIES / Name     │
 *   │ queries     │ column profile pane                         │ APPLIED STEPS         │
 *   ├─────────────┴─────────────────────────────────────────────┴───────────────────────┤
 *   │ N COLUMNS, M ROWS · Column profiling based on top 1000 rows   PREVIEW DOWNLOADED AT │
 *   └──────────────────────────────────────────────────────────────────────────────────┘
 *
 * Edits live in a draft (pqStore) until Close & Apply / Apply writes them to the model.
 *
 * Hash options (headless captures / deep links, on `#/?…view=powerquery`):
 *   pqQuery=<query name>   select a query        pqStep=<step name>  select an applied step
 *   pqNew=<M text>         add a new query "Query1" with this M (URL-encoded) and select it
 *   pqCols=<a,b>           select columns        pqView=quality,distribution,profile,noformula,nosettings,collapsed
 *   pq=advanced|profile|params|datasources|groupby|merge|append|custom|conditional|enterdata|properties|filter
 *      (opens that dialog / pane once the first preview has rendered; `profile` = Column profile + first column)
 */
import { holdBusy, releaseAfterPaint } from '../../app/readiness'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useApp } from '../../state/store'
import { Spinner } from '../../app/ui'
import { parseHash } from '../../app/Router'
import { PqRibbon } from './PqRibbon'
import { QueriesPane } from './QueriesPane'
import { SettingsPane } from './SettingsPane'
import { PqFormulaBar } from './PqFormulaBar'
import { PreviewArea } from './PreviewArea'
import { PqDialogHost } from './PqDialogHost'

import { clockTime, statusCounts } from './logic/format'
import { PREVIEW_ROW_LIMIT } from '@core/data/preview'
import { usePq } from './pqStore'
import { openPqDialog, type PqDialog } from './pqDialogs'
import { abortPreviews, usePreviewRunner } from './session'
import { newQuery, selectColumn, selectStep, syncWithProject } from './actions'
import { kindOfSource, newQueryName } from './logic/draft'
import './power-query.css'
import { dataSourcesOf } from '@core/data/queries'

function StatusBar() {
  const preview = usePq((s) => s.preview)
  const profile = usePq((s) => s.view.quality || s.view.distribution || s.view.profile)
  const r = preview.result?.result
  const table = r?.ok && r.preview.kind === 'table' ? r.preview : null
  return (
    <div className="wbi-pq-status">
      <div className="wbi-pq-status__left">
        {table && <span>{statusCounts(table.columns.length, table.rows.length, table.truncated)}</span>}
        {table && profile && (
          <span className="wbi-pq-status__profile" title="Lumen profiles the rows of the preview (up to 1000); profiling the entire data set is not available.">
            Column profiling based on top {PREVIEW_ROW_LIMIT} rows
          </span>
        )}
      </div>
      <div className="wbi-pq-status__right">
        {preview.running ? (
          <span className="wbi-pq-status__busy">
            <Spinner />
            {preview.waiting ? `Waiting for ${preview.waiting}…` : 'Evaluating…'}
          </span>
        ) : preview.at ? (
          <span>PREVIEW DOWNLOADED AT {clockTime(new Date(preview.at)).toUpperCase()}</span>
        ) : null}
      </div>
    </div>
  )
}

/** One-shot hash options; returns what must wait for the first rendered preview. */
function applyHashOptions(): { cols?: string[]; open?: string } | null {
  const { params } = parseHash(window.location.hash)
  if (params.get('view') !== 'powerquery') return null
  const s = usePq.getState()
  const qn = params.get('pqQuery')
  if (qn) {
    const q = s.draft.queries.find((x) => x.name.toLowerCase() === qn.toLowerCase())
    if (q) usePq.setState({ selectedId: q.id })
  }
  const m = params.get('pqNew')
  if (m) newQuery({ name: newQueryName(usePq.getState().draft), kind: kindOfSource(m, true), source: m, loadEnabled: true })
  const step = params.get('pqStep')
  if (step) selectStep(step)
  const v = (params.get('pqView') ?? '').split(',').filter(Boolean)
  if (v.length)
    s.setView({
      ...(v.includes('quality') ? { quality: true } : {}),
      ...(v.includes('distribution') ? { distribution: true } : {}),
      ...(v.includes('profile') ? { profile: true } : {}),
      ...(v.includes('noformula') ? { formulaBar: false } : {}),
      ...(v.includes('nosettings') ? { settingsOpen: false } : {}),
      ...(v.includes('collapsed') ? { queriesCollapsed: true } : {})
    })
  const cols = params.get('pqCols')?.split(',').filter(Boolean)
  return { cols, open: params.get('pq') ?? undefined }
}

function openFromHash(open: string): void {
  const s = usePq.getState()
  const q = s.draft.queries.find((x) => x.id === s.selectedId)
  const r = s.preview.result?.result
  const first = r?.ok && r.preview.kind === 'table' ? r.preview.columns[0]?.name : undefined
  const col = s.selectedCols[0] ?? first ?? ''
  const map: Record<string, PqDialog | null> = {
    advanced: q ? { id: 'advanced', queryId: q.id } : null,
    params: { id: 'parameters' },
    datasources: { id: 'dataSources' },
    credentials: (() => {
      const src = q ? dataSourcesOf({ name: 'q', tables: [], relationships: [], roles: [], expressions: [{ name: q.name, kind: 'm', expression: q.source }] })[0] : undefined
      return src ? { id: 'credentials', source: src } : null
    })(),
    groupby: { id: 'groupBy' },
    merge: { id: 'merge' },
    append: { id: 'append' },
    custom: { id: 'customColumn' },
    conditional: { id: 'conditionalColumn' },
    enterdata: { id: 'enterData' },
    properties: q ? { id: 'properties', queryId: q.id } : null,
    filter: col ? { id: 'filterRows', column: col } : null
  }
  if (open === 'profile') {
    s.setView({ profile: true })
    if (!s.selectedCols.length && first) selectColumn(first)
    return
  }
  const d = map[open]
  if (d) openPqDialog(d)
}

let hashApplied = false

export function PowerQueryEditor() {
  const projectId = useApp((s) => s.project?.id ?? null)
  const revision = useApp((s) => s.revision)
  const view = usePq((s) => s.view)
  const pending = useRef<{ cols?: string[]; open?: string } | null>(null)
  // headless capture: hold readiness (app/readiness.ts tracker) until the first preview rendered. Released on unmount
  // too: closing the editor before the first preview finished must not leave the app "busy" forever.
  const busy = useRef<(() => void) | null>(null)
  const releaseBusy = () => {
    const r = busy.current
    busy.current = null
    r?.()
  }

  useLayoutEffect(() => {
    syncWithProject()
    if (!hashApplied) {
      hashApplied = true
      pending.current = applyHashOptions()
    }
    if (useApp.getState().project) {
      busy.current = holdBusy('power query preview')
      const t = setTimeout(releaseBusy, 30000)
      return () => {
        clearTimeout(t)
        releaseBusy()
      }
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    syncWithProject()
  }, [projectId, revision])

  useEffect(() => () => abortPreviews(), [])

  usePreviewRunner()

  const done = usePq((s) => !!s.preview.result && !s.preview.running)
  // nothing to evaluate (project without queries) — not the transient state before the first sync
  const noQuery = usePq((s) => s.projectId !== null && !s.draft.queries.length)
  useEffect(() => {
    if (!busy.current || !(done || noQuery)) return
    const p = pending.current
    pending.current = null
    if (p?.cols?.length) for (const [i, c] of p.cols.entries()) selectColumn(c, i ? 'toggle' : 'single')
    if (p?.open) openFromHash(p.open)
    // let the grid / dialogs paint before the capture
    const t = setTimeout(() => {
      const r = busy.current
      busy.current = null
      if (r) releaseAfterPaint(r)
    }, 400)
    return () => clearTimeout(t)
  }, [done, noQuery])

  return (
    <div className="wbi-pq">
      <PqRibbon />
      <div className="wbi-pq-main">
        <QueriesPane />
        <div className="wbi-pq-center">
          {view.formulaBar && <PqFormulaBar />}
          <PreviewArea />
        </div>
        {view.settingsOpen && <SettingsPane />}
      </div>
      <StatusBar />
      <PqDialogHost />
    </div>
  )
}

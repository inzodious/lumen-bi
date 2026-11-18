/**
 * DAX query view: query tabs, DAX editor (F5 / Ctrl+Enter runs; selection runs only the selection),
 * results grid (multiple EVALUATE results as tabs), duration/row count, errors with position,
 * Format query, comment/uncomment, quick queries from the field list, run history.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AddRegular, ChevronDownRegular, ChevronRightRegular, CopyRegular, DismissRegular, ErrorCircleRegular, HistoryRegular, PlayRegular, SearchRegular, TextGrammarWandRegular, CheckmarkCircleRegular, CommentRegular, CommentOffRegular, FlashRegular } from '@fluentui/react-icons'
import { toggleLineComment } from '@codemirror/commands'
import type { DaxQueryResultTable } from '@core/engine/api'
import type { SemanticModel } from '@core/model/types'
import { useApp } from '../../state/store'
import { DaxEditor, type DaxEditorHandle } from '../../editors/dax/DaxEditor'
import { schemaFromModel } from '../../editors/dax/schema'
import { formatDax } from '../../editors/dax/formatter'
import { quoteColumn, quoteTable } from '../../editors/dax/tokenizer'
import { ViewAsBanner } from '../../dialogs/modeling/RolesDialogs'
import { DataTypeIcon, MeasureIcon, TableIcon } from '../../dialogs/modeling/icons'
import { Menu, Popover, showContextMenu, cx, type MenuItem } from '../../app/ui'
import { promptDialog } from '../../app/ui/Modal'
import { formatCell } from '../data/formatCell'
import { QUERY_DIR, errorPosition, useDaxQueries, type QueryTab } from './queriesState'
import { columnPreviewQuery, columnStatisticsQuery, defineAllMeasuresQuery, evaluateMeasureQuery, topRowsQuery } from './quickQueries'
import './dax-view.css'

export function DaxQueryView() {
  const project = useApp((s) => s.project)
  const init = useDaxQueries((s) => s.init)
  useEffect(() => {
    init(project?.id ?? null, project?.model.sidecarFiles)
  }, [project?.id])
  if (!project) return <div className="wbi-dq__empty">Open a report or semantic model to query it with DAX.</div>
  return <DaxQueryWorkspace model={project.model} />
}

function DaxQueryWorkspace({ model }: { model: SemanticModel }) {
  const { tabs, active } = useDaxQueries()
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]
  const engine = useApp((s) => s.engine)
  const engineError = useApp((s) => s.engineError)
  const editor = useRef<DaxEditorHandle>(null)
  const schema = useMemo(() => schemaFromModel(model), [model])
  const [split, setSplit] = useState(0.5)
  const [historyOpen, setHistoryOpen] = useState<HTMLElement | null>(null)
  const [quickOpen, setQuickOpen] = useState<HTMLElement | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  // persist query text as DAXQueries/<name>.dax (debounced)
  useEffect(() => {
    if (!tab) return
    const h = setTimeout(() => {
      const files = useApp.getState().project?.model.sidecarFiles ?? {}
      const key = `${QUERY_DIR}${tab.name}.dax`
      if ((files[key] ?? '') !== tab.text && (tab.text || files[key] !== undefined)) useApp.getState().patchModelSidecar(key, tab.text)
    }, 800)
    return () => clearTimeout(h)
  }, [tab?.text, tab?.name])

  if (!tab) return null
  const update = (patch: Partial<QueryTab>) => useDaxQueries.getState().update(tab.id, patch)

  const run = (fullText?: string) => {
    const view = editor.current?.view()
    const sel = view?.state.selection.main
    const text = sel && !sel.empty ? view!.state.sliceDoc(sel.from, sel.to) : (fullText ?? tab.text)
    if (!text.trim()) return
    if (!engine) {
      update({ error: { message: engineError ? `The DAX engine is not available: ${engineError}` : 'The DAX engine is not available yet.' }, result: undefined })
      return
    }
    update({ running: true })
    const t0 = performance.now()
    try {
      const res = engine.runDaxQuery(text)
      const rows = res.tables.reduce((s, t) => s + t.rows.length, 0)
      update({ running: false, result: { tables: res.tables, durationMs: res.durationMs || performance.now() - t0, at: Date.now() }, error: undefined, activeResult: 0 })
      useDaxQueries.getState().pushHistory({ text, at: Date.now(), ok: true, rows, durationMs: res.durationMs })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const pos = errorPosition(message)
      update({ running: false, error: { message, ...(pos ?? {}) }, result: undefined })
      useDaxQueries.getState().pushHistory({ text, at: Date.now(), ok: false })
    }
  }

  const insertQuery = (q: string, mode: 'replace' | 'new' = 'replace') => {
    if (mode === 'new' || tab.text.trim()) {
      const id = useDaxQueries.getState().add(q)
      useDaxQueries.getState().setActive(id)
    } else update({ text: q })
  }

  const startSplit = (e: React.MouseEvent) => {
    e.preventDefault()
    const el = mainRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const move = (ev: MouseEvent) => setSplit(Math.min(0.85, Math.max(0.15, (ev.clientY - rect.top) / rect.height)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const comment = (on: boolean) => {
    const view = editor.current?.view()
    if (!view) return
    const { state } = view
    const lines = new Set<number>()
    for (const r of state.selection.ranges) for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) lines.add(l)
    const allCommented = [...lines].every((l) => /^\s*(\/\/|--)/.test(state.doc.line(l).text) || !state.doc.line(l).text.trim())
    if (on === allCommented) return
    toggleLineComment(view)
    view.focus()
  }

  return (
    <div className="wbi-dq">
      <ViewAsBanner />
      <div className="wbi-dq__toolbar" role="toolbar" aria-label="DAX query">
        <button type="button" className="wbi-dq__tb is-primary" onClick={() => run()} title="Run (F5 / Ctrl+Enter)" disabled={tab.running}>
          <PlayRegular /> Run
        </button>
        <span className="wbi-dq__sep" />
        <button type="button" className="wbi-dq__tb" onClick={() => editor.current?.format()} title="Format query (Shift+Alt+F)">
          <TextGrammarWandRegular /> Format query
        </button>
        <button type="button" className="wbi-dq__tb" onClick={() => comment(true)} title="Comment (Ctrl+/)">
          <CommentRegular /> Comment
        </button>
        <button type="button" className="wbi-dq__tb" onClick={() => comment(false)} title="Uncomment (Ctrl+/)">
          <CommentOffRegular /> Uncomment
        </button>
        <button type="button" className="wbi-dq__tb" onClick={() => editor.current?.view()?.focus()} title="Find (Ctrl+F)" onMouseDown={(e) => e.preventDefault()}>
          <SearchRegular /> Find
        </button>
        <span className="wbi-dq__sep" />
        <button type="button" className="wbi-dq__tb" onClick={(e) => setQuickOpen(e.currentTarget)} title="Quick queries">
          <FlashRegular /> Quick queries <ChevronDownRegular />
        </button>
        <button type="button" className="wbi-dq__tb" onClick={(e) => setHistoryOpen(e.currentTarget)} title="Query history">
          <HistoryRegular /> History <ChevronDownRegular />
        </button>
      </div>
      <div className="wbi-dq__body">
        <div className="wbi-dq__main" ref={mainRef}>
          <div className="wbi-dq__editor" style={{ flexBasis: `${split * 100}%` }}>
            <DaxEditor
              key={tab.id}
              ref={editor}
              value={tab.text}
              onChange={(text) => update({ text })}
              onRun={run}
              query
              lineNumbers
              schema={schema}
              formatter={(s) => formatDax(s)}
              placeholder="Write a DAX query, e.g. EVALUATE TOPN(100, 'Table'). Press F5 to run."
              autoFocus
            />
          </div>
          <div className="wbi-dq__splitter" onMouseDown={startSplit} role="separator" aria-orientation="horizontal" />
          <ResultsPane
            tab={tab}
            onActiveResult={(i) => update({ activeResult: i })}
            onGoto={(line, col) => {
              const view = editor.current?.view()
              if (!view) return
              const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
              view.dispatch({ selection: { anchor: Math.min(l.to, l.from + Math.max(0, col - 1)) }, scrollIntoView: true })
              view.focus()
            }}
          />
        </div>
        <FieldsPanel model={model} onQuery={(q) => insertQuery(q, 'new')} onInsert={(t) => editor.current?.insertText(t)} />
      </div>
      <QueryTabs />
      {historyOpen && (
        <Popover anchor={historyOpen} open onClose={() => setHistoryOpen(null)} ignoreOutside={[historyOpen]}>
          <HistoryList
            onPick={(text) => {
              update({ text })
              setHistoryOpen(null)
            }}
          />
        </Popover>
      )}
      {quickOpen && (
        <Popover anchor={quickOpen} open onClose={() => setQuickOpen(null)} ignoreOutside={[quickOpen]}>
          <Menu items={quickQueryItemsForSelection(model, (q) => insertQuery(q, 'new'))} onDone={() => setQuickOpen(null)} />
        </Popover>
      )}
    </div>
  )
}

function quickQueryItemsForSelection(model: SemanticModel, open: (q: string) => void): MenuItem[] {
  const sel = useApp.getState().selectedField
  if (!sel) return [{ header: 'Select a table, column or measure in the field list (right-click it for more).' }]
  return quickQueryItems(model, sel.kind === 'table' ? { kind: 'table', table: sel.table } : { kind: sel.kind === 'measure' ? 'measure' : 'column', table: sel.table, name: sel.name }, open)
}

function quickQueryItems(model: SemanticModel, f: { kind: 'table'; table: string } | { kind: 'column' | 'measure'; table: string; name: string }, open: (q: string) => void): MenuItem[] {
  if (f.kind === 'table')
    return [
      { header: `Quick queries — ${f.table}` },
      { label: 'Show top 100 rows', onClick: () => open(topRowsQuery(f.table)) },
      { label: 'Show column statistics', onClick: () => open(columnStatisticsQuery(model, f.table)) },
      { label: 'Define all measures in this table', onClick: () => open(defineAllMeasuresQuery(model, f.table)) },
      { label: 'Define all measures in this table and references', onClick: () => open(defineAllMeasuresQuery(model, f.table, true)) }
    ]
  if (f.kind === 'column')
    return [
      { header: `Quick queries — ${f.name}` },
      { label: 'Show data preview', onClick: () => open(columnPreviewQuery(f.table, f.name)) },
      { label: 'Show column statistics', onClick: () => open(columnStatisticsQuery(model, f.table, f.name)) }
    ]
  return [
    { header: `Quick queries — ${f.name}` },
    { label: 'Evaluate', onClick: () => open(evaluateMeasureQuery(model, f.name)) },
    { label: 'Define and evaluate', onClick: () => open(evaluateMeasureQuery(model, f.name, 'define')) },
    { label: 'Define with references and evaluate', onClick: () => open(evaluateMeasureQuery(model, f.name, 'defineWithReferences')) }
  ]
}

function ResultsPane({ tab, onActiveResult, onGoto }: { tab: QueryTab; onActiveResult(i: number): void; onGoto(line: number, col: number): void }) {
  const r = tab.result
  const active = r?.tables[Math.min(tab.activeResult, (r?.tables.length ?? 1) - 1)]
  return (
    <div className="wbi-dq__results">
      <div className="wbi-dq__status">
        {tab.running ? (
          <span>Running…</span>
        ) : tab.error ? (
          <span className="wbi-dq__err">
            <ErrorCircleRegular />
            {tab.error.line !== undefined && (
              <button type="button" className="wbi-dq__link" onClick={() => onGoto(tab.error!.line!, tab.error!.col ?? 1)}>
                Query ({tab.error.line}, {tab.error.col})
              </button>
            )}
            <span>{tab.error.message}</span>
          </span>
        ) : r ? (
          <span className="wbi-dq__ok">
            <CheckmarkCircleRegular /> Success · {r.tables.reduce((s, t) => s + t.rows.length, 0).toLocaleString()} {r.tables.reduce((s, t) => s + t.rows.length, 0) === 1 ? 'row' : 'rows'} · {formatDuration(r.durationMs)}
          </span>
        ) : (
          <span className="wbi-dq__muted">Run the query to see results here.</span>
        )}
        {r && r.tables.length > 1 && (
          <span className="wbi-dq__rtabs" role="tablist">
            {r.tables.map((_, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === tab.activeResult} className={cx(i === tab.activeResult && 'is-active')} onClick={() => onActiveResult(i)}>
                Result {i + 1}
              </button>
            ))}
          </span>
        )}
        {active && (
          <button type="button" className="wbi-dq__copy" title="Copy results" onClick={() => copyResult(active)}>
            <CopyRegular /> Copy
          </button>
        )}
      </div>
      {active && <ResultGrid key={`${r!.at}:${tab.activeResult}`} table={active} />}
    </div>
  )
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`
}

function copyResult(t: DaxQueryResultTable): void {
  const engine = useApp.getState().engine
  const lines = [t.columns.map((c) => c.name).join('\t'), ...t.rows.map((r) => r.map((v, i) => formatCell(v, t.columns[i], engine)).join('\t'))]
  void navigator.clipboard?.writeText(lines.join('\n')).catch(() => undefined)
}

function ResultGrid({ table }: { table: DaxQueryResultTable }) {
  const engine = useApp((s) => s.engine)
  const ref = useRef<HTMLDivElement>(null)
  const widths = useMemo(
    () =>
      table.columns.map((c, i) => {
        let longest = c.name.length
        for (let r = 0; r < Math.min(table.rows.length, 80); r++) longest = Math.max(longest, formatCell(table.rows[r][i], c, engine).length)
        return Math.max(70, Math.min(360, longest * 7.2 + 24))
      }),
    [table, engine]
  )
  const total = widths.reduce((a, b) => a + b, 0) + 48
  const v = useVirtualizer({ count: table.rows.length, getScrollElement: () => ref.current, estimateSize: () => 24, overscan: 20 })
  const numeric = table.columns.map((c) => c.dataType === 'int64' || c.dataType === 'double' || c.dataType === 'decimal')
  if (!table.columns.length) return <div className="wbi-dq__muted" style={{ padding: 12 }}>The query returned an empty table.</div>
  return (
    <div className="wbi-dq__grid" ref={ref} role="grid" aria-rowcount={table.rows.length}>
      <div style={{ width: total, minWidth: '100%' }}>
        <div className="wbi-dq__ghead" role="row">
          <div className="wbi-dq__gnum" />
          {table.columns.map((c, i) => (
            <div key={i} role="columnheader" className={cx('wbi-dq__gth', numeric[i] && 'is-num')} style={{ width: widths[i] }} title={c.name}>
              {c.name}
            </div>
          ))}
        </div>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vr) => (
            <div key={vr.key} role="row" className="wbi-dq__grow" style={{ transform: `translateY(${vr.start}px)` }}>
              <div className="wbi-dq__gnum">{vr.index + 1}</div>
              {table.columns.map((c, i) => (
                <div key={i} role="gridcell" className={cx('wbi-dq__gtd', numeric[i] && 'is-num')} style={{ width: widths[i] }}>
                  {formatCell(table.rows[vr.index][i], c, engine)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function QueryTabs() {
  const { tabs, active } = useDaxQueries()
  const rename = async (t: QueryTab) => {
    const name = await promptDialog({ title: 'Rename query', label: 'Name', value: t.name, validate: (v) => (!v.trim() ? 'Enter a name.' : /[\\/:*?"<>|]/.test(v) ? 'The name contains characters that are not allowed in file names.' : tabs.some((x) => x.id !== t.id && x.name.toLowerCase() === v.trim().toLowerCase()) ? 'A query with this name already exists.' : undefined) })
    if (!name || name.trim() === t.name) return
    const files = useApp.getState().project?.model.sidecarFiles ?? {}
    const oldKey = `${QUERY_DIR}${t.name}.dax`
    if (files[oldKey] !== undefined) useApp.getState().patchModelSidecar(oldKey, null)
    useDaxQueries.getState().rename(t.id, name.trim())
  }
  const close = (t: QueryTab) => {
    const key = `${QUERY_DIR}${t.name}.dax`
    if (useApp.getState().project?.model.sidecarFiles?.[key] !== undefined) useApp.getState().patchModelSidecar(key, null)
    useDaxQueries.getState().close(t.id)
  }
  return (
    <div className="wbi-dq__tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={cx('wbi-dq__tab', t.id === active && 'is-active')}
          onClick={() => useDaxQueries.getState().setActive(t.id)}
          onDoubleClick={() => void rename(t)}
          onContextMenu={(e) => {
            e.preventDefault()
            showContextMenu(e, [
              { label: 'Rename', onClick: () => void rename(t) },
              { label: 'Duplicate', onClick: () => useDaxQueries.getState().add(t.text, `${t.name} (copy)`) },
              { label: 'Delete', onClick: () => close(t) }
            ])
          }}
        >
          {t.name}
          <span
            className="wbi-dq__tabx"
            role="button"
            aria-label={`Close ${t.name}`}
            onClick={(e) => {
              e.stopPropagation()
              close(t)
            }}
          >
            <DismissRegular />
          </span>
        </button>
      ))}
      <button type="button" className="wbi-dq__tab wbi-dq__tabadd" onClick={() => useDaxQueries.getState().add()} aria-label="New query" title="New query">
        <AddRegular />
      </button>
    </div>
  )
}

function HistoryList({ onPick }: { onPick(text: string): void }) {
  const history = useDaxQueries((s) => s.history)
  if (!history.length) return <div className="wbi-dq__hist wbi-dq__muted">No queries have been run in this session.</div>
  return (
    <div className="wbi-dq__hist" role="listbox">
      {history.map((h, i) => (
        <button key={i} type="button" className="wbi-dq__histitem" onClick={() => onPick(h.text)} title={h.text}>
          <span className={h.ok ? 'wbi-dq__ok' : 'wbi-dq__err'}>{h.ok ? <CheckmarkCircleRegular /> : <ErrorCircleRegular />}</span>
          <span className="wbi-dq__histtext">{h.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
          <span className="wbi-dq__muted">{new Date(h.at).toLocaleTimeString()}</span>
        </button>
      ))}
    </div>
  )
}

/** Data pane of the DAX query view: tables → columns/measures; double-click inserts, right-click shows quick queries. */
function FieldsPanel({ model, onQuery, onInsert }: { model: SemanticModel; onQuery(q: string): void; onInsert(text: string): void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [q, setQ] = useState('')
  const sel = useApp((s) => s.selectedField)
  const lower = q.toLowerCase()
  const tables = model.tables.filter((t) => !t.isPrivate && !t.showAsVariationsOnly)
  const toggle = (n: string) => setOpen((s) => {
    const x = new Set(s)
    if (x.has(n)) x.delete(n)
    else x.add(n)
    return x
  })
  return (
    <aside className="wbi-dq__fields" aria-label="Data">
      <div className="wbi-dq__fhead">Data</div>
      <div className="wbi-dq__fsearch">
        <SearchRegular />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search fields" />
      </div>
      <div className="wbi-dq__ftree">
        {tables.map((t) => {
          const cols = t.columns.filter((c) => c.kind !== 'rowNumber' && (!lower || c.name.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower)))
          const meas = t.measures.filter((m) => !lower || m.name.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower))
          if (lower && !cols.length && !meas.length) return null
          const isOpen = open.has(t.name) || !!lower
          return (
            <div key={t.name}>
              <div
                className={cx('wbi-dq__fitem wbi-dq__ftable', sel?.kind === 'table' && sel.table === t.name && 'is-selected')}
                onClick={() => {
                  toggle(t.name)
                  useApp.getState().selectField({ kind: 'table', table: t.name })
                }}
                onDoubleClick={() => onInsert(quoteTable(t.name))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  useApp.getState().selectField({ kind: 'table', table: t.name })
                  showContextMenu(e, quickQueryItems(model, { kind: 'table', table: t.name }, onQuery))
                }}
              >
                {isOpen ? <ChevronDownRegular /> : <ChevronRightRegular />}
                <TableIcon size={14} />
                <span>{t.name}</span>
              </div>
              {isOpen &&
                [...meas.map((m) => ({ kind: 'measure' as const, name: m.name })), ...cols.map((c) => ({ kind: 'column' as const, name: c.name }))]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((f) => {
                    const c = f.kind === 'column' ? t.columns.find((x) => x.name === f.name) : undefined
                    return (
                      <div
                        key={f.kind + f.name}
                        className={cx('wbi-dq__fitem wbi-dq__ffield', sel?.kind === f.kind && sel.table === t.name && sel.name === f.name && 'is-selected', (c?.isHidden || (f.kind === 'measure' && t.measures.find((m) => m.name === f.name)?.isHidden)) && 'is-hidden')}
                        onClick={() => useApp.getState().selectField({ kind: f.kind, table: t.name, name: f.name })}
                        onDoubleClick={() => onInsert(f.kind === 'measure' ? quoteColumn(f.name) : `${quoteTable(t.name)}${quoteColumn(f.name)}`)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          useApp.getState().selectField({ kind: f.kind, table: t.name, name: f.name })
                          showContextMenu(e, quickQueryItems(model, { kind: f.kind, table: t.name, name: f.name }, onQuery))
                        }}
                        title={f.name}
                      >
                        {c ? <DataTypeIcon type={c.dataType} calculated={c.kind === 'calculated'} summarizeBy={c.summarizeBy} size={14} /> : <MeasureIcon size={14} />}
                        <span>{f.name}</span>
                      </div>
                    )
                  })}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

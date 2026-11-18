/**
 * Data preview grid (table results): virtualized rows (@tanstack/react-virtual), sticky header with
 * the column type glyph (click → Data Type menu), name (double-click → rename), ▼ filter / sort menu
 * (⇔ expand for structured columns), resizable columns, row-number gutter, multi-column selection
 * (click / Ctrl / Shift) with the selected-column tint, the column header context menu, optional
 * Column quality / Column distribution strips, and cell rendering like Power Query (italic null, red
 * Error links, green nested-value links that drill down, right-aligned numbers, en-US dates).
 */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDownRegular, ArrowExpandRegular, TableRegular } from '@fluentui/react-icons'
import type { PreviewCell } from '@core/m/engine.ts'
import { cx, promptDialog, showContextMenu, type MenuItem } from '../../app/ui'
import { formatCell, typeIcon, isNested } from './logic/format'
import { columnDistribution, columnQuality, columnValues, percentText } from './logic/profile'
import * as T from './logic/transforms'
import { fieldRef, mIdent } from './logic/mtext'
import { usePq, selectedQuery } from './pqStore'
import { openPqDialog } from './pqDialogs'
import { TypeGlyph, TYPE_LABELS } from './TypeGlyph'
import { ExpandMenu, FilterMenu } from './FilterMenu'
import { dataTypeMenu, dateMenu, extractMenu, formatMenu, moveMenu, ribbonStateFor, roundingMenu, scientificMenu, splitMenu, standardMenu, timeMenu, unpivotMenu, type RState } from './PqRibbon'
import { addSpec, newQuery, selectColumn } from './actions'

const ROW_H = 24
const GUTTER = 44

export interface TablePreviewData {
  columns: T.ColInfo[]
  rows: PreviewCell[][]
  truncated: boolean
}

function defaultWidth(c: T.ColInfo): number {
  return Math.round(Math.max(110, Math.min(260, c.name.length * 7.2 + 64)))
}

function isNestedColumn(c: T.ColInfo, values: PreviewCell[]): 'table' | 'record' | 'list' | null {
  const icon = typeIcon(c.type)
  if (icon === 'table' || icon === 'record' || icon === 'list') return icon
  if (icon !== 'any') return null
  const first = values.find((v) => v !== null)
  if (first && isNested(first) && (first.$kind === 'Table' || first.$kind === 'Record' || first.$kind === 'List')) return first.$kind === 'Table' ? 'table' : first.$kind === 'List' ? 'list' : 'record'
  return null
}

/** The expand button of a list column (Power Query: Expand to New Rows / Extract Values…). */
function listExpandMenu(col: string): MenuItem[] {
  return [
    { label: 'Expand to New Rows', onClick: () => void addSpec(T.expandListColumn(col)) },
    {
      label: 'Extract Values…',
      onClick: () =>
        void promptDialog({ title: 'Extract values from list', message: 'Select or enter a delimiter to concatenate the list values.', label: 'Delimiter', value: ',' }).then((d) => {
          if (d !== null) void addSpec(T.extractListValues(col, d))
        })
    }
  ]
}

function transformSubmenu(st: RState): MenuItem[] {
  if (st.text) return [...formatMenu(st, false), { separator: true }, ...extractMenu(st, false)]
  if (st.number) return [...roundingMenu(st, false), { separator: true }, ...standardMenu(st, false), { separator: true }, ...scientificMenu(st, false)]
  if (st.date) return dateMenu(st, false)
  if (st.time) return timeMenu(st, false)
  return []
}

function columnMenu(st: RState, col: string): MenuItem[] {
  const names = st.sel.map((c) => c.name)
  const one = st.sel.length === 1
  const q = st.query
  const transform = transformSubmenu(st)
  return [
    { label: 'Copy', disabled: true },
    { separator: true },
    { label: names.length > 1 ? 'Remove Columns' : 'Remove', onClick: () => void addSpec(T.removeColumns(names)) },
    { label: 'Remove Other Columns', onClick: () => void addSpec(T.removeOtherColumns(names)) },
    { label: 'Duplicate Column', disabled: !one, onClick: () => void addSpec(T.duplicateColumn(col, st.cols.map((c) => c.name))) },
    { separator: true },
    { label: 'Remove Duplicates', onClick: () => void addSpec(T.removeDuplicates(names)) },
    { label: 'Remove Errors', onClick: () => void addSpec(T.removeErrors(names)) },
    { separator: true },
    { label: 'Change Type', submenu: dataTypeMenu(st.sel) },
    { label: 'Transform', disabled: !transform.length, submenu: transform.length ? transform : undefined },
    { separator: true },
    { label: 'Replace Values…', onClick: () => openPqDialog({ id: 'replace', columns: names }) },
    { label: 'Replace Errors…', onClick: () => openPqDialog({ id: 'replace', columns: names, errors: true }) },
    { separator: true },
    { label: 'Split Column', disabled: !one || !st.text, submenu: one && st.text ? splitMenu(st) : undefined },
    { label: 'Group By…', onClick: () => openPqDialog({ id: 'groupBy' }) },
    {
      label: 'Fill',
      submenu: [
        { label: 'Down', onClick: () => void addSpec(T.fillDown(names)) },
        { label: 'Up', onClick: () => void addSpec(T.fillUp(names)) }
      ]
    },
    { separator: true },
    ...unpivotMenu(st),
    { separator: true },
    { label: 'Rename…', disabled: !one, onClick: () => usePq.setState({ renamingColumn: col }) },
    { label: 'Move', submenu: moveMenu(st) },
    { separator: true },
    { label: 'Drill Down', disabled: !one, onClick: () => void addSpec(T.drillDownColumn(col)) },
    {
      label: 'Add as New Query',
      disabled: !one || !q,
      onClick: () => {
        if (!q) return
        newQuery({ name: uniqueQueryName(col), kind: 'query', source: `let\n    ${mIdent(col)} = ${mIdent(q.name)}${fieldRef(col)}\nin\n    ${mIdent(col)}`, loadEnabled: false })
      }
    }
  ]
}

/** The grid's top-left table menu (table-level operations, as in Power Query). */
function tableMenu(cols: T.ColInfo[]): MenuItem[] {
  return [
    { label: 'Copy Entire Table', disabled: true },
    { separator: true },
    { label: 'Use First Row as Headers', onClick: () => void addSpec(T.promoteHeaders()) },
    { label: 'Use Headers as First Row', onClick: () => void addSpec(T.demoteHeaders()) },
    { separator: true },
    { label: 'Add Custom Column…', onClick: () => openPqDialog({ id: 'customColumn' }) },
    { label: 'Add Conditional Column…', onClick: () => openPqDialog({ id: 'conditionalColumn' }) },
    { label: 'Add Index Column', submenu: [{ label: 'From 0', onClick: () => void addSpec(T.addIndexColumn(0)) }, { label: 'From 1', onClick: () => void addSpec(T.addIndexColumn(1)) }, { label: 'Custom…', onClick: () => openPqDialog({ id: 'indexColumn' }) }] },
    { separator: true },
    { label: 'Choose Columns…', onClick: () => openPqDialog({ id: 'chooseColumns' }) },
    { separator: true },
    { label: 'Keep Top Rows…', onClick: () => openPqDialog({ id: 'rows', kind: 'keepTop' }) },
    { label: 'Keep Bottom Rows…', onClick: () => openPqDialog({ id: 'rows', kind: 'keepBottom' }) },
    { label: 'Keep Range of Rows…', onClick: () => openPqDialog({ id: 'rows', kind: 'keepRange' }) },
    { separator: true },
    { label: 'Remove Duplicates', onClick: () => void addSpec(T.removeDuplicates([])) },
    { label: 'Remove Errors', onClick: () => void addSpec(T.removeErrors(cols.map((c) => c.name))) },
    { separator: true },
    { label: 'Merge Queries…', onClick: () => openPqDialog({ id: 'merge' }) },
    { label: 'Append Queries…', onClick: () => openPqDialog({ id: 'append' }) },
    { separator: true },
    { label: 'Group By…', onClick: () => openPqDialog({ id: 'groupBy' }) }
  ]
}

function uniqueQueryName(base: string): string {
  const taken = new Set(usePq.getState().draft.queries.map((q) => q.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`
}

function HeaderName({ col }: { col: string }) {
  const renaming = usePq((s) => s.renamingColumn === col)
  const ref = useRef<HTMLInputElement>(null)
  const [v, setV] = useState(col)
  useEffect(() => {
    if (renaming) {
      setV(col)
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.select()
      })
    }
  }, [renaming, col])
  if (!renaming) return <span className="wbi-pq-th__name">{col}</span>
  const done = (commit: boolean) => {
    usePq.setState({ renamingColumn: null })
    const n = v.trim()
    if (commit && n && n !== col) void addSpec(T.renameColumns([[col, n]]))
  }
  return (
    <input
      ref={ref}
      className="wbi-pq-rename wbi-pq-th__input"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') done(true)
        if (e.key === 'Escape') done(false)
      }}
      onBlur={() => done(true)}
      spellCheck={false}
    />
  )
}

const QualityStrip = memo(function QualityStrip({ values }: { values: PreviewCell[] }) {
  const q = columnQuality(values)
  const pv = q.total ? (q.valid / q.total) * 100 : 0
  const pe = q.total ? (q.error / q.total) * 100 : 0
  return (
    <div className="wbi-pq-quality" title={`Valid ${q.valid} (${percentText(q.valid, q.total)}) · Error ${q.error} (${percentText(q.error, q.total)}) · Empty ${q.empty} (${percentText(q.empty, q.total)})`}>
      <div className="wbi-pq-quality__bar">
        <span className="is-valid" style={{ width: `${pv}%` }} />
        <span className="is-error" style={{ width: `${pe}%` }} />
        <span className="is-empty" style={{ flex: 1 }} />
      </div>
      <div className="wbi-pq-quality__row">
        <i className="is-valid" />
        Valid<span>{percentText(q.valid, q.total)}</span>
      </div>
      <div className="wbi-pq-quality__row">
        <i className="is-error" />
        Error<span>{percentText(q.error, q.total)}</span>
      </div>
      <div className="wbi-pq-quality__row">
        <i className="is-empty" />
        Empty<span>{percentText(q.empty, q.total)}</span>
      </div>
    </div>
  )
})

const DistributionStrip = memo(function DistributionStrip({ values }: { values: PreviewCell[] }) {
  const d = columnDistribution(values)
  const bars = d.values.slice(0, 24)
  const max = bars[0]?.count ?? 1
  return (
    <div className="wbi-pq-dist" title={`${d.distinct} distinct, ${d.unique} unique`}>
      <div className="wbi-pq-dist__bars">
        {bars.map((b, i) => (
          <span key={i} style={{ height: `${Math.max(4, (b.count / max) * 100)}%` }} />
        ))}
      </div>
      <div className="wbi-pq-dist__text">
        {d.distinct} distinct, {d.unique} unique
      </div>
    </div>
  )
})

export function TableGrid({ data, queryId }: { data: TablePreviewData; queryId: string }) {
  const scroll = useRef<HTMLDivElement>(null)
  const selectedCols = usePq((s) => s.selectedCols)
  const widths = usePq((s) => s.widths)
  const view = usePq((s) => s.view)
  const expandCol = usePq((s) => s.expandColumn)
  const [filter, setFilter] = useState<{ col: T.ColInfo; el: HTMLElement } | null>(null)
  const [expand, setExpand] = useState<{ col: string; kind: 'table' | 'record'; el: HTMLElement } | null>(null)
  const headerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const sel = useMemo(() => new Set(selectedCols), [selectedCols])

  const colValues = useMemo(() => data.columns.map((_, i) => columnValues(data.rows, i)), [data])
  const widthOf = (c: T.ColInfo) => widths[`${queryId}|${c.name}`] ?? defaultWidth(c)
  const total = GUTTER + data.columns.reduce((a, c) => a + widthOf(c), 0)

  const rv = useVirtualizer({ count: data.rows.length, getScrollElement: () => scroll.current, estimateSize: () => ROW_H, overscan: 16 })

  // ribbon "Expand" button
  useEffect(() => {
    if (!expandCol) return
    const i = data.columns.findIndex((c) => c.name === expandCol)
    const el = headerRefs.current[expandCol]
    const kind = i >= 0 ? isNestedColumn(data.columns[i]!, colValues[i]!) : null
    if (el && kind) {
      if (kind === 'list') showContextMenu(el.getBoundingClientRect(), listExpandMenu(expandCol))
      else setExpand({ col: expandCol, kind, el })
    }
    usePq.setState({ expandColumn: null })
  }, [expandCol, data, colValues])

  const onHeaderClick = (e: RMouseEvent, name: string) => {
    selectColumn(name, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single')
  }

  const onHeaderMenu = (e: RMouseEvent, name: string) => {
    if (!usePq.getState().selectedCols.includes(name)) selectColumn(name)
    const s = usePq.getState()
    const st = ribbonStateFor(selectedQuery(s), true, data.columns, s.selectedCols)
    showContextMenu(e, columnMenu(st, name))
  }

  const startResize = (e: RMouseEvent, c: T.ColInfo) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = widthOf(c)
    const move = (ev: MouseEvent) => {
      const w = Math.max(48, w0 + ev.clientX - x0)
      usePq.setState((s) => ({ widths: { ...s.widths, [`${queryId}|${c.name}`]: w } }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onCell = (e: RMouseEvent, ci: number, ri: number) => {
    const c = data.columns[ci]!
    const v = data.rows[ri]?.[ci] ?? null
    const target = e.target as HTMLElement
    if (target.dataset.link === 'error' && typeof v === 'object' && v !== null && '$error' in v) {
      usePq.setState({ detail: { column: c.name, row: ri, error: v.$error } })
      return
    }
    if (target.dataset.link === 'nested') {
      void addSpec(T.drillDownCell(c.name, ri))
      return
    }
    selectColumn(c.name, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single')
    if (typeof v === 'object' && v !== null && '$error' in v) usePq.setState({ detail: { column: c.name, row: ri, error: v.$error } })
    else usePq.setState({ detail: null })
  }

  const items = rv.getVirtualItems()

  return (
    <div ref={scroll} className={cx('wbi-pq-grid', view.monospaced && 'is-mono', view.whitespace && 'is-ws')} tabIndex={0}>
      <div className="wbi-pq-grid__inner" style={{ width: total }}>
        <div className="wbi-pq-thead">
          <div className="wbi-pq-tr wbi-pq-tr--head">
            <div className="wbi-pq-corner" style={{ width: GUTTER }}>
              <button type="button" className="wbi-pq-corner__btn" title="Table actions" aria-label="Table actions" onClick={(e) => showContextMenu(e.currentTarget.getBoundingClientRect(), tableMenu(data.columns))} onContextMenu={(e) => showContextMenu(e, tableMenu(data.columns))}>
                <TableRegular fontSize={16} />
                <ChevronDownRegular fontSize={10} />
              </button>
            </div>
            {data.columns.map((c, i) => {
              const nested = isNestedColumn(c, colValues[i]!)
              const isSel = sel.has(c.name)
              return (
                <div
                  key={c.name}
                  ref={(el) => {
                    headerRefs.current[c.name] = el
                  }}
                  className={cx('wbi-pq-th', isSel && 'is-selected')}
                  style={{ width: widthOf(c) }}
                  onClick={(e) => onHeaderClick(e, c.name)}
                  onDoubleClick={() => usePq.setState({ renamingColumn: c.name })}
                  onContextMenu={(e) => onHeaderMenu(e, c.name)}
                  title={c.name}
                >
                  <button
                    type="button"
                    className="wbi-pq-th__type"
                    title={TYPE_LABELS[typeIcon(c.type)]}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!usePq.getState().selectedCols.includes(c.name)) selectColumn(c.name)
                      const s = usePq.getState()
                      showContextMenu(e.currentTarget.getBoundingClientRect(), dataTypeMenu(data.columns.filter((x) => s.selectedCols.includes(x.name))))
                    }}
                  >
                    <TypeGlyph icon={typeIcon(c.type)} />
                  </button>
                  <HeaderName col={c.name} />
                  {nested ? (
                    <button
                      type="button"
                      className="wbi-pq-th__btn"
                      title="Expand"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (nested === 'list') showContextMenu(e.currentTarget.getBoundingClientRect(), listExpandMenu(c.name))
                        else setExpand({ col: c.name, kind: nested, el: e.currentTarget })
                      }}
                    >
                      <ArrowExpandRegular fontSize={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="wbi-pq-th__btn"
                      title="Filter and sort"
                      onClick={(e) => {
                        e.stopPropagation()
                        setFilter({ col: c, el: e.currentTarget })
                      }}
                    >
                      <ChevronDownRegular fontSize={12} />
                    </button>
                  )}
                  <span className="wbi-pq-th__resize" onMouseDown={(e) => startResize(e, c)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
                </div>
              )
            })}
          </div>
          {(view.quality || view.distribution) && (
            <div className="wbi-pq-tr wbi-pq-tr--profile">
              <div className="wbi-pq-corner" style={{ width: GUTTER }} />
              {data.columns.map((c, i) => (
                <div key={c.name} className={cx('wbi-pq-tp', sel.has(c.name) && 'is-selected')} style={{ width: widthOf(c) }} onClick={(e) => onHeaderClick(e, c.name)}>
                  {view.quality && <QualityStrip values={colValues[i]!} />}
                  {view.distribution && <DistributionStrip values={colValues[i]!} />}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="wbi-pq-tbody" style={{ height: rv.getTotalSize() }}>
          {items.map((vr) => {
            const row = data.rows[vr.index]!
            return (
              <div key={vr.key} className="wbi-pq-tr" style={{ transform: `translateY(${vr.start}px)` }}>
                <div className="wbi-pq-rownum" style={{ width: GUTTER }}>
                  {vr.index + 1}
                </div>
                {data.columns.map((c, ci) => {
                  const d = formatCell(row[ci] ?? null, c.type)
                  return (
                    <div key={c.name} className={cx('wbi-pq-td', `is-${d.cls}`, sel.has(c.name) && 'is-selected')} style={{ width: widthOf(c) }} onClick={(e) => onCell(e, ci, vr.index)}>
                      {d.cls === 'error' ? (
                        <span className="wbi-pq-link-error" data-link="error">
                          Error
                        </span>
                      ) : d.cls === 'nested' ? (
                        <span className={cx('wbi-pq-link-nested', `is-${d.nested?.toLowerCase()}`)} data-link="nested">
                          {d.text}
                        </span>
                      ) : (
                        <span className="wbi-pq-td__text">{view.whitespace ? d.text.replace(/\r?\n/g, '¶') : d.text}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {filter && <FilterMenu anchor={filter.el} col={filter.col} values={colValues[data.columns.findIndex((c) => c.name === filter.col.name)] ?? []} truncated={data.truncated} onClose={() => setFilter(null)} />}
      {expand && <ExpandMenu anchor={expand.el} col={expand.col} kind={expand.kind} onClose={() => setExpand(null)} />}
    </div>
  )
}

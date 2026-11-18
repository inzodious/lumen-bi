/**
 * Table view (a.k.a. Data view): formula bar + virtualized grid of the selected table's rows.
 * The shell shows the Data pane on the right and the "Table: X (N rows) Column: Y (M distinct values)"
 * status bar; contextual Table/Column/Measure tools ribbons are registered by dialogs/modeling.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowSortDownRegular, ArrowSortUpRegular, ChevronDownRegular, FilterRegular, TableRegular } from '@fluentui/react-icons'
import type { ColumnDef, TableDef } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import { useApp } from '../../state/store'
import { ViewAsBanner } from '../../dialogs/modeling/RolesDialogs'
import { DataTypeIcon } from '../../dialogs/modeling/icons'
import { showContextMenu, Popover, cx } from '../../app/ui'
import { newColumn, deleteField, setHidden, openEnterData } from '../../dialogs/modeling/commands'
import { isEnterDataPartition } from '../../dialogs/modeling/logic/enterData'
import { formatCell } from './formatCell'
import { computeRowOrder, estimateWidth, type ColumnFilter, type SortState } from './gridModel'
import { ColumnFilterMenu } from './ColumnFilterMenu'
import { quoteTable } from '../../editors/dax/tokenizer'
import '../../dialogs/modeling/ribbonTabs'
import './data-view.css'

const ROW_H = 22

interface GridColumn {
  def: ColumnDef
  values: Scalar[]
  numeric: boolean
}

/** Column values for the table: data store first; calculated columns missing there are evaluated through the engine. */
function useTableColumns(table: TableDef | undefined): { columns: GridColumn[]; rowCount: number; error?: string } {
  const project = useApp((s) => s.project)
  const engine = useApp((s) => s.engine)
  const revision = useApp((s) => s.revision)
  return useMemo(() => {
    if (!table || !project) return { columns: [], rowCount: 0 }
    const data = project.data.tables.get(table.name) ?? [...project.data.tables.entries()].find(([k]) => k.toLowerCase() === table.name.toLowerCase())?.[1]
    const rowCount = data?.rowCount ?? 0
    const cols: GridColumn[] = []
    let error: string | undefined
    for (const def of table.columns) {
      if (def.kind === 'rowNumber') continue
      let values = data?.columns.find((c) => c.name.toLowerCase() === def.name.toLowerCase())?.values
      if (!values && def.kind === 'calculated' && def.expression?.trim() && engine && rowCount > 0) {
        try {
          const res = engine.runDaxQuery(`EVALUATE SELECTCOLUMNS(${quoteTable(table.name)}, ${JSON.stringify(def.name)}, ${def.expression})`)
          const rows = res.tables[0]?.rows ?? []
          if (rows.length === rowCount) values = rows.map((r) => r[0] ?? null)
        } catch (e) {
          error = `${def.name}: ${e instanceof Error ? e.message : String(e)}`
        }
      }
      const numeric = def.dataType === 'int64' || def.dataType === 'double' || def.dataType === 'decimal'
      cols.push({ def, values: values ?? new Array(rowCount).fill(null), numeric })
    }
    return { columns: cols, rowCount, error }
    // revision: recompute after model/data edits
  }, [table, project, engine, revision])
}

export function DataView() {
  const project = useApp((s) => s.project)
  const sel = useApp((s) => s.selectedField)
  const engine = useApp((s) => s.engine)
  const model = project?.model
  const visibleTables = useMemo(() => (model?.tables ?? []).filter((t) => !t.isPrivate && !t.showAsVariationsOnly), [model])
  const [lastTable, setLastTable] = useState<string | null>(null)
  const tableName = sel && visibleTables.some((t) => t.name === sel.table) ? sel.table : lastTable && visibleTables.some((t) => t.name === lastTable) ? lastTable : (visibleTables.find((t) => !t.isHidden)?.name ?? visibleTables[0]?.name ?? null)
  useEffect(() => {
    if (tableName && tableName !== lastTable) setLastTable(tableName)
  }, [tableName, lastTable])
  const table = visibleTables.find((t) => t.name === tableName)

  if (!project) return <div className="wbi-dv__empty">Open a report or semantic model to see its data.</div>
  if (!table) return <div className="wbi-dv__empty">This model has no tables yet. Use Enter data or Get data to add one.</div>
  return (
    <div className="wbi-dv">
      <ViewAsBanner />
      <TableGrid key={table.name} table={table} selectedColumn={sel?.kind === 'column' && sel.table === table.name ? sel.name : null} engineReady={!!engine} />
    </div>
  )
}

function TableGrid({ table, selectedColumn, engineReady }: { table: TableDef; selectedColumn: string | null; engineReady: boolean }) {
  const engine = useApp((s) => s.engine)
  const status = useApp((s) => s.project?.data.status.get(table.name))
  const { columns, rowCount, error } = useTableColumns(table)
  const [sort, setSort] = useState<SortState | null>(null)
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({})
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [menu, setMenu] = useState<{ column: string; anchor: HTMLElement } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const display = useMemo(() => {
    const byName = new Map(columns.map((c) => [c.def.name, c]))
    return (column: string, v: Scalar) => {
      const c = byName.get(column)
      return c ? formatCell(v, c.def, engine) : String(v ?? '')
    }
  }, [columns, engine])
  const order = useMemo(() => computeRowOrder(rowCount, (c) => columns.find((x) => x.def.name === c)?.values, filters, sort, display), [rowCount, columns, filters, sort, display])
  const colWidths = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of columns) {
      const samples: string[] = []
      for (let i = 0; i < Math.min(rowCount, 60); i++) samples.push(formatCell(c.values[i], c.def, engine))
      out[c.def.name] = widths[c.def.name] ?? estimateWidth(c.def.name, samples)
    }
    return out
  }, [columns, rowCount, widths, engine])
  const totalWidth = columns.reduce((s, c) => s + colWidths[c.def.name], 0)

  const virtualizer = useVirtualizer({ count: order.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 20 })
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [sort, filters])

  const selectColumn = (name: string) => useApp.getState().selectField({ kind: 'column', table: table.name, name })
  const startResize = (e: React.MouseEvent, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = colWidths[name]
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [name]: Math.max(40, w0 + ev.clientX - x0) }))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const headerMenu = (e: React.MouseEvent, c: GridColumn) => {
    e.preventDefault()
    selectColumn(c.def.name)
    showContextMenu(e, [
      { label: 'Sort ascending', icon: <ArrowSortUpRegular />, onClick: () => setSort({ column: c.def.name, dir: 'asc' }) },
      { label: 'Sort descending', icon: <ArrowSortDownRegular />, onClick: () => setSort({ column: c.def.name, dir: 'desc' }) },
      { label: 'Clear sort', disabled: sort?.column !== c.def.name, onClick: () => setSort(null) },
      { label: 'Clear filter', disabled: !filters[c.def.name], onClick: () => setFilters(omit(filters, c.def.name)) },
      { label: 'Clear all filters', disabled: !Object.keys(filters).length, onClick: () => setFilters({}) },
      { separator: true },
      { label: 'Copy', onClick: () => copyColumn(c, order, display) },
      { label: 'Copy table', onClick: () => copyTable(columns, order, display) },
      { separator: true },
      { label: 'New column', onClick: () => newColumn(table.name) },
      { label: 'Delete', disabled: c.def.kind === 'calculatedTableColumn', onClick: () => void deleteField({ kind: 'column', table: table.name, name: c.def.name }) },
      { label: c.def.isHidden ? 'Unhide in report view' : 'Hide in report view', onClick: () => setHidden({ kind: 'column', table: table.name, name: c.def.name }, !c.def.isHidden) },
      ...(isEnterDataPartition(table.partitions[0]) ? [{ separator: true as const }, { label: 'Edit data', onClick: () => openEnterData(table.name) }] : [])
    ])
  }

  const emptyReason = rowCount === 0 ? (status?.state === 'error' ? `This table failed to load: ${status.message}` : status?.state === 'empty' ? (status.reason ?? 'This table is empty.') : status?.state === 'pending' ? 'Loading…' : 'No data is loaded for this table. Refresh the data source, or use sample data.') : null

  return (
    <div className="wbi-dv__gridwrap">
      {error && <div className="wbi-dv__warn">Some calculated columns could not be evaluated — {error}</div>}
      {!engineReady && columns.some((c) => c.def.kind === 'calculated') && <div className="wbi-dv__warn">The DAX engine is not available; calculated columns are shown blank.</div>}
      <div className="wbi-dv__scroll" ref={scrollRef} role="grid" aria-rowcount={order.length} aria-label={`Table ${table.name}`}>
        <div className="wbi-dv__inner" style={{ width: totalWidth + 1 }}>
          <div className="wbi-dv__header" role="row">
            {columns.map((c) => {
              const active = selectedColumn === c.def.name
              const sorted = sort?.column === c.def.name ? sort.dir : null
              return (
                <div
                  key={c.def.name}
                  role="columnheader"
                  className={cx('wbi-dv__th', active && 'is-selected', c.def.isHidden && 'is-hidden', c.numeric && 'is-num')}
                  style={{ width: colWidths[c.def.name] }}
                  onClick={() => selectColumn(c.def.name)}
                  onContextMenu={(e) => headerMenu(e, c)}
                  title={c.def.description || c.def.name}
                >
                  <DataTypeIcon type={c.def.dataType} calculated={c.def.kind === 'calculated'} summarizeBy={c.def.summarizeBy} size={14} />
                  <span className="wbi-dv__thname">{c.def.name}</span>
                  {sorted === 'asc' && <ArrowSortUpRegular className="wbi-dv__thicon" />}
                  {sorted === 'desc' && <ArrowSortDownRegular className="wbi-dv__thicon" />}
                  {filters[c.def.name] && <FilterRegular className="wbi-dv__thicon" />}
                  <button
                    type="button"
                    className="wbi-dv__thmenu"
                    aria-label={`Sort and filter ${c.def.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectColumn(c.def.name)
                      setMenu({ column: c.def.name, anchor: e.currentTarget })
                    }}
                  >
                    <ChevronDownRegular />
                  </button>
                  <span className="wbi-dv__resize" onMouseDown={(e) => startResize(e, c.def.name)} onClick={(e) => e.stopPropagation()} onDoubleClick={() => setWidths(omit(widths, c.def.name))} />
                </div>
              )
            })}
          </div>
          {emptyReason ? (
            <div className="wbi-dv__noRows">
              <TableRegular /> {emptyReason}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vr) => {
                const r = order[vr.index]
                return (
                  <div key={vr.key} role="row" className="wbi-dv__row" style={{ transform: `translateY(${vr.start}px)`, height: ROW_H }}>
                    {columns.map((c) => (
                      <div key={c.def.name} role="gridcell" className={cx('wbi-dv__td', c.numeric && 'is-num', selectedColumn === c.def.name && 'is-selected')} style={{ width: colWidths[c.def.name] }}>
                        {formatCell(c.values[r] ?? null, c.def, engine)}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {menu && (
        <Popover anchor={menu.anchor} open onClose={() => setMenu(null)} ignoreOutside={[menu.anchor]}>
          <ColumnFilterMenu
            column={columns.find((c) => c.def.name === menu.column)!}
            sort={sort?.column === menu.column ? sort.dir : null}
            filter={filters[menu.column]}
            display={(v) => display(menu.column, v)}
            onSort={(dir) => {
              setSort(dir ? { column: menu.column, dir } : null)
              setMenu(null)
            }}
            onFilter={(f) => {
              setFilters(f ? { ...filters, [menu.column]: f } : omit(filters, menu.column))
              setMenu(null)
            }}
            onClose={() => setMenu(null)}
          />
        </Popover>
      )}
    </div>
  )
}

function omit<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const next = { ...obj }
  delete next[key]
  return next
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined)
}

function copyColumn(c: GridColumn, order: number[], display: (col: string, v: Scalar) => string): void {
  copyText([c.def.name, ...order.map((r) => display(c.def.name, c.values[r] ?? null))].join('\n'))
}

function copyTable(columns: GridColumn[], order: number[], display: (col: string, v: Scalar) => string): void {
  const lines = [columns.map((c) => c.def.name).join('\t'), ...order.map((r) => columns.map((c) => display(c.def.name, c.values[r] ?? null)).join('\t'))]
  copyText(lines.join('\n'))
}


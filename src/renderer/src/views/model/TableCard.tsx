/** A table card in the model diagram (header + fields list), PBI Model view look. */
import { memo } from 'react'
import { ChevronDownRegular, ChevronUpRegular, EyeOffRegular, MoreHorizontalRegular } from '@fluentui/react-icons'
import type { TableDef } from '@core/model/types'
import { cx } from '../../app/ui'
import { DataTypeIcon, HierarchyIcon, MeasureIcon, TableIcon } from '../../dialogs/modeling/icons'
import { isCalculatedTable } from '../../dialogs/modeling/context'
import { HEADER_HEIGHT, ROW_HEIGHT } from './layout'

export interface CardRow {
  kind: 'column' | 'measure' | 'hierarchy' | 'separator'
  name: string
}

/** Field rows in display order: columns (alphabetical), hierarchies, then measures. */
export function cardRows(t: TableDef): CardRow[] {
  const cols = t.columns.filter((c) => c.kind !== 'rowNumber').map((c) => c.name).sort((a, b) => a.localeCompare(b))
  const rows: CardRow[] = cols.map((name) => ({ kind: 'column', name }))
  for (const h of [...t.hierarchies].sort((a, b) => a.name.localeCompare(b.name))) rows.push({ kind: 'hierarchy', name: h.name })
  if (t.measures.length) {
    if (rows.length) rows.push({ kind: 'separator', name: 'Measures' })
    for (const m of [...t.measures].sort((a, b) => a.name.localeCompare(b.name))) rows.push({ kind: 'measure', name: m.name })
  }
  return rows
}

export function rowY(rows: CardRow[], column: string): number | null {
  const i = rows.findIndex((r) => r.kind === 'column' && r.name === column)
  return i < 0 ? null : HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2
}

export interface TableCardProps {
  table: TableDef
  rows: CardRow[]
  x: number
  y: number
  width: number
  height: number
  collapsed: boolean
  selected: boolean
  selectedField: { kind: string; name: string } | null
  highlighted: Set<string>
  related: boolean
  dimmed: boolean
  onHeaderDown(e: React.MouseEvent): void
  onFieldDown(e: React.MouseEvent, row: CardRow): void
  onToggleCollapse(): void
  onMenu(e: React.MouseEvent): void
  onResizeDown(e: React.MouseEvent): void
  onFieldContext(e: React.MouseEvent, row: CardRow): void
}

export const TableCard = memo(function TableCard(p: TableCardProps) {
  const t = p.table
  return (
    <div
      className={cx('wbi-mv-card', p.selected && 'is-selected', t.isHidden && 'is-hidden', p.related && 'is-related', p.dimmed && 'is-dimmed')}
      style={{ left: p.x, top: p.y, width: p.width, height: p.collapsed ? HEADER_HEIGHT : p.height }}
      data-table={t.name}
      onContextMenu={p.onMenu}
    >
      <div className="wbi-mv-card__header" onMouseDown={p.onHeaderDown} title={t.description || t.name}>
        <TableIcon calculated={isCalculatedTable(t) || !!t.calculationGroup} size={16} />
        <span className="wbi-mv-card__title">{t.name}</span>
        {t.isHidden && <EyeOffRegular className="wbi-mv-card__hid" aria-label="Hidden" />}
        <button type="button" className="wbi-mv-card__btn" aria-label="More options" onMouseDown={(e) => e.stopPropagation()} onClick={p.onMenu}>
          <MoreHorizontalRegular />
        </button>
        <button type="button" className="wbi-mv-card__btn" aria-label={p.collapsed ? 'Expand' : 'Collapse'} onMouseDown={(e) => e.stopPropagation()} onClick={p.onToggleCollapse}>
          {p.collapsed ? <ChevronDownRegular /> : <ChevronUpRegular />}
        </button>
      </div>
      {!p.collapsed && (
        <div className="wbi-mv-card__body">
          {p.rows.map((r) =>
            r.kind === 'separator' ? (
              <div key="__sep" className="wbi-mv-card__sep" />
            ) : (
              <FieldRow key={`${r.kind}:${r.name}`} table={t} row={r} selected={!!p.selectedField && p.selectedField.kind === r.kind && p.selectedField.name === r.name} highlighted={r.kind === 'column' && p.highlighted.has(r.name)} onDown={p.onFieldDown} onContext={p.onFieldContext} />
            )
          )}
          {!p.rows.length && <div className="wbi-mv-card__empty">No fields</div>}
        </div>
      )}
      {!p.collapsed && <div className="wbi-mv-card__resize" onMouseDown={p.onResizeDown} />}
    </div>
  )
})

function FieldRow({ table, row, selected, highlighted, onDown, onContext }: { table: TableDef; row: CardRow; selected: boolean; highlighted: boolean; onDown: TableCardProps['onFieldDown']; onContext: TableCardProps['onFieldContext'] }) {
  let icon = null
  let hidden = false
  if (row.kind === 'column') {
    const c = table.columns.find((x) => x.name === row.name)
    if (c) {
      icon = <DataTypeIcon type={c.dataType} calculated={c.kind === 'calculated'} summarizeBy={c.summarizeBy} size={14} />
      hidden = !!c.isHidden
    }
  } else if (row.kind === 'measure') {
    icon = <MeasureIcon size={14} />
    hidden = !!table.measures.find((x) => x.name === row.name)?.isHidden
  } else {
    icon = <HierarchyIcon size={14} />
    hidden = !!table.hierarchies.find((x) => x.name === row.name)?.isHidden
  }
  return (
    <div
      className={cx('wbi-mv-field', selected && 'is-selected', highlighted && 'is-highlighted', hidden && 'is-hidden')}
      onMouseDown={(e) => onDown(e, row)}
      onContextMenu={(e) => onContext(e, row)}
      data-field={row.name}
      data-kind={row.kind}
      title={row.name}
    >
      {icon}
      <span className="wbi-mv-field__name">{row.name}</span>
      {hidden && <EyeOffRegular className="wbi-mv-field__hid" aria-label="Hidden" />}
    </div>
  )
}

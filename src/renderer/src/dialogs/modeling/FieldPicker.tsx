/**
 * Field picker dropdown (tables / columns / measures of the model), grouped by table, searchable.
 */
import type { ReactNode } from 'react'
import { CalculatorRegular, TableRegular } from '@fluentui/react-icons'
import type { ColumnDef, SemanticModel } from '@core/model/types'
import { Dropdown, type DropdownOption } from '../../app/ui'
import { DataTypeIcon } from './icons'

export interface PickedField {
  kind: 'column' | 'measure'
  table: string
  name: string
}

export const encodeField = (f: PickedField): string => `${f.kind}\u0001${f.table}\u0001${f.name}`
export const decodeField = (s: string): PickedField => {
  const [kind, table, name] = s.split('\u0001')
  return { kind: kind as PickedField['kind'], table, name }
}

export function FieldPicker(p: {
  model: SemanticModel
  value: PickedField | undefined
  onChange(f: PickedField): void
  columns?: boolean
  measures?: boolean
  filterColumn?(c: ColumnDef): boolean
  label?: string
  placeholder?: string
  includeHidden?: boolean
}) {
  const options: Array<DropdownOption<string>> = []
  for (const t of p.model.tables) {
    if (t.isPrivate || t.showAsVariationsOnly) continue
    if (p.columns !== false)
      for (const c of t.columns) {
        if (c.kind === 'rowNumber' || (!p.includeHidden && c.isHidden) || (p.filterColumn && !p.filterColumn(c))) continue
        options.push({ value: encodeField({ kind: 'column', table: t.name, name: c.name }), label: c.name, group: t.name, icon: <DataTypeIcon type={c.dataType} calculated={c.kind === 'calculated'} /> })
      }
    if (p.measures)
      for (const m of t.measures) {
        if (!p.includeHidden && m.isHidden) continue
        options.push({ value: encodeField({ kind: 'measure', table: t.name, name: m.name }), label: m.name, group: t.name, icon: <CalculatorRegular /> })
      }
  }
  return (
    <Dropdown
      label={p.label}
      value={p.value ? encodeField(p.value) : undefined}
      options={options}
      searchable
      placeholder={p.placeholder ?? 'Select a field'}
      onChange={(v) => p.onChange(decodeField(v))}
      renderValue={(o) => (o ? `${decodeField(o.value).table} · ${o.label}` : (p.placeholder ?? 'Select a field'))}
    />
  )
}

export function TablePicker(p: { model: SemanticModel; value: string | undefined; onChange(t: string): void; label?: string; placeholder?: string; filter?(name: string): boolean }): ReactNode {
  return (
    <Dropdown
      label={p.label}
      value={p.value}
      options={p.model.tables.filter((t) => !t.isPrivate && !t.showAsVariationsOnly && (!p.filter || p.filter(t.name))).map((t) => ({ value: t.name, label: t.name, icon: <TableRegular /> }))}
      searchable
      placeholder={p.placeholder ?? 'Select a table'}
      onChange={p.onChange}
    />
  )
}

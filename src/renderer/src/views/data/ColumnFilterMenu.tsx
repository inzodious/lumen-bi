/** Table view column header dropdown: Sort ascending/descending, Clear, Text filters, value checklist. */
import { useMemo, useState } from 'react'
import { ArrowSortDownRegular, ArrowSortUpRegular, DismissRegular } from '@fluentui/react-icons'
import type { ColumnDef } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import { Button, Dropdown, SearchBox, TextField } from '../../app/ui'
import { distinctWithCounts, type ColumnFilter } from './gridModel'

const TEXT_OPS: Array<{ value: Extract<ColumnFilter, { kind: 'text' }>['op']; label: string }> = [
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' },
  { value: 'equals', label: 'Equals' },
  { value: 'startsWith', label: 'Begins with' },
  { value: 'endsWith', label: 'Ends with' },
  { value: 'isBlank', label: 'Is blank' },
  { value: 'isNotBlank', label: 'Is not blank' }
]

const MAX_LIST = 1000

export function ColumnFilterMenu(p: {
  column: { def: ColumnDef; values: Scalar[]; numeric: boolean }
  sort: 'asc' | 'desc' | null
  filter: ColumnFilter | undefined
  display(v: Scalar): string
  onSort(dir: 'asc' | 'desc' | null): void
  onFilter(f: ColumnFilter | null): void
  onClose(): void
}) {
  const distinct = useMemo(() => distinctWithCounts(p.column.values), [p.column.values])
  const [q, setQ] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => (p.filter?.kind === 'values' ? new Set(p.filter.values) : new Set(distinct.map((d) => d.key))))
  const [textOp, setTextOp] = useState<Extract<ColumnFilter, { kind: 'text' }>['op']>(p.filter?.kind === 'text' ? p.filter.op : 'contains')
  const [text, setText] = useState(p.filter?.kind === 'text' ? p.filter.text : '')
  const [mode, setMode] = useState<'list' | 'text'>(p.filter?.kind === 'text' ? 'text' : 'list')
  const shown = distinct.filter((d) => !q || p.display(d.value).toLowerCase().includes(q.toLowerCase()) || (d.value === null && 'blank'.includes(q.toLowerCase()))).slice(0, MAX_LIST)
  const allChecked = shown.every((d) => checked.has(d.key))
  const asc = p.column.numeric ? 'Sort ascending' : p.column.def.dataType === 'dateTime' ? 'Sort oldest to newest' : 'Sort A to Z'
  const desc = p.column.numeric ? 'Sort descending' : p.column.def.dataType === 'dateTime' ? 'Sort newest to oldest' : 'Sort Z to A'
  const apply = () => {
    if (mode === 'text') p.onFilter(textOp === 'isBlank' || textOp === 'isNotBlank' || text ? { kind: 'text', op: textOp, text } : null)
    else p.onFilter(checked.size === distinct.length ? null : { kind: 'values', values: checked })
  }
  return (
    <div className="wbi-dvf" onKeyDown={(e) => e.key === 'Escape' && p.onClose()}>
      <button type="button" className={`wbi-dvf__item ${p.sort === 'asc' ? 'is-on' : ''}`} onClick={() => p.onSort('asc')}>
        <ArrowSortUpRegular /> {asc}
      </button>
      <button type="button" className={`wbi-dvf__item ${p.sort === 'desc' ? 'is-on' : ''}`} onClick={() => p.onSort('desc')}>
        <ArrowSortDownRegular /> {desc}
      </button>
      <button type="button" className="wbi-dvf__item" disabled={!p.sort} onClick={() => p.onSort(null)}>
        <DismissRegular /> Clear sort
      </button>
      <button type="button" className="wbi-dvf__item" disabled={!p.filter} onClick={() => p.onFilter(null)}>
        <DismissRegular /> Clear filter
      </button>
      <div className="wbi-dvf__sep" />
      <div className="wbi-dvf__tabs">
        <button type="button" className={mode === 'list' ? 'is-on' : ''} onClick={() => setMode('list')}>
          Values
        </button>
        <button type="button" className={mode === 'text' ? 'is-on' : ''} onClick={() => setMode('text')}>
          {p.column.numeric ? 'Number filters' : p.column.def.dataType === 'dateTime' ? 'Date filters' : 'Text filters'}
        </button>
      </div>
      {mode === 'list' ? (
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Search" size="small" autoFocus />
          <div className="wbi-dvf__list">
            <label className="wbi-dvf__check">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => {
                  const next = new Set(checked)
                  for (const d of shown) {
                    if (allChecked) next.delete(d.key)
                    else next.add(d.key)
                  }
                  setChecked(next)
                }}
              />
              (Select all)
            </label>
            {shown.map((d) => (
              <label key={d.key} className="wbi-dvf__check">
                <input
                  type="checkbox"
                  checked={checked.has(d.key)}
                  onChange={() => {
                    const next = new Set(checked)
                    if (next.has(d.key)) next.delete(d.key)
                    else next.add(d.key)
                    setChecked(next)
                  }}
                />
                <span className="wbi-dvf__val">{d.value === null ? '(Blank)' : p.display(d.value) || ' '}</span>
                <span className="wbi-dvf__count">{d.count}</span>
              </label>
            ))}
            {distinct.length > MAX_LIST && <div className="wbi-dvf__more">Showing the first {MAX_LIST.toLocaleString()} values. Search to narrow the list.</div>}
          </div>
        </>
      ) : (
        <div className="wbi-dvf__text">
          <Dropdown size="small" value={textOp} options={TEXT_OPS} onChange={setTextOp} />
          {textOp !== 'isBlank' && textOp !== 'isNotBlank' && <TextField size="small" value={text} onChange={setText} placeholder="Value" autoFocus />}
        </div>
      )}
      <div className="wbi-dvf__footer">
        <Button size="small" variant="primary" onClick={apply} disabled={mode === 'list' && checked.size === 0}>
          OK
        </Button>
        <Button size="small" onClick={p.onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

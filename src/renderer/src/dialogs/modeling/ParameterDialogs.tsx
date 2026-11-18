/** Modeling ▸ New parameter ▸ Numeric range / Fields. */
import { useMemo, useState } from 'react'
import { ArrowDownRegular, ArrowUpRegular, DeleteRegular, ReOrderDotsVerticalRegular } from '@fluentui/react-icons'
import { Button, Checkbox, Dropdown, Modal, SearchBox, TextField } from '../../app/ui'
import { useApp } from '../../state/store'
import type { TableDef } from '@core/model/types'
import { buildFieldParameter, buildNumericRangeParameter, parseFieldParameterExpression, validateNumericRange, type FieldParameterItem } from './logic/parameters'
import { nameError, uniqueName } from './logic/modelOps'
import { findPage } from '../../report/pbir'
import { addVisual } from '../../report/editOps'
import { DataTypeIcon, MeasureIcon } from './icons'
import './modeling.css'

/** PBIR projection for a column (used for the slicer added with a parameter). */
function columnProjection(table: string, column: string) {
  return { field: { Column: { Expression: { SourceRef: { Entity: table } }, Property: column } }, queryRef: `${table}.${column}`, nativeQueryRef: column, active: true }
}

/** "Add slicer to this page": a slicer bound to the parameter column on the active report page. */
function addSlicer(table: string, column: string, singleValue: boolean): void {
  const state = useApp.getState()
  if (!state.project?.report || !state.activePage) return
  state.mutateReport('Add slicer', (r) => {
    const page = findPage(r, state.activePage)
    if (!page) return
    const visual: Record<string, unknown> = { query: { queryState: { Values: { projections: [columnProjection(table, column)] } } } }
    if (singleValue) visual['objects'] = { data: [{ properties: { mode: { expr: { Literal: { Value: "'Single'" } } } } }] }
    addVisual(page, 'slicer', { x: 40, y: 40, width: 260, height: singleValue ? 90 : 220 }, visual)
  })
}

export function NumericRangeParameterDialog({ onClose }: { onClose(): void }) {
  const model = useApp((s) => s.project?.model)
  const hasReport = useApp((s) => !!s.project?.report && !!s.activePage)
  const [name, setName] = useState(() => uniqueName('Parameter', model?.tables.map((t) => t.name) ?? []))
  const [dataType, setDataType] = useState<'int64' | 'double'>('int64')
  const [min, setMin] = useState('0')
  const [max, setMax] = useState('20')
  const [inc, setInc] = useState('1')
  const [dflt, setDflt] = useState('')
  const [slicer, setSlicer] = useState(true)
  if (!model) return null
  const spec = { name, dataType, min: Number(min), max: Number(max), increment: Number(inc), defaultValue: dflt.trim() === '' ? undefined : Number(dflt) }
  const error = validateNumericRange(spec) ?? nameError(model, 'table', name)
  const create = () => {
    if (error) return
    const table = buildNumericRangeParameter(spec)
    useApp.getState().mutateModel(`New parameter ${table.name}`, (m) => m.tables.push(table))
    useApp.getState().selectField({ kind: 'table', table: table.name })
    if (slicer && hasReport) addSlicer(table.name, table.columns[0].name, true)
    onClose()
  }
  return (
    <Modal
      title="Parameters"
      subtitle="What will your variable adjust?"
      onClose={onClose}
      onSubmit={create}
      width={480}
      footer={
        <>
          <Button variant="primary" disabled={!!error} onClick={create}>
            Create
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-form">
        <div className="wbi-form__note">Numeric range</div>
        <TextField label="Name" value={name} onChange={setName} autoFocus />
        <Dropdown<'int64' | 'double'>
          label="Data type"
          value={dataType}
          options={[
            { value: 'int64', label: 'Whole number' },
            { value: 'double', label: 'Decimal number' }
          ]}
          onChange={setDataType}
        />
        <div className="wbi-form__grid2">
          <TextField label="Minimum" value={min} onChange={setMin} type="number" />
          <TextField label="Maximum" value={max} onChange={setMax} type="number" />
          <TextField label="Increment" value={inc} onChange={setInc} type="number" />
          <TextField label="Default" value={dflt} onChange={setDflt} type="number" placeholder="(none)" />
        </div>
        <Checkbox checked={slicer && hasReport} disabled={!hasReport} onChange={setSlicer} label="Add slicer to this page" />
        <div className="wbi-form__hint">
          Creates the table <b>{name || '…'}</b> (GENERATESERIES) and the measure <b>{name || '…'} Value</b> (SELECTEDVALUE). Use the measure in your calculations; the slicer changes its value.
        </div>
        {error && <div className="wbi-form__error">{error}</div>}
      </div>
    </Modal>
  )
}

export function FieldParameterDialog({ onClose, editTable }: { onClose(): void; editTable?: string }) {
  const model = useApp((s) => s.project?.model)
  const hasReport = useApp((s) => !!s.project?.report && !!s.activePage)
  const existing: TableDef | undefined = editTable ? model?.tables.find((t) => t.name === editTable) : undefined
  const [name, setName] = useState(() => existing?.name ?? uniqueName('Parameter', model?.tables.map((t) => t.name) ?? []))
  const [items, setItems] = useState<FieldParameterItem[]>(() => (existing ? parseFieldParameterExpression(existing.partitions[0]?.expression ?? '') : []))
  const [q, setQ] = useState('')
  const [slicer, setSlicer] = useState(!existing)
  const fields = useMemo(() => {
    const out: Array<{ table: string; field: string; kind: 'column' | 'measure'; icon: React.ReactNode }> = []
    for (const t of model?.tables ?? []) {
      if (t.isPrivate || t.showAsVariationsOnly || t.name === existing?.name) continue
      for (const c of t.columns) if (!c.isHidden && c.kind !== 'rowNumber') out.push({ table: t.name, field: c.name, kind: 'column', icon: <DataTypeIcon type={c.dataType} calculated={c.kind === 'calculated'} summarizeBy={c.summarizeBy} /> })
      for (const m of t.measures) if (!m.isHidden) out.push({ table: t.name, field: m.name, kind: 'measure', icon: <MeasureIcon /> })
    }
    return out
  }, [model, existing])
  if (!model) return null
  const error = !name.trim() ? 'Enter a name.' : existing && name === existing.name ? null : nameError(model, 'table', name)
  const selected = (t: string, f: string) => items.some((i) => i.table === t && i.field === f)
  const toggle = (t: string, f: string) => setItems(selected(t, f) ? items.filter((i) => !(i.table === t && i.field === f)) : [...items, { label: f, table: t, field: f }])
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }
  const create = () => {
    if (error || !items.length) return
    const table = buildFieldParameter(name, items)
    useApp.getState().mutateModel(existing ? `Edit parameter ${name}` : `New parameter ${name}`, (m) => {
      if (existing) {
        const idx = m.tables.findIndex((t) => t.name === existing.name)
        const old = m.tables[idx]
        // keep identity metadata of the existing table/columns
        table.lineageTag = old.lineageTag ?? table.lineageTag
        table.columns.forEach((c, i) => (c.lineageTag = old.columns[i]?.lineageTag ?? c.lineageTag))
        table.annotations = old.annotations
        m.tables[idx] = table
      } else m.tables.push(table)
    })
    useApp.getState().selectField({ kind: 'table', table: table.name })
    if (slicer && hasReport) addSlicer(table.name, table.columns[0].name, false)
    onClose()
  }
  const lowerQ = q.toLowerCase()
  const groups = new Map<string, typeof fields>()
  for (const f of fields) if (!lowerQ || f.field.toLowerCase().includes(lowerQ) || f.table.toLowerCase().includes(lowerQ)) groups.set(f.table, [...(groups.get(f.table) ?? []), f])
  return (
    <Modal
      title="Parameters"
      subtitle="Fields"
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button variant="primary" disabled={!!error || !items.length} onClick={create}>
            {existing ? 'Save' : 'Create'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-fp">
        <div className="wbi-fp__left">
          <TextField label="Name" value={name} onChange={setName} error={error ?? undefined} />
          <div className="wbi-field__label" style={{ marginTop: 12 }}>
            Add and reorder fields
          </div>
          <div className="wbi-fp__items">
            {!items.length && <div className="wbi-fp__empty">Select fields on the right. The order here is the order in the slicer.</div>}
            {items.map((it, i) => (
              <div key={`${it.table}|${it.field}`} className="wbi-fp__item">
                <ReOrderDotsVerticalRegular className="wbi-fp__grip" />
                <input className="wbi-fp__label" value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Display name" />
                <span className="wbi-fp__src" title={`${it.table}[${it.field}]`}>
                  {it.table}
                </span>
                <button type="button" className="wbi-iconbtn" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>
                  <ArrowUpRegular />
                </button>
                <button type="button" className="wbi-iconbtn" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === items.length - 1}>
                  <ArrowDownRegular />
                </button>
                <button type="button" className="wbi-iconbtn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove">
                  <DeleteRegular />
                </button>
              </div>
            ))}
          </div>
          <Checkbox checked={slicer && hasReport} disabled={!hasReport} onChange={setSlicer} label="Add slicer to this page" />
        </div>
        <div className="wbi-fp__right">
          <div className="wbi-field__label">Fields</div>
          <SearchBox value={q} onChange={setQ} placeholder="Search" size="small" />
          <div className="wbi-fp__fields">
            {[...groups.entries()].map(([table, list]) => (
              <div key={table}>
                <div className="wbi-fp__table">{table}</div>
                {list.map((f) => (
                  <label key={f.kind + f.field} className="wbi-fp__field">
                    <input type="checkbox" checked={selected(f.table, f.field)} onChange={() => toggle(f.table, f.field)} />
                    {f.icon}
                    <span>{f.field}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

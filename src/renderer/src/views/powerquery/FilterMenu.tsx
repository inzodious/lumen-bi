/**
 * Column header ▼ menu (Power Query autofilter): Sort Ascending / Descending, Remove Empty,
 * Text / Number / Date Filters ▸ (open the Filter Rows dialog with the operator preselected),
 * a searchable checkbox list of the column's distinct values with "(Select All)", the
 * "List may be incomplete." note + Load more when the preview is truncated, OK / Cancel.
 *
 * Also the ⇔ Expand popover of structured (table / record) columns.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowSortDownRegular, ArrowSortUpRegular, ChevronRightRegular, FilterDismissRegular, WarningRegular } from '@fluentui/react-icons'
import { Button, Checkbox, Menu, Popover, SearchBox, Spinner, type MenuItem } from '../../app/ui'
import type { PreviewCell } from '@core/m/engine.ts'
import { filterByValues, filterExtreme, filterOpsFor, removeEmpty } from './logic/filters'
import { fieldRef, pqTypeOf } from './logic/mtext'
import { addStep } from './logic/steps'
import { cellKey, cellText } from './logic/format'
import { expandColumn, sortRows, type ColInfo } from './logic/transforms'
import { usePq, selectedQuery } from './pqStore'
import { openPqDialog } from './pqDialogs'
import { previewDraftQuery } from './session'
import { addSpec, currentStep } from './actions'

const MAX_VALUES = 1000

function sortValues(vals: PreviewCell[]): PreviewCell[] {
  return [...vals].sort((a, b) => {
    if (a === null) return -1
    if (b === null) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    const sa = String(a)
    const sb = String(b)
    return sa < sb ? -1 : sa > sb ? 1 : 0
  })
}

/** Evaluates a temporary step on top of the selected step (full data, not just the preview rows). */
async function evaluateExtra(formula: (prev: string) => string): Promise<PreviewCell[] | null> {
  const q = selectedQuery()
  if (!q) return null
  const step = currentStep()
  const r = addStep(q.source, step, '__lumen_tmp', formula)
  if (!r) return null
  const res = await previewDraftQuery({ name: q.name, source: r.source }, { step: r.name, rowLimit: MAX_VALUES })
  if (!res.result.ok || res.result.preview.kind !== 'list') return null
  return res.result.preview.items
}

function filterSubmenu(col: ColInfo, close: () => void): MenuItem[] {
  const k = pqTypeOf(col.type)
  const items: MenuItem[] = filterOpsFor(col.type).map((o) => ({
    label: `${o.label[0]!.toUpperCase()}${o.label.slice(1)}…`,
    onClick: () => {
      close()
      openPqDialog({ id: 'filterRows', column: col.name, op: o.id })
    }
  }))
  if (k === 'date' || k === 'datetime' || k === 'datetimezone') {
    items.push(
      { separator: true },
      { label: 'Is Earliest', onClick: () => (close(), void addSpec(filterExtreme(col.name, 'earliest'))) },
      { label: 'Is Latest', onClick: () => (close(), void addSpec(filterExtreme(col.name, 'latest'))) },
      { label: 'Is Not Earliest', onClick: () => (close(), void addSpec(filterExtreme(col.name, 'earliest', true))) },
      { label: 'Is Not Latest', onClick: () => (close(), void addSpec(filterExtreme(col.name, 'latest', true))) }
    )
  }
  items.push({ separator: true }, { label: 'Custom Filter…', onClick: () => (close(), openPqDialog({ id: 'filterRows', column: col.name })) })
  return items
}

function filterLabel(type: string): string {
  const k = pqTypeOf(type)
  if (k === 'number' || k === 'int64' || k === 'currency' || k === 'percentage') return 'Number Filters'
  if (k === 'date') return 'Date Filters'
  if (k === 'datetime' || k === 'datetimezone') return 'Date/Time Filters'
  if (k === 'time') return 'Time Filters'
  return 'Text Filters'
}

export function FilterMenu({ anchor, col, values, truncated, onClose }: { anchor: HTMLElement; col: ColInfo; values: PreviewCell[]; truncated: boolean; onClose(): void }) {
  const [all, setAll] = useState<PreviewCell[]>(() => {
    const seen = new Map<string, PreviewCell>()
    for (const v of values) if (!(typeof v === 'object' && v !== null)) seen.set(cellKey(v), v)
    return sortValues([...seen.values()])
  })
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(!truncated)
  const [sub, setSub] = useState<HTMLElement | null>(null)
  const subRef = useRef<HTMLButtonElement>(null)

  const shown = useMemo(() => (q ? all.filter((v) => cellText(v, col.type).toLowerCase().includes(q.toLowerCase())) : all).slice(0, MAX_VALUES), [all, q, col.type])
  const allChecked = shown.every((v) => !unchecked.has(cellKey(v)))
  const noneChecked = shown.every((v) => unchecked.has(cellKey(v)))

  const loadMore = async () => {
    setLoading(true)
    try {
      const items = await evaluateExtra((p) => `List.FirstN(List.Distinct(${p}${fieldRef(col.name)}), ${MAX_VALUES})`)
      if (items) {
        setAll(sortValues(items.filter((v) => !(typeof v === 'object' && v !== null))))
        setComplete(items.length < MAX_VALUES)
      }
    } finally {
      setLoading(false)
    }
  }

  const ok = () => {
    onClose()
    let checked = all.filter((v) => !unchecked.has(cellKey(v)))
    if (q) checked = checked.filter((v) => shown.includes(v))
    const spec = filterByValues(col.name, col.type, all, checked)
    if (spec) void addSpec(spec)
  }

  const toggle = (v: PreviewCell) =>
    setUnchecked((u) => {
      const n = new Set(u)
      const k = cellKey(v)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  return (
    <Popover anchor={anchor} open onClose={onClose} placement="bottom-start">
      <div className="wbi-pq-fmenu" onKeyDown={(e) => e.key === 'Enter' && ok()}>
        <button type="button" className="wbi-menu__item" onClick={() => (onClose(), void addSpec(sortRows([{ col: col.name, desc: false }])))}>
          <span className="wbi-menu__icon">
            <ArrowSortUpRegular fontSize={16} />
          </span>
          <span className="wbi-menu__label">Sort Ascending</span>
        </button>
        <button type="button" className="wbi-menu__item" onClick={() => (onClose(), void addSpec(sortRows([{ col: col.name, desc: true }])))}>
          <span className="wbi-menu__icon">
            <ArrowSortDownRegular fontSize={16} />
          </span>
          <span className="wbi-menu__label">Sort Descending</span>
        </button>
        <button type="button" className="wbi-menu__item" disabled>
          <span className="wbi-menu__icon" />
          <span className="wbi-menu__label">Clear Sort</span>
        </button>
        <div className="wbi-menu__sep" />
        <button type="button" className="wbi-menu__item" disabled>
          <span className="wbi-menu__icon">
            <FilterDismissRegular fontSize={16} />
          </span>
          <span className="wbi-menu__label">Clear Filter</span>
        </button>
        <button type="button" className="wbi-menu__item" onClick={() => (onClose(), void addSpec(removeEmpty(col.name, col.type)))}>
          <span className="wbi-menu__icon" />
          <span className="wbi-menu__label">Remove Empty</span>
        </button>
        <button ref={subRef} type="button" className="wbi-menu__item" onMouseEnter={() => setSub(subRef.current)} onClick={() => setSub(subRef.current)}>
          <span className="wbi-menu__icon" />
          <span className="wbi-menu__label">{filterLabel(col.type)}</span>
          <ChevronRightRegular fontSize={12} />
        </button>
        {sub && (
          <Popover anchor={sub} open placement="right-start" onClose={() => setSub(null)}>
            <Menu items={filterSubmenu(col, onClose)} onDone={() => setSub(null)} />
          </Popover>
        )}
        <div className="wbi-pq-fmenu__search" onMouseEnter={() => setSub(null)}>
          <SearchBox value={q} onChange={setQ} placeholder="Search" size="small" autoFocus />
        </div>
        <div className="wbi-pq-fmenu__list">
          <Checkbox
            label="(Select All)"
            checked={allChecked ? true : noneChecked ? false : 'mixed'}
            onChange={() =>
              setUnchecked((u) => {
                const n = new Set(u)
                for (const v of shown) {
                  if (allChecked) n.add(cellKey(v))
                  else n.delete(cellKey(v))
                }
                return n
              })
            }
          />
          {shown.map((v) => (
            <Checkbox key={cellKey(v)} label={v === null ? '(null)' : v === '' ? '(blank)' : cellText(v, col.type)} checked={!unchecked.has(cellKey(v))} onChange={() => toggle(v)} />
          ))}
        </div>
        {!complete && (
          <div className="wbi-pq-fmenu__note">
            <WarningRegular fontSize={14} />
            <span>List may be incomplete.</span>
            {loading ? (
              <Spinner />
            ) : (
              <button type="button" className="wbi-pq-link" onClick={() => void loadMore()}>
                Load more
              </button>
            )}
          </div>
        )}
        <div className="wbi-pq-fmenu__foot">
          <Button variant="primary" size="small" onClick={ok} disabled={noneChecked && !q && all.length > 0}>
            OK
          </Button>
          <Button size="small" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Popover>
  )
}

/** ⇔ Expand popover of a nested table / record column: field list sampled from the data. */
export function ExpandMenu({ anchor, col, kind, onClose }: { anchor: HTMLElement; col: string; kind: 'table' | 'record'; onClose(): void }) {
  const [fields, setFields] = useState<string[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [prefix, setPrefix] = useState(true)
  const [q, setQ] = useState('')
  const [complete, setComplete] = useState(true)

  useEffect(() => {
    let live = true
    const ref = fieldRef(col)
    // the fields of the first 1000 nested values (Power Query samples too: "List may be incomplete.")
    void evaluateExtra(
      (p) =>
        `List.FirstN(List.Distinct(List.Combine(List.Transform(List.FirstN(${p}${ref}, 1000), each if _ is table then Table.ColumnNames(_) else if _ is record then Record.FieldNames(_) else {}))), 1000)`
    ).then((items) => {
      if (!live) return
      const names = (items ?? []).filter((x): x is string => typeof x === 'string')
      setFields(names)
      setChecked(new Set(names))
      // only the first 1000 nested values were sampled
      setComplete(!columnPreviewValues(col).truncated)
    })
    return () => {
      live = false
    }
  }, [col])

  const shown = (fields ?? []).filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()))
  const allOn = shown.every((f) => checked.has(f))
  return (
    <Popover anchor={anchor} open onClose={onClose} placement="bottom-start">
      <div className="wbi-pq-fmenu wbi-pq-expand">
        <div className="wbi-pq-fmenu__search">
          <SearchBox value={q} onChange={setQ} placeholder="Search Columns to Expand" size="small" autoFocus />
        </div>
        <div className="wbi-pq-fmenu__list">
          {fields === null ? (
            <Spinner label="Loading…" />
          ) : (
            <>
              <Checkbox
                label="(Select All Columns)"
                checked={allOn}
                onChange={() =>
                  setChecked((c) => {
                    const n = new Set(c)
                    for (const f of shown) {
                      if (allOn) n.delete(f)
                      else n.add(f)
                    }
                    return n
                  })
                }
              />
              {shown.map((f) => (
                <Checkbox
                  key={f}
                  label={f}
                  checked={checked.has(f)}
                  onChange={() =>
                    setChecked((c) => {
                      const n = new Set(c)
                      if (n.has(f)) n.delete(f)
                      else n.add(f)
                      return n
                    })
                  }
                />
              ))}
            </>
          )}
        </div>
        <div className="wbi-pq-fmenu__opt">
          <Checkbox label="Use original column name as prefix" checked={prefix} onChange={setPrefix} />
        </div>
        {!complete && <div className="wbi-pq-fmenu__note">List may be incomplete.</div>}
        <div className="wbi-pq-fmenu__foot">
          <Button
            variant="primary"
            size="small"
            disabled={!fields || !checked.size}
            onClick={() => {
              onClose()
              const list = (fields ?? []).filter((f) => checked.has(f))
              void addSpec(expandColumn(col, list, kind, prefix))
            }}
          >
            OK
          </Button>
          <Button size="small" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Popover>
  )
}

/** Values of a column of the shown table preview. */
export function columnPreviewValues(name: string): { values: PreviewCell[]; truncated: boolean } {
  const r = usePq.getState().preview.result?.result
  if (!r?.ok || r.preview.kind !== 'table') return { values: [], truncated: false }
  const i = r.preview.columns.findIndex((c) => c.name === name)
  return { values: r.preview.rows.map((row) => row[i] ?? null), truncated: r.preview.truncated }
}

/**
 * Merge Queries (two previews, key column selection by header click, join kind, match count) and
 * Append Queries (two tables / three or more), optionally as a new query.
 *
 * Approximation: the match count is computed on the evaluated preview rows (up to 1,000 per table),
 * not on the full tables; the dialog says so when either preview is truncated.
 */
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRegular, ArrowUpRegular, DismissRegular } from '@fluentui/react-icons'
import type { PreviewCell } from '@core/m/engine.ts'
import { Button, Checkbox, Dropdown, IconButton, Modal, Radio, Spinner, cx } from '../../../app/ui'
import { newQueryName } from '../logic/draft'
import { mIdent } from '../logic/mtext'
import { parseAppend, parseMerge } from '../logic/stepSettings'
import { appendQueries, JOIN_KINDS, mergeQueries, type ColInfo, type JoinKind, type StepSpec } from '../logic/transforms'
import { newQuery } from '../actions'
import { closePqDialog } from '../pqDialogs'
import { selectedQuery, usePq } from '../pqStore'
import { previewDraftQuery } from '../session'
import { cellText, commit, Field, OkCancel, stepFormula, useInputTable, type InputTable } from './common'

const SHOWN_ROWS = 5

interface Loaded extends InputTable {
  error?: string
  truncated: boolean
}

function useQueryTable(name: string | undefined): Loaded | null {
  const [t, setT] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!name) return setT(null)
    const q = usePq.getState().draft.queries.find((x) => x.name === name)
    if (!q) return setT(null)
    setT({ columns: [], rows: [], loading: true, truncated: false })
    const ctl = new AbortController()
    previewDraftQuery(q, { rowLimit: 1000, signal: ctl.signal })
      .then((r) => {
        if (ctl.signal.aborted) return
        const res = r.result
        if (res.ok && res.preview.kind === 'table') setT({ columns: res.preview.columns, rows: res.preview.rows, loading: false, truncated: res.preview.truncated })
        else setT({ columns: [], rows: [], loading: false, truncated: false, error: res.ok ? `'${name}' is not a table.` : `${res.error.reason}: ${res.error.message}` })
      })
      .catch((e: unknown) => !ctl.signal.aborted && setT({ columns: [], rows: [], loading: false, truncated: false, error: e instanceof Error ? e.message : String(e) }))
    return () => ctl.abort()
  }, [name])
  return t
}

function MiniTable({ table, selected, onHeader }: { table: InputTable & { error?: string }; selected: string[]; onHeader(col: string, additive: boolean): void }) {
  if (table.loading) return <div className="wbi-pq-dlg__mini wbi-pq-dlg__mini--empty"><Spinner label="Loading preview…" /></div>
  if (table.error) return <div className="wbi-pq-dlg__mini wbi-pq-dlg__mini--empty wbi-dlg-error">{table.error}</div>
  return (
    <div className="wbi-pq-dlg__mini">
      <table>
        <thead>
          <tr>
            {table.columns.map((c) => {
              const k = selected.indexOf(c.name)
              return (
                <th key={c.name} className={cx(k >= 0 && 'is-selected')} onClick={(e) => onHeader(c.name, e.ctrlKey || e.metaKey)} title="Select a column to match (Ctrl+click for several)">
                  {c.name}
                  {k >= 0 && selected.length > 1 && <sup>{k + 1}</sup>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, SHOWN_ROWS).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={cx(table.columns[j] && selected.includes(table.columns[j]!.name) && 'is-selected', v === null && 'is-null')}>
                  {cellText(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function keyOf(row: PreviewCell[], idx: number[]): string {
  return JSON.stringify(idx.map((i) => row[i] ?? null))
}

/** How many rows of `left` find a match in `right` on the key columns (preview rows only). */
export function countMatches(left: { columns: ColInfo[]; rows: PreviewCell[][] }, lk: string[], right: { columns: ColInfo[]; rows: PreviewCell[][] }, rk: string[]): number {
  const li = lk.map((k) => left.columns.findIndex((c) => c.name === k))
  const ri = rk.map((k) => right.columns.findIndex((c) => c.name === k))
  if (li.some((i) => i < 0) || ri.some((i) => i < 0)) return 0
  const keys = new Set(right.rows.map((r) => keyOf(r, ri)))
  return left.rows.filter((r) => keys.has(keyOf(r, li))).length
}

const pick = (cur: string[], col: string, additive: boolean) => (additive ? (cur.includes(col) ? cur.filter((c) => c !== col) : [...cur, col]) : cur.length === 1 && cur[0] === col ? [] : [col])

/** As a new query: `let Source = <formula of the current query> in Source`. */
function asNewQuery(base: string, spec: StepSpec, prefix: string): void {
  const draft = usePq.getState().draft
  newQuery({ name: newQueryName(draft, prefix), kind: 'table', source: `let\n    Source = ${spec.formula(mIdent(base))}\nin\n    Source`, loadEnabled: true })
}

export function MergeDialog({ asNew, step }: { asNew?: boolean; step?: string }) {
  const parsed = useMemo(() => (step ? parseMerge(stepFormula(step) ?? '') : null), [step])
  const current = selectedQuery()
  const curName = current?.name ?? ''
  const stepInput = useInputTable(step)
  const wholeQuery = useQueryTable(asNew ? curName : undefined)
  const shownTruncated = usePq((s) => {
    const r = s.preview.result?.result
    return !!(r?.ok && r.preview.kind === 'table' && r.preview.truncated)
  })
  const left: Loaded = asNew ? (wholeQuery ?? { columns: [], rows: [], loading: true, truncated: false }) : { ...stepInput, truncated: shownTruncated || stepInput.rows.length >= 1000 }
  const others = usePq(useShallow((s) => s.draft.queries.filter((q) => q.name !== curName && (q.kind === 'table' || q.kind === 'query')).map((q) => q.name)))
  const [other, setOther] = useState<string | undefined>(parsed?.other)
  const right = useQueryTable(other)
  const selCols = usePq((s) => s.selectedCols)
  const [lk, setLk] = useState<string[]>(() => parsed?.leftKeys ?? (asNew ? [] : selCols))
  const [rk, setRk] = useState<string[]>(parsed?.rightKeys ?? [])
  const [kind, setKind] = useState<JoinKind>(parsed?.kind ?? 'LeftOuter')
  const valid = !!other && lk.length > 0 && lk.length === rk.length
  const matches = valid && right && !right.loading && !left.loading ? countMatches(left, lk, right, rk) : null
  const ok = () => {
    if (!valid) return
    const spec = mergeQueries(lk, other, rk, kind, left.columns.map((c) => c.name))
    if (asNew && current) {
      closePqDialog()
      asNewQuery(current.name, spec, 'Merge')
    } else void commit(spec, step)
  }
  return (
    <Modal title="Merge" subtitle="Select tables and matching columns to create a merged table." onClose={closePqDialog} width={860} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!valid} />}>
      <div className="wbi-col" style={{ gap: 10 }}>
        <div className="wbi-pq-dlg__label">{curName}</div>
        <MiniTable table={left} selected={lk} onHeader={(c, add) => setLk((cur) => pick(cur, c, add))} />
        <Dropdown
          value={other}
          options={others.map((n) => ({ value: n, label: n }))}
          onChange={(v) => {
            setOther(v)
            setRk([])
          }}
          placeholder="Select a table"
        />
        {right ? <MiniTable table={right} selected={rk} onHeader={(c, add) => setRk((cur) => pick(cur, c, add))} /> : <div className="wbi-pq-dlg__mini wbi-pq-dlg__mini--empty" />}
        <div className="wbi-row" style={{ gap: 24, alignItems: 'flex-end' }}>
          <Field label="Join Kind">
            <Dropdown className="wbi-pq-dlg__w320" value={kind} options={JOIN_KINDS.map((k) => ({ value: k.id, label: k.label }))} onChange={setKind} />
          </Field>
          <Checkbox label="Use fuzzy matching to perform the merge" checked={false} disabled title="Fuzzy matching is not supported by Lumen" />
        </div>
        <div className="wbi-pq-dlg__status">
          {!other || !lk.length || !rk.length
            ? 'Select a table and matching columns to continue.'
            : lk.length !== rk.length
              ? 'The number of columns selected in each table must be equal.'
              : matches === null
                ? 'Estimating matches…'
                : `✓ The selection matches ${matches.toLocaleString()} of ${left.rows.length.toLocaleString()} rows from the first table${left.truncated || right?.truncated ? ' (in the preview rows)' : ''}.`}
        </div>
      </div>
    </Modal>
  )
}

export function AppendDialog({ asNew, step }: { asNew?: boolean; step?: string }) {
  const parsed = useMemo(() => (step ? parseAppend(stepFormula(step) ?? '') : null), [step])
  const curName = selectedQuery()?.name ?? ''
  const all = usePq(useShallow((s) => s.draft.queries.filter((q) => q.name !== curName && (q.kind === 'table' || q.kind === 'query')).map((q) => q.name)))
  const [many, setMany] = useState(() => (parsed?.length ?? 1) > 1)
  const [one, setOne] = useState<string | undefined>(parsed?.[0])
  const [list, setList] = useState<string[]>(parsed ?? [])
  const [avail, setAvail] = useState<string | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const tables = many ? list : one ? [one] : []
  const ok = () => {
    if (!tables.length) return
    const spec = appendQueries(tables)
    if (asNew) {
      closePqDialog()
      asNewQuery(curName, spec, 'Append')
    } else void commit(spec, step)
  }
  const move = (d: -1 | 1) => {
    if (chosen === null) return
    const j = chosen + d
    if (j < 0 || j >= list.length) return
    const n = [...list]
    ;[n[chosen], n[j]] = [n[j]!, n[chosen]!]
    setList(n)
    setChosen(j)
  }
  return (
    <Modal title="Append" subtitle="Concatenate rows from two tables into a single table." onClose={closePqDialog} width={many ? 680 : 520} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!tables.length} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <div className="wbi-row" style={{ gap: 16 }}>
          <Radio checked={!many} onChange={() => setMany(false)} label="Two tables" />
          <Radio
            checked={many}
            onChange={() => {
              setMany(true)
              if (!list.length && one) setList([one])
            }}
            label="Three or more tables"
          />
        </div>
        {!many ? (
          <>
            <Field label="Primary table">
              <div className="wbi-pq-dlg__static">{curName}</div>
            </Field>
            <Dropdown label="Table to append" value={one} options={all.map((n) => ({ value: n, label: n }))} onChange={setOne} placeholder="Select a table" />
          </>
        ) : (
          <div className="wbi-pq-dlg__append">
            <Field label="Available tables">
              <div className="wbi-pq-dlg__list wbi-pq-dlg__applist">
                {all.map((n) => (
                  <div key={n} className={cx('wbi-pq-dlg__item', avail === n && 'is-selected')} onClick={() => setAvail(n)} onDoubleClick={() => setList((l) => [...l, n])}>
                    {n}
                  </div>
                ))}
              </div>
            </Field>
            <div className="wbi-pq-dlg__append-mid">
              <Button disabled={!avail} onClick={() => avail && setList((l) => [...l, avail])}>
                Add »
              </Button>
            </div>
            <Field label="Tables to append">
              <div className="wbi-row" style={{ alignItems: 'flex-start', gap: 4 }}>
                <div className="wbi-pq-dlg__list wbi-pq-dlg__applist">
                  <div className="wbi-pq-dlg__item is-static">{curName} (Current)</div>
                  {list.map((n, i) => (
                    <div key={`${n}-${i}`} className={cx('wbi-pq-dlg__item', chosen === i && 'is-selected')} onClick={() => setChosen(i)}>
                      {n}
                    </div>
                  ))}
                </div>
                <div className="wbi-col" style={{ gap: 2 }}>
                  <IconButton label="Move up" icon={<ArrowUpRegular fontSize={14} />} disabled={chosen === null || chosen === 0} onClick={() => move(-1)} />
                  <IconButton label="Move down" icon={<ArrowDownRegular fontSize={14} />} disabled={chosen === null || chosen === list.length - 1} onClick={() => move(1)} />
                  <IconButton
                    label="Remove"
                    icon={<DismissRegular fontSize={14} />}
                    disabled={chosen === null}
                    onClick={() => {
                      setList((l) => l.filter((_, j) => j !== chosen))
                      setChosen(null)
                    }}
                  />
                </div>
              </div>
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * Filter Rows (column filter menu ▸ Text / Number / Date Filters ▸ …): Basic mode with two
 * conditions on one column joined by And / Or. Advanced mode (conditions on several columns) is
 * not implemented; the option is shown disabled.
 */
import { useId, useMemo, useState } from 'react'
import { Dropdown, Modal, Radio } from '../../../app/ui'
import { filterByConditions, filterOpsFor, type FilterCondition, type FilterOp } from '../logic/filters'
import { parseFilterRows } from '../logic/stepSettings'
import { closePqDialog } from '../pqDialogs'
import { columnValues, commit, OkCancel, stepFormula, useInputTable } from './common'
import { distinctTexts } from './ColumnDialogs'

type MaybeOp = FilterOp | ''

function ValueBox({ value, onChange, suggestions, disabled, autoFocus }: { value: string; onChange(v: string): void; suggestions: string[]; disabled?: boolean; autoFocus?: boolean }) {
  const id = useId()
  return (
    <div className="wbi-input wbi-pq-dlg__grow">
      <input list={id} value={value} disabled={disabled} autoFocus={autoFocus} placeholder="Enter or select a value" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}

export function FilterRowsDialog({ column, op, step }: { column: string; op?: FilterOp; step?: string }) {
  const input = useInputTable(step)
  const parsed = useMemo(() => (step ? parseFilterRows(stepFormula(step) ?? '') : null), [step])
  const type = input.columns.find((c) => c.name === column)?.type ?? 'any'
  const ops = filterOpsFor(type)
  const suggestions = useMemo(() => distinctTexts(columnValues(input, column)), [input, column])
  const [first, setFirst] = useState<FilterCondition>(() => parsed?.first ?? { op: op ?? 'equals', value: '' })
  const [join, setJoin] = useState<'and' | 'or'>(parsed?.join ?? 'and')
  const [second, setSecond] = useState<{ op: MaybeOp; value: string }>(() => parsed?.second ?? { op: '', value: '' })
  const opOptions = ops.map((o) => ({ value: o.id as MaybeOp, label: o.label }))
  // PBI date filters show "is before"/"is after": parsed comparisons map onto those ids
  const norm = (o: FilterOp): FilterOp => (ops.some((x) => x.id === o) ? o : ({ greater: 'after', less: 'before', greaterOrEqual: 'onOrAfter', lessOrEqual: 'onOrBefore', after: 'greater', before: 'less', onOrAfter: 'greaterOrEqual', onOrBefore: 'lessOrEqual' } as Partial<Record<FilterOp, FilterOp>>)[o] ?? o)
  const ok = () => {
    const sec = second.op ? { op: second.op, value: second.value } : null
    void commit(filterByConditions(column, type, { ...first, op: norm(first.op) }, sec ? join : undefined, sec ? { ...sec, op: norm(sec.op) } : null), step)
  }
  return (
    <Modal title="Filter Rows" subtitle="Apply one or more filter conditions to the rows in this table." onClose={closePqDialog} width={600} onSubmit={ok} footer={<OkCancel onOk={ok} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <div className="wbi-row" style={{ gap: 16 }}>
          <Radio checked label="Basic" />
          <Radio checked={false} disabled label="Advanced" />
        </div>
        <div>
          Keep rows where &apos;<b>{column}</b>&apos;
        </div>
        <div className="wbi-row" style={{ gap: 8 }}>
          <Dropdown className="wbi-pq-dlg__w240" value={norm(first.op)} options={opOptions.filter((o) => o.value)} onChange={(v) => setFirst({ ...first, op: v as FilterOp })} />
          <ValueBox value={first.value} onChange={(v) => setFirst({ ...first, value: v })} suggestions={suggestions} autoFocus />
        </div>
        <div className="wbi-row" style={{ gap: 16 }}>
          <Radio checked={join === 'and'} onChange={() => setJoin('and')} label="And" />
          <Radio checked={join === 'or'} onChange={() => setJoin('or')} label="Or" />
        </div>
        <div className="wbi-row" style={{ gap: 8 }}>
          <Dropdown className="wbi-pq-dlg__w240" value={second.op ? norm(second.op) : ''} options={[{ value: '', label: ' ' }, ...opOptions]} onChange={(v) => setSecond({ ...second, op: v })} />
          <ValueBox value={second.value} onChange={(v) => setSecond({ ...second, value: v })} suggestions={suggestions} disabled={!second.op} />
        </div>
      </div>
    </Modal>
  )
}

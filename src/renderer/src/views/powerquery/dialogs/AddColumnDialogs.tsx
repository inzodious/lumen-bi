/**
 * Add Column ▸ Custom Column (M formula editor + Available columns) and Add Column ▸ Conditional
 * Column (If / Else If clauses), as in Power Query. Both edit their step again from the gear.
 */
import { useMemo, useRef, useState } from 'react'
import { AddRegular, CheckmarkCircleRegular, DismissRegular, ErrorCircleRegular } from '@fluentui/react-icons'
import { Button, Dropdown, IconButton, Modal, TextField, cx } from '../../../app/ui'
import { MEditor, type MDiagnostic, type MEditorHandle } from '../MEditor'
import { fieldRef, mNumber, mText, PQ_TYPES, pqTypeOf, type PqType } from '../logic/mtext'
import { fieldName, literalText, parseConditionalColumn, parseCustomColumn } from '../logic/stepSettings'
import { addConditionalColumn, addCustomColumn, replaceLiteral, type CondClause, type CondOperator } from '../logic/transforms'
import { closePqDialog } from '../pqDialogs'
import { columnOptions, commit, OkCancel, stepFormula, uniqueName, useInputTable } from './common'

// ---------------------------------------------------------------------------------------------
// Custom Column

const TYPE_OPTIONS: Array<{ value: PqType; label: string }> = [{ value: 'any', label: 'Any' }, ...PQ_TYPES.map((t) => ({ value: t.id, label: t.label }))]

export function CustomColumnDialog({ step }: { step?: string }) {
  const input = useInputTable(step)
  const parsed = useMemo(() => (step ? parseCustomColumn(stepFormula(step) ?? '') : null), [step])
  const [name, setName] = useState(() => parsed?.name ?? uniqueName('Custom', input.columns.map((c) => c.name)))
  const [body, setBody] = useState(parsed?.body ?? '')
  const [type, setType] = useState<PqType>(parsed?.type ?? 'any')
  const [diags, setDiags] = useState<MDiagnostic[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const editor = useRef<MEditorHandle>(null)
  const cols = input.columns.map((c) => c.name)
  const taken = !parsed || parsed.name !== name.trim() ? cols.some((c) => c.toLowerCase() === name.trim().toLowerCase()) : false
  const valid = !!name.trim() && !!body.trim() && !taken && diags.length === 0
  const insert = (c: string) => editor.current?.insertText(fieldRef(c))
  const ok = () => valid && void commit(addCustomColumn(name.trim(), body, type === 'any' ? undefined : type), step)
  return (
    <Modal title="Custom Column" subtitle="Add a column that is computed from the other columns." onClose={closePqDialog} width={820} height={560} footer={<OkCancel onOk={ok} disabled={!valid} />}>
      <div className="wbi-pq-dlg__custom">
        <div className="wbi-pq-dlg__custom-main">
          <div className="wbi-row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <TextField className="wbi-pq-dlg__grow" label="New column name" value={name} onChange={setName} error={taken ? `A column named '${name.trim()}' already exists.` : undefined} />
            <Dropdown label="Data type" value={type} options={TYPE_OPTIONS} onChange={setType} />
          </div>
          <div className="wbi-pq-dlg__label">Custom column formula</div>
          <div className="wbi-pq-dlg__formula">
            <span className="wbi-pq-dlg__eq">=</span>
            <MEditor ref={editor} value={body} onChange={setBody} expression autoFocus lineNumbers={false} wrap minHeight={220} className="wbi-pq-dlg__meditor" completions={{ columns: cols }} onDiagnostics={setDiags} onSubmit={() => ok()} />
          </div>
          <div className={cx('wbi-pq-dlg__syntax', diags.length > 0 && 'is-error')}>
            {diags.length ? (
              <>
                <ErrorCircleRegular fontSize={16} /> {diags[0]!.message} (line {diags[0]!.line}, col {diags[0]!.col})
              </>
            ) : (
              <>
                <CheckmarkCircleRegular fontSize={16} /> No syntax errors have been detected.
              </>
            )}
          </div>
        </div>
        <div className="wbi-pq-dlg__custom-side">
          <div className="wbi-pq-dlg__label">Available columns</div>
          <div className="wbi-pq-dlg__list wbi-pq-dlg__collist" role="listbox">
            {cols.map((c) => (
              <div key={c} role="option" aria-selected={pick === c} className={cx('wbi-pq-dlg__item', pick === c && 'is-selected')} onClick={() => setPick(c)} onDoubleClick={() => insert(c)}>
                {c}
              </div>
            ))}
          </div>
          <Button size="small" disabled={!pick} onClick={() => pick && insert(pick)}>
            &lt;&lt; Insert
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Conditional Column

const TEXT_OPS: Array<{ value: CondOperator; label: string }> = [
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'does not equal' },
  { value: 'beginsWith', label: 'begins with' },
  { value: 'notBeginsWith', label: 'does not begin with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'notEndsWith', label: 'does not end with' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' }
]
const NUMBER_OPS: Array<{ value: CondOperator; label: string }> = [
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'does not equal' },
  { value: 'greater', label: 'is greater than' },
  { value: 'greaterOrEqual', label: 'is greater than or equal to' },
  { value: 'less', label: 'is less than' },
  { value: 'lessOrEqual', label: 'is less than or equal to' }
]
const DATE_OPS: Array<{ value: CondOperator; label: string }> = [
  { value: 'equals', label: 'is' },
  { value: 'notEquals', label: 'is not' },
  { value: 'less', label: 'is before' },
  { value: 'greater', label: 'is after' },
  { value: 'lessOrEqual', label: 'is on or before' },
  { value: 'greaterOrEqual', label: 'is on or after' }
]

export function operatorsFor(colType: string): Array<{ value: CondOperator; label: string }> {
  const k = pqTypeOf(colType)
  if (k === 'number' || k === 'int64' || k === 'currency' || k === 'percentage') return NUMBER_OPS
  if (k === 'date' || k === 'datetime' || k === 'datetimezone' || k === 'time') return DATE_OPS
  if (k === 'text') return TEXT_OPS
  return [...TEXT_OPS.slice(0, 2), ...NUMBER_OPS.slice(2), ...TEXT_OPS.slice(2)]
}

/** A value / output operand: a typed value, or another column. */
interface Operand {
  mode: 'value' | 'column'
  text: string
}

interface Row {
  column: string
  op: CondOperator
  value: Operand
  output: Operand
}

/** Output literal: numbers stay numbers, `null` / empty → null, anything else is text. */
export function outputLiteral(text: string): string {
  const v = text.trim()
  if (v === '' || v === 'null') return 'null'
  if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return mNumber(Number(v))
  return mText(text)
}

function operandM(o: Operand, literal: (t: string) => string): string {
  return o.mode === 'column' ? fieldRef(o.text) : literal(o.text)
}

function operandOf(m: string): Operand {
  const f = fieldName(m)
  return f !== null ? { mode: 'column', text: f } : { mode: 'value', text: m.trim() === 'null' ? '' : literalText(m) }
}

function OperandInput({ value, onChange, columns, placeholder }: { value: Operand; onChange(o: Operand): void; columns: string[]; placeholder: string }) {
  return (
    <div className="wbi-row" style={{ gap: 4 }}>
      <Dropdown
        size="small"
        className="wbi-pq-dlg__mode"
        value={value.mode}
        title="Enter a value or select a column"
        options={[
          { value: 'value', label: 'ABC 123' },
          { value: 'column', label: 'Column' }
        ]}
        onChange={(m) => onChange({ mode: m, text: m === 'column' ? (columns[0] ?? '') : '' })}
      />
      {value.mode === 'column' ? (
        <Dropdown size="small" className="wbi-pq-dlg__grow" value={value.text} options={columns.map((c) => ({ value: c, label: c }))} onChange={(c) => onChange({ mode: 'column', text: c })} />
      ) : (
        <TextField size="small" className="wbi-pq-dlg__grow" value={value.text} placeholder={placeholder} onChange={(t) => onChange({ mode: 'value', text: t })} />
      )}
    </div>
  )
}

export function ConditionalColumnDialog({ step }: { step?: string }) {
  const input = useInputTable(step)
  const parsed = useMemo(() => (step ? parseConditionalColumn(stepFormula(step) ?? '') : null), [step])
  const cols = input.columns
  const names = cols.map((c) => c.name)
  const [name, setName] = useState(() => parsed?.name ?? uniqueName('Custom', names))
  const [rows, setRows] = useState<Row[]>(() =>
    parsed ? parsed.clauses.map((c) => ({ column: c.column, op: c.op, value: operandOf(c.value), output: operandOf(c.output) })) : [{ column: '', op: 'equals', value: { mode: 'value', text: '' }, output: { mode: 'value', text: '' } }]
  )
  const [otherwise, setOtherwise] = useState<Operand>(() => (parsed ? operandOf(parsed.otherwise) : { mode: 'value', text: '' }))
  const typeOf = (c: string) => cols.find((x) => x.name === c)?.type ?? 'any'
  const effRows = rows.map((r) => ({ ...r, column: r.column || names[0] || '' }))
  const taken = (!parsed || parsed.name !== name.trim()) && names.some((c) => c.toLowerCase() === name.trim().toLowerCase())
  const valid = !!name.trim() && !taken && effRows.length > 0 && effRows.every((r) => r.column && (r.value.mode === 'column' || r.value.text !== '' || pqTypeOf(typeOf(r.column)) === 'text'))
  const setRow = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...effRows[j]!, ...p } : r)))
  const ok = () => {
    if (!valid) return
    const clauses: CondClause[] = effRows.map((r) => ({
      column: r.column,
      op: r.op,
      value: operandM(r.value, (t) => (pqTypeOf(typeOf(r.column)) === 'text' ? mText(t) : replaceLiteral(t, typeOf(r.column)))),
      output: operandM(r.output, outputLiteral)
    }))
    void commit(addConditionalColumn(name.trim(), clauses, operandM(otherwise, outputLiteral)), step)
  }
  return (
    <Modal title="Add Conditional Column" subtitle="Add a conditional column that is computed from the other columns or values." onClose={closePqDialog} width={900} footer={<OkCancel onOk={ok} disabled={!valid} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <TextField className="wbi-pq-dlg__w320" label="New column name" value={name} onChange={setName} error={taken ? `A column named '${name.trim()}' already exists.` : undefined} />
        <div className="wbi-pq-dlg__cond">
          <div />
          <div className="wbi-pq-dlg__label">Column Name</div>
          <div className="wbi-pq-dlg__label">Operator</div>
          <div className="wbi-pq-dlg__label">Value</div>
          <div />
          <div className="wbi-pq-dlg__label">Output</div>
          <div />
          {effRows.map((r, i) => {
            const ops = operatorsFor(typeOf(r.column))
            return [
              <div key={`k${i}`} className="wbi-pq-dlg__condkw">
                {i === 0 ? 'If' : 'Else If'}
              </div>,
              <Dropdown key={`c${i}`} size="small" value={r.column} options={columnOptions(cols)} onChange={(c) => setRow(i, { column: c, op: operatorsFor(typeOf(c)).some((o) => o.value === r.op) ? r.op : 'equals' })} />,
              <Dropdown key={`o${i}`} size="small" value={ops.some((o) => o.value === r.op) ? r.op : ops[0]!.value} options={ops} onChange={(op) => setRow(i, { op })} />,
              <OperandInput key={`v${i}`} value={r.value} columns={names} placeholder="Enter a value" onChange={(value) => setRow(i, { value })} />,
              <div key={`t${i}`} className="wbi-pq-dlg__condkw">
                Then
              </div>,
              <OperandInput key={`u${i}`} value={r.output} columns={names} placeholder="Enter a value" onChange={(output) => setRow(i, { output })} />,
              <span key={`d${i}`}>{effRows.length > 1 && <IconButton label="Delete clause" icon={<DismissRegular fontSize={14} />} onClick={() => setRows(effRows.filter((_, j) => j !== i))} />}</span>
            ]
          })}
        </div>
        <div>
          <Button size="small" icon={<AddRegular fontSize={14} />} onClick={() => setRows([...effRows, { column: names[0] ?? '', op: 'equals', value: { mode: 'value', text: '' }, output: { mode: 'value', text: '' } }])}>
            Add Clause
          </Button>
        </div>
        <div className="wbi-row" style={{ gap: 12 }}>
          <div className="wbi-pq-dlg__condkw">Else</div>
          <div className="wbi-pq-dlg__w320">
            <OperandInput value={otherwise} columns={names} placeholder="Enter a value" onChange={setOtherwise} />
          </div>
        </div>
      </div>
    </Modal>
  )
}

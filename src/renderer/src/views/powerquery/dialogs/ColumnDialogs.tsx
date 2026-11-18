/**
 * Column / row dialogs: Choose Columns, Split Column (by delimiter / number of characters),
 * Replace Values / Replace Errors, Pivot Column, argument dialogs of Transform / Add Column
 * operations, Merge Columns, Add Index Column (custom) and Keep / Remove Rows.
 */
import { useMemo, useState } from 'react'
import { Checkbox, Dropdown, MenuButton, Modal, NumberField, Radio, SearchBox, TextField } from '../../../app/ui'
import { columnOpArgsValid, columnOpDialog, splitOnceAtPosition } from '../logic/dialogArgs'
import { pqTypeOf } from '../logic/mtext'
import { parseIndexColumn, parsePivot, parseReplace, parseReplaceErrors, parseRows, parseSplit } from '../logic/stepSettings'
import * as T from '../logic/transforms'
import type { PivotAgg } from '../logic/transforms'
import type { RowsDialogKind } from '../pqDialogs'
import { closePqDialog } from '../pqDialogs'
import { usePq } from '../pqStore'
import { cellText, columnOptions, columnValues, commit, Field, OkCancel, stepFormula, uniqueName, useInputTable } from './common'

// ---------------------------------------------------------------------------------------------
// Choose Columns

export function ChooseColumnsDialog() {
  const input = useInputTable()
  const [q, setQ] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(input.columns.map((c) => c.name)))
  const [sorted, setSorted] = useState(false)
  const all = input.columns.map((c) => c.name)
  const shown = (sorted ? [...all].sort((a, b) => a.localeCompare(b)) : all).filter((c) => !q || c.toLowerCase().includes(q.toLowerCase()))
  const allChecked = all.length > 0 && all.every((c) => checked.has(c))
  const toggle = (c: string, on: boolean) => setChecked((s) => {
    const n = new Set(s)
    if (on) n.add(c)
    else n.delete(c)
    return n
  })
  const ok = () => {
    const keep = all.filter((c) => checked.has(c))
    if (!keep.length) return
    if (keep.length === all.length) return closePqDialog()
    void commit(T.removeOtherColumns(keep))
  }
  return (
    <Modal title="Choose Columns" subtitle="Choose the columns to keep" onClose={closePqDialog} width={420} height={520} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!checked.size} />}>
      <div className="wbi-col" style={{ gap: 8, height: '100%' }}>
        <div className="wbi-row">
          <SearchBox value={q} onChange={setQ} placeholder="Search Columns" className="wbi-pq-dlg__grow" />
          <MenuButton
            className="wbi-btn wbi-btn--subtle"
            items={[
              { label: 'Sort A to Z', checked: sorted, onClick: () => setSorted(true) },
              { label: 'Natural Order', checked: !sorted, onClick: () => setSorted(false) }
            ]}
          >
            Sort ▾
          </MenuButton>
        </div>
        <div className="wbi-pq-dlg__list wbi-pq-dlg__checks">
          {!q && <Checkbox label="(Select All Columns)" checked={allChecked ? true : checked.size ? 'mixed' : false} onChange={(v) => setChecked(new Set(v ? all : []))} />}
          {shown.map((c) => (
            <Checkbox key={c} label={c} checked={checked.has(c)} onChange={(v) => toggle(c, v)} />
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Split Column

const DELIMITERS: Array<{ value: string; label: string; text: string }> = [
  { value: 'custom', label: '--Custom--', text: '' },
  { value: 'colon', label: 'Colon', text: ':' },
  { value: 'comma', label: 'Comma', text: ',' },
  { value: 'equals', label: 'Equals Sign', text: '=' },
  { value: 'semicolon', label: 'Semicolon', text: ';' },
  { value: 'space', label: 'Space', text: ' ' },
  { value: 'tab', label: 'Tab', text: '\t' }
]

function delimiterChoice(text: string): string {
  return DELIMITERS.find((d) => d.value !== 'custom' && d.text === text)?.value ?? 'custom'
}

export function SplitDialog({ mode, column, step }: { mode: 'delimiter' | 'positions'; column: string; step?: string }) {
  const input = useInputTable(step)
  const parsed = useMemo(() => (step ? parseSplit(stepFormula(step) ?? '') : null), [step])
  const values = useMemo(() => columnValues(input, column), [input, column])
  // by delimiter
  const [choice, setChoice] = useState(() => (parsed?.mode === 'delimiter' ? delimiterChoice(parsed.delimiter) : 'comma'))
  const [custom, setCustom] = useState(parsed?.mode === 'delimiter' ? parsed.delimiter : '')
  const [at, setAt] = useState<T.SplitAt>(parsed?.mode === 'delimiter' ? parsed.at : 'each')
  const [quote, setQuote] = useState<'Csv' | 'None'>(parsed?.mode === 'delimiter' ? parsed.quoteStyle : 'Csv')
  const delimiter = choice === 'custom' ? custom : DELIMITERS.find((d) => d.value === choice)!.text
  const detected = T.splitCount(values, delimiter)
  const [count, setCount] = useState<number | undefined>(parsed?.mode === 'delimiter' && parsed.at === 'each' ? parsed.count : undefined)
  // by positions
  const [chars, setChars] = useState<number | undefined>(parsed?.mode === 'positions' ? parsed.length : 1)
  const [repeat, setRepeat] = useState<'left' | 'right' | 'repeat'>(parsed?.mode === 'positions' ? parsed.repeat : 'repeat')
  const maxLen = Math.max(0, ...values.map((v) => (typeof v === 'string' ? v.length : 0)))
  const [posCount, setPosCount] = useState<number | undefined>(parsed?.mode === 'positions' && parsed.repeat === 'repeat' ? parsed.count : undefined)

  const ok = () => {
    if (mode === 'delimiter') {
      if (!delimiter) return
      void commit(T.splitByDelimiter(column, delimiter, at, count ?? detected, quote), step)
    } else {
      if (!chars || chars < 1) return
      if (repeat === 'repeat') void commit(T.splitByPositions(column, chars, posCount ?? Math.max(1, Math.ceil(maxLen / chars))), step)
      else void commit(splitOnceAtPosition(column, chars, repeat), step)
    }
  }
  const valid = mode === 'delimiter' ? !!delimiter : !!chars && chars >= 1
  if (mode === 'positions')
    return (
      <Modal title="Split Column by Number of Characters" subtitle="Specify the number of characters used to split the text column." onClose={closePqDialog} width={520} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!valid} />}>
        <div className="wbi-col" style={{ gap: 12 }}>
          <NumberField label="Number of characters" value={chars} onChange={setChars} min={1} />
          <Field label="Split">
            <div className="wbi-col" style={{ gap: 6 }}>
              <Radio checked={repeat === 'left'} onChange={() => setRepeat('left')} label="Once, as far left as possible" />
              <Radio checked={repeat === 'right'} onChange={() => setRepeat('right')} label="Once, as far right as possible" />
              <Radio checked={repeat === 'repeat'} onChange={() => setRepeat('repeat')} label="Repeatedly" />
            </div>
          </Field>
          {repeat === 'repeat' && <NumberField label="Number of columns to split into" value={posCount ?? Math.max(1, Math.ceil(maxLen / (chars || 1)))} onChange={setPosCount} min={1} />}
        </div>
      </Modal>
    )
  return (
    <Modal title="Split Column by Delimiter" subtitle="Specify the delimiter used to split the text column." onClose={closePqDialog} width={520} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!valid} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <Dropdown label="Select or enter delimiter" value={choice} options={DELIMITERS.map((d) => ({ value: d.value, label: d.label }))} onChange={setChoice} />
        {choice === 'custom' && <TextField value={custom} onChange={setCustom} autoFocus placeholder="Delimiter" />}
        <Field label="Split at">
          <div className="wbi-col" style={{ gap: 6 }}>
            <Radio checked={at === 'left'} onChange={() => setAt('left')} label="Left-most delimiter" />
            <Radio checked={at === 'right'} onChange={() => setAt('right')} label="Right-most delimiter" />
            <Radio checked={at === 'each'} onChange={() => setAt('each')} label="Each occurrence of the delimiter" />
          </div>
        </Field>
        <details className="wbi-pq-dlg__advanced" open={!!parsed}>
          <summary>Advanced options</summary>
          <div className="wbi-col" style={{ gap: 10, paddingTop: 8 }}>
            {at === 'each' && <NumberField label="Number of columns to split into" value={count ?? detected} onChange={setCount} min={1} />}
            <Dropdown
              label="Quote Character"
              value={quote}
              options={[
                { value: 'Csv', label: '"' },
                { value: 'None', label: 'None' }
              ]}
              onChange={setQuote}
            />
          </div>
        </details>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Replace Values / Replace Errors

const SPECIALS: Array<{ label: string; code: string; char: string }> = [
  { label: 'Tab', code: '#(tab)', char: '\t' },
  { label: 'Carriage Return', code: '#(cr)', char: '\r' },
  { label: 'Line Feed', code: '#(lf)', char: '\n' },
  { label: 'Carriage Return and Line Feed', code: '#(cr)#(lf)', char: '\r\n' },
  { label: 'Non-breaking Space', code: '#(00A0)', char: ' ' }
]

/** `#(tab)` / `#(lf)` / `#(00A0)` escapes typed with "Replace using special characters" → characters. */
function unescapeSpecials(s: string): string {
  return s.replace(/#\((tab|cr|lf|[0-9A-Fa-f]{4})\)/g, (_, c: string) => (c === 'tab' ? '\t' : c === 'cr' ? '\r' : c === 'lf' ? '\n' : String.fromCharCode(parseInt(c, 16))))
}

function escapeSpecials(s: string): string {
  return s.replace(/\r\n|[\t\r\n ]/g, (c) => SPECIALS.find((x) => x.char === c)?.code ?? c)
}

export function ReplaceDialog({ columns, errors, step }: { columns: string[]; errors?: boolean; step?: string }) {
  const input = useInputTable(step)
  const parsed = useMemo(() => (step ? (errors ? null : parseReplace(stepFormula(step) ?? '')) : null), [step, errors])
  const parsedErr = useMemo(() => (step && errors ? parseReplaceErrors(stepFormula(step) ?? '') : null), [step, errors])
  const hasSpecial = !!parsed && /[\t\r\n ]/.test(parsed.find + parsed.replace)
  const [find, setFind] = useState(parsed ? (hasSpecial ? escapeSpecials(parsed.find) : parsed.find) : '')
  const [repl, setRepl] = useState(parsed ? (hasSpecial ? escapeSpecials(parsed.replace) : parsed.replace) : parsedErr?.value ?? '')
  const [entire, setEntire] = useState(parsed?.matchEntire ?? false)
  const [special, setSpecial] = useState(hasSpecial)
  const [focus, setFocus] = useState<'find' | 'repl'>('find')
  const cols = columns.map((c) => input.columns.find((x) => x.name === c) ?? { name: c, type: 'any' })
  const allText = cols.every((c) => pqTypeOf(c.type) === 'text' || pqTypeOf(c.type) === 'any')

  if (errors) {
    const ok = () => void commit(T.replaceErrors(columns, T.replaceLiteral(repl, cols[0]?.type ?? 'any')), step)
    return (
      <Modal title="Replace Errors" subtitle="Enter the value which will replace errors in the selected columns." onClose={closePqDialog} width={460} onSubmit={ok} footer={<OkCancel onOk={ok} />}>
        <TextField label="Value" value={repl} onChange={setRepl} autoFocus />
      </Modal>
    )
  }
  const ok = () => {
    const f = special ? unescapeSpecials(find) : find
    const r = special ? unescapeSpecials(repl) : repl
    if (!f && !allText) return
    void commit(T.replaceValues(cols, f, r, entire), step)
  }
  const insertSpecial = (code: string) => (focus === 'find' ? setFind((v) => v + code) : setRepl((v) => v + code))
  return (
    <Modal title="Replace Values" subtitle="Replace one value with another in the selected columns." onClose={closePqDialog} width={520} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!find && !allText} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <div onFocus={() => setFocus('find')}>
          <TextField label="Value To Find" value={find} onChange={setFind} autoFocus />
        </div>
        <div onFocus={() => setFocus('repl')}>
          <TextField label="Replace With" value={repl} onChange={setRepl} />
        </div>
        {allText && (
          <details className="wbi-pq-dlg__advanced" open={entire || special}>
            <summary>Advanced options</summary>
            <div className="wbi-col" style={{ gap: 8, paddingTop: 8 }}>
              <Checkbox label="Match entire cell contents" checked={entire} onChange={setEntire} />
              <Checkbox label="Replace using special characters" checked={special} onChange={setSpecial} />
              {special && (
                <MenuButton className="wbi-btn wbi-btn--default" items={SPECIALS.map((s) => ({ label: s.label, onClick: () => insertSpecial(s.code) }))}>
                  Insert special character ▾
                </MenuButton>
              )}
            </div>
          </details>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Pivot Column

const PIVOT_AGGS: Array<{ value: PivotAgg; label: string }> = [
  { value: 'none', label: "Don't Aggregate" },
  { value: 'count', label: 'Count (All)' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'median', label: 'Median' },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'countDistinct', label: 'Count (Distinct)' }
]

export function PivotDialog({ column, step }: { column: string; step?: string }) {
  const input = useInputTable(step)
  const parsed = useMemo(() => (step ? parsePivot(stepFormula(step) ?? '') : null), [step])
  const others = input.columns.filter((c) => c.name !== column)
  const [value, setValue] = useState<string | undefined>(parsed?.value)
  const [agg, setAgg] = useState<PivotAgg>(parsed?.agg ?? 'sum')
  const v = value ?? others[0]?.name
  const ok = () => v && void commit(T.pivotColumn(column, v, agg), step)
  return (
    <Modal title="Pivot Column" subtitle={`Use the names in column "${column}" to create new columns.`} onClose={closePqDialog} width={480} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!v} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <Dropdown label="Values Column" value={v} options={columnOptions(others)} onChange={setValue} />
        <details className="wbi-pq-dlg__advanced" open={!!parsed && parsed.agg !== 'sum'}>
          <summary>Advanced options</summary>
          <div style={{ paddingTop: 8 }}>
            <Dropdown label="Aggregate Value Function" value={agg} options={PIVOT_AGGS} onChange={setAgg} />
          </div>
        </details>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Transform / Add Column argument dialogs

export function ColumnOpDialog({ op, insert }: { op: T.ColumnOp; insert: boolean }) {
  const def = columnOpDialog(op)
  const input = useInputTable()
  const selected = usePq((s) => s.selectedCols)
  const [values, setValues] = useState<string[]>(() => def?.fields.map((f) => f.defaultValue ?? '') ?? [])
  if (!def) return null
  const cols = input.columns.filter((c) => selected.includes(c.name))
  const valid = cols.length > 0 && columnOpArgsValid(op, values)
  const ok = () => {
    if (!valid) return
    const [a = '', b = ''] = values.map((v, i) => (def.fields[i]?.numeric ? String(Number(v.trim())) : v))
    if (insert)
      void commit(
        T.insertColumnOp(
          cols[0]!,
          op,
          a,
          b,
          input.columns.map((c) => c.name)
        )
      )
    else void commit(T.transformColumns(cols, op, a, b))
  }
  return (
    <Modal title={def.title} subtitle={def.description} onClose={closePqDialog} width={460} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!valid} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        {def.fields.map((f, i) => (
          <TextField key={f.label} label={f.label} value={values[i] ?? ''} onChange={(v) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)))} autoFocus={i === 0} error={f.numeric && values[i]?.trim() && !Number.isFinite(Number(values[i])) ? 'Enter a number.' : undefined} />
        ))}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Merge Columns

const SEPARATORS: Array<{ value: string; label: string; text: string }> = [
  { value: 'none', label: '--None--', text: '' },
  { value: 'colon', label: 'Colon', text: ':' },
  { value: 'comma', label: 'Comma', text: ',' },
  { value: 'equals', label: 'Equals Sign', text: '=' },
  { value: 'semicolon', label: 'Semicolon', text: ';' },
  { value: 'space', label: 'Space', text: ' ' },
  { value: 'tab', label: 'Tab', text: '\t' },
  { value: 'custom', label: '--Custom--', text: '' }
]

export function MergeColumnsDialog({ insert }: { insert: boolean }) {
  const input = useInputTable()
  const selected = usePq((s) => s.selectedCols)
  const cols = input.columns.filter((c) => selected.includes(c.name)).map((c) => c.name)
  // PQ merges in the order the columns were selected
  const ordered = selected.filter((c) => cols.includes(c))
  const [sep, setSep] = useState('none')
  const [custom, setCustom] = useState('')
  const [name, setName] = useState(() => uniqueName('Merged', input.columns.map((c) => c.name)))
  const separator = sep === 'custom' ? custom : SEPARATORS.find((s) => s.value === sep)!.text
  const ok = () => {
    if (ordered.length < 2 || !name.trim()) return
    void commit(insert ? T.insertMergedColumn(ordered, separator, name.trim()) : T.mergeColumns(ordered, separator, name.trim()))
  }
  return (
    <Modal title="Merge Columns" subtitle="Choose how to merge the selected columns." onClose={closePqDialog} width={460} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={ordered.length < 2 || !name.trim()} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <Dropdown label="Separator" value={sep} options={SEPARATORS.map((s) => ({ value: s.value, label: s.label }))} onChange={setSep} />
        {sep === 'custom' && <TextField value={custom} onChange={setCustom} autoFocus />}
        <TextField label="New column name (optional)" value={name} onChange={setName} />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Add Index Column (Custom)

export function IndexColumnDialog({ step }: { step?: string }) {
  const parsed = useMemo(() => (step ? parseIndexColumn(stepFormula(step) ?? '') : null), [step])
  const [start, setStart] = useState<number | undefined>(parsed?.start ?? 0)
  const [inc, setInc] = useState<number | undefined>(parsed?.increment ?? 1)
  const ok = () => start !== undefined && inc !== undefined && void commit(T.addIndexColumn(start, inc, parsed?.name ?? 'Index'), step)
  return (
    <Modal title="Add Index Column" subtitle="Specify the starting index and increment." onClose={closePqDialog} width={420} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={start === undefined || inc === undefined} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <NumberField label="Starting Index" value={start} onChange={setStart} />
        <NumberField label="Increment" value={inc} onChange={setInc} />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Keep / Remove rows

const ROWS: Record<RowsDialogKind, { title: string; subtitle: string; fields: Array<{ label: string; def: number; min: number }>; spec(v: number[]): T.StepSpec }> = {
  keepTop: { title: 'Keep Top Rows', subtitle: 'Specify how many rows to keep.', fields: [{ label: 'Number of rows', def: 1, min: 0 }], spec: ([n]) => T.keepFirstRows(n!) },
  keepBottom: { title: 'Keep Bottom Rows', subtitle: 'Specify how many rows to keep.', fields: [{ label: 'Number of rows', def: 1, min: 0 }], spec: ([n]) => T.keepLastRows(n!) },
  keepRange: {
    title: 'Keep Range of Rows',
    subtitle: 'Specify the range of rows to keep.',
    fields: [
      { label: 'First row', def: 1, min: 1 },
      { label: 'Number of rows', def: 1, min: 0 }
    ],
    spec: ([a, b]) => T.keepRange(a!, b!)
  },
  removeTop: { title: 'Remove Top Rows', subtitle: 'Specify how many rows to remove from the top.', fields: [{ label: 'Number of rows', def: 1, min: 0 }], spec: ([n]) => T.removeTopRows(n!) },
  removeBottom: { title: 'Remove Bottom Rows', subtitle: 'Specify how many rows to remove from the bottom.', fields: [{ label: 'Number of rows', def: 1, min: 0 }], spec: ([n]) => T.removeBottomRows(n!) },
  removeAlternate: {
    title: 'Remove Alternate Rows',
    subtitle: 'Specify the pattern of rows to remove and keep.',
    fields: [
      { label: 'First row to remove', def: 1, min: 1 },
      { label: 'Number of rows to remove', def: 1, min: 0 },
      { label: 'Number of rows to keep', def: 1, min: 0 }
    ],
    spec: ([a, b, c]) => T.removeAlternateRows(a!, b!, c!)
  }
}

export function RowsDialog({ kind, step }: { kind: RowsDialogKind; step?: string }) {
  const def = ROWS[kind]
  const parsed = useMemo(() => (step ? parseRows(stepFormula(step) ?? '') : null), [step])
  const [values, setValues] = useState<Array<number | undefined>>(() => def.fields.map((f, i) => (parsed?.kind === kind ? parsed.values[i] : undefined) ?? f.def))
  const valid = values.every((v, i) => v !== undefined && Number.isInteger(v) && v >= def.fields[i]!.min)
  const ok = () => valid && void commit(def.spec(values as number[]), step)
  return (
    <Modal title={def.title} subtitle={def.subtitle} onClose={closePqDialog} width={440} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!valid} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        {def.fields.map((f, i) => (
          <NumberField key={f.label} label={f.label} value={values[i]} min={f.min} onChange={(v) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)))} />
        ))}
      </div>
    </Modal>
  )
}

/** Suggestions of distinct preview values of a column (filter / conditional dialogs). */
export function distinctTexts(values: ReturnType<typeof columnValues>, max = 200): string[] {
  const out = new Set<string>()
  for (const v of values) {
    if (v === null || typeof v === 'object') continue
    out.add(cellText(v))
    if (out.size >= max) break
  }
  return [...out]
}


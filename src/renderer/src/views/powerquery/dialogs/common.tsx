/**
 * Shared bits of the Power Query dialogs: the input table of the step being added / edited, the
 * edited step's formula, commit helpers, and small layout pieces (labelled field, OK/Cancel footer).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PreviewCell } from '@core/m/engine.ts'
import { Button } from '../../../app/ui'
import { addOrReplace } from '../actions'
import { closePqDialog } from '../pqDialogs'
import { selectedQuery, usePq } from '../pqStore'
import { previewDraftQuery, effectiveStep } from '../session'
import { firstArgStep, outlineQuery } from '../logic/steps'
import type { ColInfo, StepSpec } from '../logic/transforms'
import './dialogs.css'

/** Formula of a step of the selected query. */
export function stepFormula(step: string | undefined): string | null {
  if (!step) return null
  const q = selectedQuery()
  return outlineQuery(q?.source ?? '')?.steps.find((s) => s.name === step)?.formula ?? null
}

/** The step whose output feeds `step` (its first argument, else the previous step). */
export function inputStepOf(source: string, step: string): string | null {
  const o = outlineQuery(source)
  const i = o?.steps.findIndex((s) => s.name === step) ?? -1
  if (!o || i < 0) return null
  return firstArgStep(o.steps[i]!.formula) ?? (i > 0 ? o.steps[i - 1]!.name : null)
}

export interface InputTable {
  columns: ColInfo[]
  rows: PreviewCell[][]
  loading: boolean
}

/**
 * The table a dialog works on: the shown preview when adding a step; the edited step's input when
 * editing one (evaluated on demand, so the dialog lists the columns that step actually sees).
 */
export function useInputTable(step?: string): InputTable {
  const preview = usePq((s) => s.preview.result)
  const shown = useMemo<InputTable>(() => {
    const r = preview?.result
    return r?.ok && r.preview.kind === 'table' ? { columns: r.preview.columns, rows: r.preview.rows, loading: false } : { columns: [], rows: [], loading: false }
  }, [preview])
  const [edited, setEdited] = useState<InputTable | null>(step ? { columns: [], rows: [], loading: true } : null)
  useEffect(() => {
    if (!step) return
    const q = selectedQuery()
    if (!q) return
    const input = inputStepOf(q.source, step)
    if (!input) return setEdited({ columns: [], rows: [], loading: false })
    const ctl = new AbortController()
    // the last step's value is the query result: preview the input step explicitly
    previewDraftQuery(q, { step: effectiveStep(q.source, input) ?? input, rowLimit: 1000, signal: ctl.signal })
      .then((r) => {
        if (ctl.signal.aborted) return
        const res = r.result
        setEdited(res.ok && res.preview.kind === 'table' ? { columns: res.preview.columns, rows: res.preview.rows, loading: false } : { columns: [], rows: [], loading: false })
      })
      .catch(() => !ctl.signal.aborted && setEdited({ columns: [], rows: [], loading: false }))
    return () => ctl.abort()
  }, [step])
  return edited ?? shown
}

/** Values of one column of an input table. */
export function columnValues(t: InputTable, column: string): PreviewCell[] {
  const i = t.columns.findIndex((c) => c.name === column)
  return i < 0 ? [] : t.rows.map((r) => r[i] ?? null)
}

/** Add the step (or replace the edited one) and close the dialog. */
export async function commit(spec: StepSpec, step?: string): Promise<void> {
  closePqDialog()
  await addOrReplace(spec, step)
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="wbi-pq-dlg__field">
      <div className="wbi-pq-dlg__label">{label}</div>
      {children}
      {hint && <div className="wbi-pq-dlg__hint">{hint}</div>}
    </div>
  )
}

export function OkCancel({ onOk, okText = 'OK', disabled, onCancel = closePqDialog }: { onOk(): void; okText?: string; disabled?: boolean; onCancel?(): void }) {
  return (
    <>
      <Button variant="primary" disabled={disabled} onClick={onOk}>
        {okText}
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </>
  )
}

/** Dropdown options of the input columns. */
export function columnOptions(cols: ColInfo[]): Array<{ value: string; label: string }> {
  return cols.map((c) => ({ value: c.name, label: c.name }))
}

/** Unique "Name", "Name.1", … among existing names. */
export function uniqueName(base: string, existing: string[]): string {
  let n = base
  for (let i = 1; existing.includes(n); i++) n = `${base}.${i}`
  return n
}

/** Display text of a preview cell (for value suggestions). */
export function cellText(v: PreviewCell): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
    return d ? `${+d[2]!}/${+d[3]!}/${+d[1]!}` : v
  }
  return '$error' in v ? 'Error' : v.$kind
}

/** The selected query's name (dialog subtitles). */
export function useQueryName(): string {
  return usePq((s) => s.draft.queries.find((q) => q.id === s.selectedId)?.name ?? '')
}

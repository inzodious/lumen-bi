/**
 * Power BI formula bar: shown below the ribbon when a measure, calculated column or calculated table
 * is selected (`useApp().selectedField`). Text is `Name = expression`; ✓ / Enter commits (rename +
 * expression through `mutateModel`, dependent references renamed like PBI), ✗ / Esc cancels,
 * chevron expands to a multi-line editor. Diagnostics (local + engine.validateExpression) show inline.
 *
 * Place it anywhere: <FormulaBar /> renders nothing when the selection has no formula.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckmarkRegular, ChevronDownRegular, ChevronUpRegular, DismissRegular, ErrorCircleRegular, WarningRegular } from '@fluentui/react-icons'
import type { ExpressionDiagnostic } from '@core/engine/api'
import type { SemanticModel } from '@core/model/types'
import { useApp, type FieldSelection } from '../state/store'
import { DaxEditor, type DaxEditorHandle } from './dax/DaxEditor'
import { formatDaxDefinition, splitDefinition } from './dax/formatter'
import { schemaFromModel } from './dax/schema'
import { takeFormulaBarFocus, useFormulaBarState } from './formulaBarState'
import { localDaxDiagnostics } from './dax/diagnostics'
import { MenuButton } from '../app/ui'
import { MoreHorizontalRegular } from '@fluentui/react-icons'
import type { SQFilter } from '@core/report/sq'
import { findPage } from '../report/pbir'
import { pageScopeFilters } from '../report/filters'
import { pageSlicerFilters } from '../report/runtime'
import { useInteraction } from '../state/interaction'
import '../dialogs/modeling/ribbonTabs'
import { inferColumnType, inferTableColumns, isCalculatedTable, syncCalculatedTableColumns } from '../dialogs/modeling/context'
import { nameError, renameColumn, renameMeasure, renameTable } from '../dialogs/modeling/logic/modelOps'
import { renameReportReferences } from '../dialogs/modeling/fieldEdits'
import './formula-bar.css'

export interface FormulaTarget {
  kind: 'measure' | 'calculatedColumn' | 'calculatedTable'
  table: string
  name: string
  expression: string
}

/** The formula object for a selection, or null when the selection has no DAX formula. */
export function formulaTarget(model: SemanticModel | undefined, sel: FieldSelection | null): FormulaTarget | null {
  if (!model || !sel) return null
  const t = model.tables.find((x) => x.name === sel.table)
  if (!t) return null
  if (sel.kind === 'measure') {
    const m = t.measures.find((x) => x.name === sel.name)
    return m ? { kind: 'measure', table: t.name, name: m.name, expression: m.expression } : null
  }
  if (sel.kind === 'column') {
    const c = t.columns.find((x) => x.name === sel.name)
    return c && c.kind === 'calculated' ? { kind: 'calculatedColumn', table: t.name, name: c.name, expression: c.expression ?? '' } : null
  }
  if (sel.kind === 'table' && isCalculatedTable(t) && !t.calculationGroup) {
    return { kind: 'calculatedTable', table: t.name, name: t.name, expression: t.partitions[0]?.expression ?? '' }
  }
  return null
}

function displayName(name: string): string {
  return /[=\n]|^\s|\s$/.test(name) ? `[${name.replace(/]/g, ']]')}]` : name
}

export function definitionText(t: FormulaTarget): string {
  const expr = t.expression.replace(/^\s*\n/, '')
  return expr.includes('\n') ? `${displayName(t.name)} =\n${expr}` : `${displayName(t.name)} = ${expr}`
}

/** Commit `text` (`Name = expression`) to the model. Returns an error message or null. */
export function commitFormula(target: FormulaTarget, text: string): string | null {
  const state = useApp.getState()
  const project = state.project
  if (!project) return 'No model is open.'
  const split = splitDefinition(text)
  if (!split) return `The syntax is incorrect. Use the form: Name = expression.`
  const newName = split.name.trim()
  const expression = split.expression.replace(/\s+$/, '')
  if (newName === target.name && expression === target.expression) return null
  const kindForName = target.kind === 'measure' ? 'measure' : target.kind === 'calculatedColumn' ? 'column' : 'table'
  const err = nameError(project.model, kindForName, newName, target.table, target.name)
  if (err) return err
  const engine = state.engine
  if (target.kind === 'measure') {
    state.mutateModel(`Edit measure ${newName}`, (m) => {
      renameMeasure(m, target.table, target.name, newName)
      const meas = m.tables.find((t) => t.name === target.table)?.measures.find((x) => x.name === newName)
      if (meas) meas.expression = expression
    })
    renameReportReferences({ kind: 'measure', table: target.table, name: target.name }, newName)
    state.selectField({ kind: 'measure', table: target.table, name: newName })
  } else if (target.kind === 'calculatedColumn') {
    const dt = inferColumnType(engine, target.table, expression)
    state.mutateModel(`Edit column ${newName}`, (m) => {
      renameColumn(m, target.table, target.name, newName)
      const col = m.tables.find((t) => t.name === target.table)?.columns.find((x) => x.name === newName)
      if (!col) return
      col.expression = expression
      if (dt) {
        col.dataType = dt
        const numeric = dt === 'int64' || dt === 'double' || dt === 'decimal'
        if (col.annotations?.SummarizationSetBy !== 'User') col.summarizeBy = numeric ? 'sum' : 'none'
      }
    })
    renameReportReferences({ kind: 'column', table: target.table, name: target.name }, newName)
    state.selectField({ kind: 'column', table: target.table, name: newName })
  } else {
    const inferred = inferTableColumns(engine, expression)
    state.mutateModel(`Edit table ${newName}`, (m) => {
      renameTable(m, target.table, newName)
      const t = m.tables.find((x) => x.name === newName)
      if (!t) return
      const p = t.partitions[0]
      if (p) {
        p.expression = expression
        if (p.name === target.table) p.name = newName
      } else t.partitions.push({ name: newName, mode: 'import', sourceType: 'calculated', expression })
      if (inferred && !inferred.error) syncCalculatedTableColumns(t, inferred.columns)
    })
    renameReportReferences({ kind: 'table', table: target.table }, newName)
    state.selectField({ kind: 'table', table: newName })
    if (inferred?.error) return inferred.error
  }
  return null
}

export interface FormulaBarProps {
  className?: string
}

export function FormulaBar({ className }: FormulaBarProps) {
  const model = useApp((s) => s.project?.model)
  const sel = useApp((s) => s.selectedField)
  const engine = useApp((s) => s.engine)
  const target = useMemo(() => formulaTarget(model, sel), [model, sel])
  if (!target) return null
  return <FormulaBarInner key={`${target.kind}:${target.table}:${target.name}`} target={target} engineReady={!!engine} className={className} />
}

function FormulaBarInner({ target, className, engineReady }: { target: FormulaTarget; className?: string; engineReady: boolean }) {
  const model = useApp((s) => s.project?.model)
  const original = useMemo(() => definitionText(target), [target])
  const [text, setText] = useState(original)
  const [diags, setDiags] = useState<ExpressionDiagnostic[]>([])
  const [commitError, setCommitError] = useState<string | null>(null)
  const expanded = useFormulaBarState((s) => s.expanded)
  const setExpanded = useFormulaBarState((s) => s.setExpanded)
  const focusToken = useFormulaBarState((s) => s.focusToken)
  const formatOnCommit = useFormulaBarState((s) => s.formatOnCommit)
  const livePreview = useFormulaBarState((s) => s.livePreview)
  const setOption = useFormulaBarState((s) => s.setOption)
  const editor = useRef<DaxEditorHandle>(null)
  const committing = useRef(false)
  const preview = useLivePreview(target, text, livePreview && engineReady)

  useEffect(() => setText(original), [original])
  // New measure / column / table: focus with the caret after `= ` (runs on mount and on later requests)
  useEffect(() => {
    if (!takeFormulaBarFocus()) return
    const view = editor.current?.view()
    if (view) {
      view.focus()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
    }
  }, [focusToken])

  const schema = useMemo(() => schemaFromModel(model, target.kind === 'calculatedColumn' ? target.table : undefined), [model, target])

  const validate = useCallback(
    (full: string): ExpressionDiagnostic[] => {
      const engine = useApp.getState().engine
      if (!engine) return []
      const split = splitDefinition(full)
      if (!split || !split.expression.trim()) return []
      const offset = full.length - split.expression.length
      return engine.validateExpression(split.expression, { kind: target.kind, table: target.table }).map((d) => ({ ...d, start: d.start !== undefined ? d.start + offset : offset, end: d.end !== undefined ? d.end + offset : full.length }))
    },
    [target]
  )

  const commit = (value: string) => {
    if (committing.current) return
    committing.current = true
    try {
      let v = value
      if (useFormulaBarState.getState().formatOnCommit) {
        const split = splitDefinition(v)
        // only format code that parses cleanly (never reshape broken text)
        if (split && !localDaxDiagnostics(split.expression).some((d) => d.severity === 'error')) v = formatDaxDefinition(v)
      }
      const err = commitFormula(target, v)
      setCommitError(err)
    } finally {
      committing.current = false
    }
  }
  const cancel = () => {
    setText(original)
    editor.current?.setValue(original)
    setCommitError(null)
  }

  const dirty = text !== original
  const shownError = commitError ?? diags.find((d) => d.severity === 'error')?.message ?? null
  const shownWarning = !shownError ? (diags.find((d) => d.severity === 'warning')?.message ?? null) : null

  return (
    <div className={`wbi-formula-bar ${expanded ? 'is-expanded' : ''} ${className ?? ''}`} data-testid="formula-bar">
      <div className="wbi-formula-bar__row">
        <div className="wbi-formula-bar__buttons">
          <button type="button" className="wbi-formula-bar__btn" title="Cancel (Esc)" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancel} disabled={!dirty && !commitError}>
            <DismissRegular />
          </button>
          <button type="button" className="wbi-formula-bar__btn" title="Commit (Enter)" aria-label="Commit" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(editor.current?.getValue() ?? text)}>
            <CheckmarkRegular />
          </button>
        </div>
        <div
          className="wbi-formula-bar__editor"
          onBlur={(e) => {
            // PBI commits when focus leaves the formula bar
            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && (editor.current?.getValue() ?? text) !== original) commit(editor.current?.getValue() ?? text)
          }}
        >
          <DaxEditor
            ref={editor}
            value={text}
            onChange={(v) => {
              setText(v)
              setCommitError(null)
            }}
            onSubmit={commit}
            onCancel={cancel}
            enterSubmits
            lineNumbers
            schema={schema}
            validate={engineReady ? validate : undefined}
            onDiagnostics={setDiags}
            formatter={(s) => formatDaxDefinition(s)}
            lintFrom={(full) => {
              const split = splitDefinition(full)
              return split ? full.length - split.expression.length : 0
            }}
          />
        </div>
        {preview && (
          <span className={`wbi-formula-bar__preview ${preview.error ? 'is-error' : ''}`} title={preview.title}>
            {preview.text}
          </span>
        )}
        <MenuButton
          className="wbi-formula-bar__btn wbi-formula-bar__more"
          title="Formula bar options"
          placement="bottom-end"
          items={() => [
            { label: 'Format DAX', shortcut: 'Shift+Alt+F', onClick: () => editor.current?.format() },
            { separator: true },
            { label: 'Format on commit', checked: formatOnCommit, onClick: () => setOption('formatOnCommit', !formatOnCommit) },
            { label: 'Show live value', checked: livePreview, onClick: () => setOption('livePreview', !livePreview) }
          ]}
        >
          <MoreHorizontalRegular />
        </MenuButton>
        <button type="button" className="wbi-formula-bar__btn wbi-formula-bar__expand" title={expanded ? 'Collapse the formula bar' : 'Expand the formula bar'} aria-label="Expand" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
        </button>
      </div>
      {(shownError || shownWarning) && (
        <div className={`wbi-formula-bar__msg ${shownError ? 'is-error' : 'is-warning'}`} role="alert">
          {shownError ? <ErrorCircleRegular /> : <WarningRegular />}
          <span>{shownError ?? shownWarning}</span>
        </div>
      )}
    </div>
  )
}

/** Filters of the active report page (report + page filter cards + slicers) — "no visual context". */
function pageContextFilters(): { filters: SQFilter[]; label: string } {
  const s = useApp.getState()
  const report = s.project?.report
  const page = findPage(report, s.activePage)
  if (!report || !page || s.view !== 'report') return { filters: [], label: 'no filters' }
  try {
    const slicers = Object.values(pageSlicerFilters(page, useInteraction.getState().slicers[page.name])).filter((f): f is SQFilter => !!f)
    return { filters: [...pageScopeFilters(report, page), ...slicers], label: `filters of page "${page.json?.displayName ?? page.name}"` }
  } catch {
    return { filters: [], label: 'no filters' }
  }
}

/**
 * Live value (beyond PBI): evaluate the measure being edited under the current page filters,
 * debounced. Calculated tables show their row count. Calculated columns have no single value.
 */
function useLivePreview(target: FormulaTarget, text: string, enabled: boolean): { text: string; title: string; error?: boolean } | null {
  const [out, setOut] = useState<{ text: string; title: string; error?: boolean } | null>(null)
  const revision = useApp((s) => s.revision)
  const slicers = useInteraction((s) => s.slicers)
  const first = useRef(true)
  useEffect(() => {
    if (!enabled || target.kind === 'calculatedColumn') {
      setOut(null)
      return
    }
    const run = () => {
      const engine = useApp.getState().engine
      const split = splitDefinition(text)
      const expr = split?.expression.trim()
      if (!engine || !expr || localDaxDiagnostics(expr).some((d) => d.severity === 'error')) {
        setOut(null)
        return
      }
      const { filters, label } = pageContextFilters()
      try {
        if (target.kind === 'calculatedTable') {
          const r = engine.evaluateScalar(`COUNTROWS ( ${expr} )`, [])
          setOut({ text: `${typeof r.value === 'number' ? r.value.toLocaleString('en-US') : 0} rows`, title: 'Rows returned by the table expression' })
          return
        }
        const fmt = useApp.getState().project?.model.tables.find((t) => t.name === target.table)?.measures.find((m) => m.name === target.name)?.formatString
        const r = engine.evaluateScalar(expr, filters)
        const shown = r.value === null ? '(Blank)' : engine.format(r.value, r.formatString ?? fmt)
        setOut({ text: `= ${shown}`, title: `Value with ${label} (no visual context)` })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setOut({ text: msg.length > 60 ? `${msg.slice(0, 57)}…` : msg, title: msg, error: true })
      }
    }
    // first value right away (selection), then debounced while typing
    if (first.current) {
      first.current = false
      run()
      return
    }
    const h = setTimeout(run, 450)
    return () => clearTimeout(h)
  }, [target, text, enabled, revision, slicers])
  return out
}

/**
 * Power Query formula bar: ✗ / ✓ (cancel / commit), `fx`, the selected step's formula as
 * `= Table.SelectRows(…)` in an M editor, and the expand chevron. Enter commits, Shift+Enter breaks
 * the line, Escape cancels. Queries that aren't `let … in` expressions show (and edit) the whole text.
 */
import { useEffect, useRef, useState } from 'react'
import { CheckmarkRegular, ChevronDownRegular, ChevronUpRegular, DismissRegular } from '@fluentui/react-icons'
import { cx } from '../../app/ui'
import { outlineQuery } from './logic/steps'
import { usePq, useSelectedQuery, previewColumns } from './pqStore'
import { MEditor, type MEditorHandle } from './MEditor'
import { useShallow } from 'zustand/react/shallow'
import { commitStepFormula } from './actions'

export function PqFormulaBar() {
  const q = useSelectedQuery()
  const selStep = usePq((s) => (q ? (s.steps[q.id] ?? null) : null))
  const expanded = usePq((s) => s.formulaExpanded)
  const columns = usePq(useShallow((s) => previewColumns(s).map((c) => c.name)))
  const draftNames = usePq(useShallow((s) => s.draft.queries.map((x) => x.name)))
  const outline = q ? outlineQuery(q.source) : null
  const stepName = outline?.steps.length ? (selStep && outline.steps.some((s) => s.name === selStep) ? selStep : outline.steps[outline.steps.length - 1]!.name) : null
  const formula = !q ? '' : outline && stepName ? (outline.steps.find((s) => s.name === stepName)?.formula ?? '') : q.source.trim()
  const shown = q ? `= ${formula}` : ''
  const [text, setText] = useState(shown)
  const [editing, setEditing] = useState(false)
  const ed = useRef<MEditorHandle>(null)

  useEffect(() => {
    setText(shown)
    setEditing(false)
  }, [shown])

  const dirty = editing && text !== shown
  const commit = (v: string) => {
    if (v === shown) return setEditing(false)
    if (commitStepFormula(v)) setEditing(false)
  }
  const cancel = () => {
    setText(shown)
    setEditing(false)
  }
  const index = outline && stepName ? outline.steps.findIndex((s) => s.name === stepName) : -1
  const steps = outline && index > 0 ? outline.steps.slice(0, index).map((s) => s.name) : []

  return (
    <div className={cx('wbi-pq-fbar', expanded && 'is-expanded')}>
      <button type="button" className="wbi-pq-fbar__btn" disabled={!dirty} title="Cancel" aria-label="Cancel" onClick={cancel}>
        <DismissRegular fontSize={16} />
      </button>
      <button type="button" className="wbi-pq-fbar__btn" disabled={!dirty} title="Commit" aria-label="Commit" onClick={() => commit(ed.current?.getValue() ?? text)}>
        <CheckmarkRegular fontSize={16} />
      </button>
      <span className="wbi-pq-fbar__fx">
        <i>f</i>x
      </span>
      <div className="wbi-pq-fbar__editor" onFocusCapture={() => setEditing(true)}>
        <MEditor
          ref={ed}
          value={text}
          onChange={(v) => {
            setText(v)
            setEditing(true)
          }}
          onSubmit={commit}
          onCancel={cancel}
          singleLine
          expression
          readOnly={!q}
          maxHeight={expanded ? 260 : undefined}
          completions={{ steps, queries: draftNames.filter((n) => n !== q?.name), columns }}
        />
      </div>
      <button type="button" className="wbi-pq-fbar__expand" title={expanded ? 'Collapse the formula bar' : 'Expand the formula bar'} aria-label="Expand" onClick={() => usePq.setState({ formulaExpanded: !expanded })}>
        {expanded ? <ChevronUpRegular fontSize={14} /> : <ChevronDownRegular fontSize={14} />}
      </button>
    </div>
  )
}

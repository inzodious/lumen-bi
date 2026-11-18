/**
 * Query Settings pane (right): PROPERTIES (Name + All Properties) and APPLIED STEPS — click previews
 * at that step, gear opens the step's settings dialog (prefilled from its formula), hover ✕ deletes,
 * double-click / F2 renames inline, warning icon on the first failing step, and Power BI's step
 * context menu.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { DismissRegular, SettingsRegular, WarningFilled } from '@fluentui/react-icons'
import { cx, showContextMenu, type MenuItem } from '../../app/ui'
import { outlineQuery } from './logic/steps'
import { hasStepSettings, readStepDescription, stepSettingsDialog } from './logic/stepSettings'
import { usePq, useSelectedQuery } from './pqStore'
import { openPqDialog } from './pqDialogs'
import { effectiveStep } from './session'
import { deleteStepAction, deleteUntilEndAction, insertStepAfterAction, moveStepAction, renameQueryAction, renameStepAction, selectStep } from './actions'

/** Opens a step's settings dialog, or focuses the formula bar when it has none. */
export function editStepSettings(name: string, formula: string): void {
  selectStep(name)
  const d = stepSettingsDialog(name, formula)
  if (d) openPqDialog(d)
  else usePq.getState().setView({ formulaBar: true })
}

function StepRename({ value, onDone }: { value: string; onDone(v: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [v, setV] = useState(value)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') onDone(v)
    if (e.key === 'Escape') onDone(null)
  }
  return <input ref={ref} className="wbi-pq-rename" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={key} onBlur={() => onDone(v)} spellCheck={false} onClick={(e) => e.stopPropagation()} />
}

function NameField() {
  const q = useSelectedQuery()
  const [v, setV] = useState(q?.name ?? '')
  useEffect(() => setV(q?.name ?? ''), [q?.id, q?.name])
  if (!q) return null
  const commit = () => {
    if (!renameQueryAction(q.id, v)) setV(q.name)
  }
  return (
    <input
      className="wbi-pq-namefield"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setV(q.name)
      }}
      spellCheck={false}
      aria-label="Name"
    />
  )
}

function stepMenu(name: string, formula: string, index: number, count: number, rename: () => void): MenuItem[] {
  return [
    { label: 'Edit Settings', disabled: !hasStepSettings(formula), onClick: () => editStepSettings(name, formula) },
    { label: 'Rename', shortcut: 'F2', onClick: rename },
    { label: 'Delete', shortcut: 'Del', onClick: () => void deleteStepAction(name) },
    { label: 'Delete Until End', disabled: index === 0, onClick: () => void deleteUntilEndAction(name) },
    { label: 'Insert Step After', onClick: () => insertStepAfterAction(name) },
    { separator: true },
    { label: 'Move Before', disabled: index <= 1, onClick: () => moveStepAction(name, 'up') },
    { label: 'Move After', disabled: index === 0 || index >= count - 1, onClick: () => moveStepAction(name, 'down') },
    { separator: true },
    { label: 'Extract Previous', disabled: true, title: 'Not available in Lumen' },
    { label: 'View Native Query', disabled: true, title: 'Native queries are not shown in Lumen' },
    { separator: true },
    { label: 'Properties…', onClick: () => openPqDialog({ id: 'stepProperties', step: name }) }
  ]
}

function AppliedSteps() {
  const q = useSelectedQuery()
  const selected = usePq((s) => (q ? (s.steps[q.id] ?? null) : null))
  const errorStep = usePq((s) => (q ? s.errorSteps[q.id] : undefined))
  const renaming = usePq((s) => s.renamingStep)
  if (!q) return null
  const outline = outlineQuery(q.source)
  if (!outline || !outline.steps.length) {
    if (q.kind === 'function' || q.kind === 'parameter') return null
    return (
      <div className="wbi-pq-steps" role="listbox">
        <div className="wbi-pq-step is-selected">
          <span className="wbi-pq-step__x" />
          <span className="wbi-pq-step__name">Source</span>
        </div>
      </div>
    )
  }
  const sel = effectiveStep(q.source, selected) ?? outline.steps[outline.steps.length - 1]!.name
  const count = outline.steps.length
  return (
    <div
      className="wbi-pq-steps"
      role="listbox"
      tabIndex={0}
      onKeyDown={(e) => {
        if (renaming) return
        const i = outline.steps.findIndex((s) => s.name === sel)
        if (e.key === 'ArrowDown' && i < count - 1) {
          e.preventDefault()
          selectStep(outline.steps[i + 1]!.name)
        } else if (e.key === 'ArrowUp' && i > 0) {
          e.preventDefault()
          selectStep(outline.steps[i - 1]!.name)
        } else if (e.key === 'Delete') void deleteStepAction(sel)
        else if (e.key === 'F2') usePq.setState({ renamingStep: sel })
      }}
    >
      {outline.steps.map((step, i) => {
        const isSel = step.name === sel
        const gear = hasStepSettings(step.formula)
        const desc = readStepDescription(q.source, step.name)
        const rename = () => usePq.setState({ renamingStep: step.name })
        return (
          <div
            key={step.name}
            role="option"
            aria-selected={isSel}
            className={cx('wbi-pq-step', isSel && 'is-selected')}
            title={desc || undefined}
            onClick={() => selectStep(step.name)}
            onDoubleClick={rename}
            onContextMenu={(e) => {
              selectStep(step.name)
              showContextMenu(e, stepMenu(step.name, step.formula, i, count, rename))
            }}
          >
            <button
              type="button"
              className="wbi-pq-step__x"
              aria-label={`Delete ${step.name}`}
              title="Delete step"
              onClick={(e) => {
                e.stopPropagation()
                void deleteStepAction(step.name)
              }}
            >
              <DismissRegular fontSize={12} />
            </button>
            {renaming === step.name ? (
              <StepRename
                value={step.name}
                onDone={(v) => {
                  usePq.setState({ renamingStep: null })
                  if (v !== null) renameStepAction(step.name, v)
                }}
              />
            ) : (
              <span className="wbi-pq-step__name">{step.name}</span>
            )}
            {errorStep === step.name && <WarningFilled fontSize={14} className="wbi-pq-step__warn" />}
            {gear && (
              <button
                type="button"
                className="wbi-pq-step__gear"
                aria-label={`${step.name} settings`}
                title="Edit settings"
                onClick={(e) => {
                  e.stopPropagation()
                  editStepSettings(step.name, step.formula)
                }}
              >
                <SettingsRegular fontSize={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SettingsPane() {
  const q = useSelectedQuery()
  const setView = usePq((s) => s.setView)
  return (
    <aside className="wbi-pq-settings">
      <div className="wbi-pq-pane-head">
        <span className="wbi-pq-pane-title">Query Settings</span>
        <button type="button" className="wbi-pq-pane-toggle" aria-label="Close Query Settings" title="Close" onClick={() => setView({ settingsOpen: false })}>
          <DismissRegular fontSize={14} />
        </button>
      </div>
      <div className="wbi-pq-settings__body">
        <div className="wbi-pq-section">PROPERTIES</div>
        <label className="wbi-pq-label">Name</label>
        <NameField />
        <button type="button" className="wbi-pq-link" disabled={!q} onClick={() => q && openPqDialog({ id: 'properties', queryId: q.id })}>
          All Properties
        </button>
        <div className="wbi-pq-section">APPLIED STEPS</div>
        <AppliedSteps />
      </div>
    </aside>
  )
}

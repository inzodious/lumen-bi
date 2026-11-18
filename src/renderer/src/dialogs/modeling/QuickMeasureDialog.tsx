/** Quick measures dialog: pick a calculation, drop fields into its wells, preview the generated DAX. */
import { useMemo, useState } from 'react'
import { Button, Dropdown, Modal, TextField } from '../../app/ui'
import { useApp } from '../../state/store'
import { DaxEditor } from '../../editors/dax/DaxEditor'
import { QUICK_MEASURES, missingSlots, type QuickAgg, type QuickField } from './logic/quickMeasures'
import { FieldPicker } from './FieldPicker'
import { targetTable } from './context'
import { takenFieldNames, uniqueName } from './logic/modelOps'
import { requestFormulaBarFocus } from '../../editors/formulaBarState'
import './modeling.css'

const AGGS: Array<{ value: QuickAgg; label: string }> = [
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'count', label: 'Count (Not blank)' },
  { value: 'distinctCount', label: 'Count (Distinct)' }
]

export function QuickMeasureDialog({ onClose }: { onClose(): void }) {
  const model = useApp((s) => s.project?.model)
  const [templateId, setTemplateId] = useState(QUICK_MEASURES[0].id)
  const template = QUICK_MEASURES.find((t) => t.id === templateId)!
  const [fields, setFields] = useState<Record<string, QuickField | undefined>>({})
  const [params, setParams] = useState<Record<string, string>>({})
  const [nameOverride, setNameOverride] = useState<string | null>(null)
  const effParams = useMemo(() => Object.fromEntries((template.params ?? []).map((p) => [p.id, params[p.id] ?? p.default])), [template, params])
  const missing = missingSlots(template, fields)
  const dax = useMemo(() => (missing.length ? '' : template.build(fields as Record<string, QuickField>, effParams)), [template, fields, effParams, missing.length])
  const autoName = template.name(fields, effParams)
  const name = nameOverride ?? autoName
  if (!model) return null

  const add = () => {
    if (missing.length || !name.trim()) return
    const base = fields[template.slots[0].id]
    const home = targetTable() ?? base?.table
    if (!home) return
    const finalName = uniqueName(name.trim(), takenFieldNames(model, home))
    useApp.getState().mutateModel('New quick measure', (m) =>
      m.tables.find((t) => t.name === home)?.measures.push({
        name: finalName,
        expression: dax,
        lineageTag: crypto.randomUUID(),
        ...(template.formatString ? { formatString: template.formatString } : {}),
        annotations: { PBI_QuickMeasureId: template.id }
      })
    )
    useApp.getState().selectField({ kind: 'measure', table: home, name: finalName })
    requestFormulaBarFocus()
    onClose()
  }

  return (
    <Modal
      title="Quick measures"
      subtitle="Create calculations based on templates. The generated DAX appears in the formula bar where you can edit it."
      onClose={onClose}
      width={860}
      footer={
        <>
          <Button variant="primary" disabled={missing.length > 0 || !name.trim()} onClick={add}>
            Add
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-qm">
        <div className="wbi-qm__left">
          <Dropdown
            label="Calculation"
            value={templateId}
            options={QUICK_MEASURES.map((t) => ({ value: t.id, label: t.label, group: t.group }))}
            onChange={(v) => {
              setTemplateId(v)
              setNameOverride(null)
            }}
          />
          <div className="wbi-qm__desc">{template.description}</div>
          {template.slots.map((slot) => {
            const f = fields[slot.id]
            return (
              <div key={slot.id} className="wbi-qm__slot">
                <FieldPicker
                  model={model}
                  label={slot.label}
                  placeholder="Add data fields here"
                  measures={slot.accepts === 'value'}
                  filterColumn={(c) => (slot.accepts === 'date' ? c.dataType === 'dateTime' : true)}
                  value={f ? { kind: f.kind, table: f.table, name: f.name } : undefined}
                  onChange={(v) => {
                    const col = model.tables.find((t) => t.name === v.table)?.columns.find((c) => c.name === v.name)
                    const numeric = !!col && (col.dataType === 'int64' || col.dataType === 'double' || col.dataType === 'decimal')
                    setFields({ ...fields, [slot.id]: v.kind === 'measure' ? { kind: 'measure', table: v.table, name: v.name } : { kind: 'column', table: v.table, name: v.name, agg: slot.accepts === 'value' ? (numeric ? 'sum' : 'count') : undefined } })
                    setNameOverride(null)
                  }}
                />
                {f?.kind === 'column' && slot.accepts === 'value' && (
                  <Dropdown size="small" value={f.agg ?? 'sum'} options={AGGS} onChange={(agg) => setFields({ ...fields, [slot.id]: { ...f, agg } })} />
                )}
              </div>
            )
          })}
          {(template.params ?? []).map((p) =>
            p.kind === 'choice' ? (
              <Dropdown key={p.id} label={p.label} value={effParams[p.id]} options={p.choices ?? []} onChange={(v) => setParams({ ...params, [p.id]: v })} />
            ) : (
              <TextField key={p.id} label={p.label} type={p.kind === 'number' ? 'number' : 'text'} value={effParams[p.id] ?? ''} onChange={(v) => setParams({ ...params, [p.id]: v })} />
            )
          )}
        </div>
        <div className="wbi-qm__right">
          <TextField label="Name" value={name} onChange={setNameOverride} />
          <div className="wbi-field__label" style={{ marginTop: 12 }}>
            Formula
          </div>
          <div className="wbi-qm__preview">
            {dax ? <DaxEditor value={dax} readOnly lineNumbers noLocalLint /> : <div className="wbi-qm__empty">Add fields to {missing.join(', ')} to see the formula.</div>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

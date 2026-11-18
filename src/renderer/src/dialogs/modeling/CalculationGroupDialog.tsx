/** Calculation group editor: name, precedence, column name, items (expression + format string expression). */
import { useMemo, useState } from 'react'
import { AddRegular, ArrowDownRegular, ArrowUpRegular, DeleteRegular } from '@fluentui/react-icons'
import { Button, Modal, NumberField, TextField, Toggle, cx } from '../../app/ui'
import { useApp } from '../../state/store'
import type { CalculationItemDef } from '@core/model/types'
import { DaxEditor } from '../../editors/dax/DaxEditor'
import { schemaFromModel } from '../../editors/dax/schema'
import { nameError, renameColumn, renameTable, uniqueName } from './logic/modelOps'
import { renameReportReferences } from './fieldEdits'
import './modeling.css'
import { cloneDeep } from '@core/clone'

export function CalculationGroupDialog({ onClose, table }: { onClose(): void; table: string }) {
  const model = useApp((s) => s.project?.model)
  const t = model?.tables.find((x) => x.name === table)
  const cg = t?.calculationGroup
  const [name, setName] = useState(table)
  const nameCol = t?.columns.find((c) => c.dataType === 'string' && !c.isHidden) ?? t?.columns[0]
  const [colName, setColName] = useState(nameCol?.name ?? 'Name')
  const [precedence, setPrecedence] = useState<number>(cg?.precedence ?? 0)
  const [items, setItems] = useState<CalculationItemDef[]>(() => cloneDeep(cg?.items ?? []).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)))
  const [idx, setIdx] = useState(0)
  const [noSel, setNoSel] = useState(cg?.noSelectionExpression ?? '')
  const schema = useMemo(() => schemaFromModel(model), [model])
  if (!model || !t || !cg) return null
  const item = items[idx]
  const nErr = name === table ? null : nameError(model, 'table', name)
  const dupItem = items.find((it, i) => items.findIndex((x) => x.name.toLowerCase() === it.name.toLowerCase()) !== i)
  const error = nErr ?? (dupItem ? `The calculation item name '${dupItem.name}' is used more than once.` : items.some((i) => !i.name.trim()) ? 'Calculation item names cannot be empty.' : null)
  const setItem = (patch: Partial<CalculationItemDef>) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const move = (d: number) => {
    const j = idx + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setItems(next)
    setIdx(j)
  }
  const save = () => {
    if (error) return
    useApp.getState().mutateModel('Edit calculation group', (m) => {
      if (name !== table) renameTable(m, table, name)
      const tt = m.tables.find((x) => x.name === name)
      if (!tt?.calculationGroup) return
      if (nameCol && colName !== nameCol.name) renameColumn(m, name, nameCol.name, colName)
      tt.calculationGroup.precedence = precedence
      tt.calculationGroup.items = items.map((it, i) => ({ ...it, ordinal: i, ...(it.formatStringDefinition?.expression.trim() ? {} : { formatStringDefinition: undefined }) }))
      for (const it of tt.calculationGroup.items) if (!it.formatStringDefinition) delete it.formatStringDefinition
      if (noSel.trim()) tt.calculationGroup.noSelectionExpression = noSel
      else delete tt.calculationGroup.noSelectionExpression
    })
    renameReportReferences({ kind: 'table', table }, name)
    if (nameCol && colName !== nameCol.name) renameReportReferences({ kind: 'column', table: name, name: nameCol.name }, colName)
    useApp.getState().selectField({ kind: 'table', table: name })
    onClose()
  }
  const precedenceTaken = model.tables.some((x) => x !== t && x.calculationGroup && (x.calculationGroup.precedence ?? 0) === precedence)
  return (
    <Modal
      title="Calculation group"
      subtitle="Calculation items apply to any measure in a visual filtered by this group (SELECTEDMEASURE())."
      onClose={onClose}
      width={980}
      height={640}
      footer={
        <>
          <Button variant="primary" disabled={!!error} onClick={save}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-cg">
        <div className="wbi-cg__left">
          <TextField label="Name" value={name} onChange={setName} error={nErr ?? undefined} />
          <TextField label="Column name" value={colName} onChange={setColName} />
          <NumberField label="Precedence" value={precedence} onChange={(v) => setPrecedence(v ?? 0)} min={0} step={1} />
          {precedenceTaken && <div className="wbi-form__warning">Another calculation group already uses this precedence.</div>}
          <div className="wbi-roles__title" style={{ marginTop: 8 }}>
            Calculation items
            <span className="wbi-roles__tools">
              <button
                type="button"
                className="wbi-iconbtn"
                aria-label="New calculation item"
                title="New calculation item"
                onClick={() => {
                  setItems([...items, { name: uniqueName('Calculation item', items.map((i) => i.name)), expression: 'SELECTEDMEASURE()', ordinal: items.length }])
                  setIdx(items.length)
                }}
              >
                <AddRegular />
              </button>
              <button type="button" className="wbi-iconbtn" aria-label="Move up" onClick={() => move(-1)} disabled={idx === 0}>
                <ArrowUpRegular />
              </button>
              <button type="button" className="wbi-iconbtn" aria-label="Move down" onClick={() => move(1)} disabled={idx >= items.length - 1}>
                <ArrowDownRegular />
              </button>
              <button
                type="button"
                className="wbi-iconbtn"
                aria-label="Delete calculation item"
                disabled={!item}
                onClick={() => {
                  setItems(items.filter((_, i) => i !== idx))
                  setIdx(Math.max(0, idx - 1))
                }}
              >
                <DeleteRegular />
              </button>
            </span>
          </div>
          <div className="wbi-roles__list">
            {items.map((it, i) => (
              <button key={i} type="button" className={cx('wbi-roles__item', i === idx && 'is-selected')} onClick={() => setIdx(i)}>
                <span className="wbi-cg__ord">{i}</span> {it.name}
              </button>
            ))}
          </div>
        </div>
        <div className="wbi-cg__right">
          {item ? (
            <>
              <TextField label="Calculation item name" value={item.name} onChange={(v) => setItem({ name: v })} />
              <div className="wbi-field__label">Expression</div>
              <DaxEditor wrap key={`e${idx}`} value={item.expression} onChange={(v) => setItem({ expression: v })} schema={schema} lineNumbers className="wbi-cg__editor" />
              <Toggle
                on={!!item.formatStringDefinition}
                onChange={(on) => setItem({ formatStringDefinition: on ? { expression: item.formatStringDefinition?.expression ?? 'SELECTEDMEASUREFORMATSTRING()' } : undefined })}
                label="Dynamic format string"
              />
              {item.formatStringDefinition && (
                <DaxEditor key={`f${idx}`} value={item.formatStringDefinition.expression} onChange={(v) => setItem({ formatStringDefinition: { expression: v } })} schema={schema} lineNumbers className="wbi-cg__editor wbi-cg__editor--small" />
              )}
            </>
          ) : (
            <div className="wbi-roles__empty">Add a calculation item.</div>
          )}
          <details className="wbi-cg__adv">
            <summary>No selection expression (optional)</summary>
            <DaxEditor value={noSel} onChange={setNoSel} schema={schema} className="wbi-cg__editor wbi-cg__editor--small" placeholder="Expression applied when no calculation item is selected" />
          </details>
        </div>
      </div>
    </Modal>
  )
}

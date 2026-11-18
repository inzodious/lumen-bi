/** Table tools ▸ Mark as date table. */
import { useState } from 'react'
import { CheckmarkCircleRegular, ErrorCircleRegular } from '@fluentui/react-icons'
import { Button, Dropdown, Modal, Toggle } from '../../app/ui'
import { useApp } from '../../state/store'
import { columnValues } from './context'
import { dateTableColumn, markAsDateTable, validateDateColumn } from './logic/modelOps'
import './modeling.css'

export function MarkAsDateTableDialog({ onClose, table }: { onClose(): void; table: string }) {
  const model = useApp((s) => s.project?.model)
  const t = model?.tables.find((x) => x.name === table)
  const current = t ? dateTableColumn(t) : null
  const [on, setOn] = useState(true)
  const dateCols = t?.columns.filter((c) => c.dataType === 'dateTime') ?? []
  const [column, setColumn] = useState<string | undefined>(current ?? dateCols[0]?.name)
  if (!model || !t) return null
  const col = t.columns.find((c) => c.name === column)
  const check = on ? validateDateColumn(col, column ? columnValues(table, column) : undefined) : { ok: true, message: '' }
  const save = () => {
    if (on && !check.ok) return
    useApp.getState().mutateModel(on ? 'Mark as date table' : 'Unmark date table', (m) => {
      const tt = m.tables.find((x) => x.name === table)
      if (tt) markAsDateTable(tt, on ? (column ?? null) : null)
    })
    onClose()
  }
  return (
    <Modal
      title="Mark as date table"
      subtitle="Select a column to be used for the date. The column must be of the data type 'date' and must contain only unique values."
      onClose={onClose}
      onSubmit={save}
      width={520}
      footer={
        <>
          <Button variant="primary" disabled={on && !check.ok} onClick={save}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-form">
        <Toggle on={on} onChange={setOn} label="Mark as a date table" showState />
        <Dropdown<string> label="Choose a date column" value={column} disabled={!on} options={dateCols.map((c) => ({ value: c.name, label: c.name }))} onChange={setColumn} placeholder={dateCols.length ? 'Select a column' : 'This table has no date columns'} />
        {on && column && (
          <div className={check.ok ? 'wbi-form__ok' : 'wbi-form__error'}>
            {check.ok ? <CheckmarkCircleRegular /> : <ErrorCircleRegular />} {check.message}
          </div>
        )}
        {on && (
          <div className="wbi-form__hint">When you mark this as a date table, the built-in date tables (auto date/time) associated with this table are removed and time-intelligence functions use this column.</div>
        )}
      </div>
    </Modal>
  )
}

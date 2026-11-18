/**
 * Enter data ("Create Table"): an editable grid with the `*` row / column to grow it, editable
 * headers, paste from a spreadsheet (tab / newline separated), and the table Name. In the Power
 * Query Editor both Load and Edit create the query (PBI's Load also closes the dialog straight into
 * the report; here the editor stays open and Close & Apply loads it). With `step` the dialog edits an
 * existing Enter data step (Applied Steps gear) in place.
 */
import { useMemo, useState } from 'react'
import { AddRegular } from '@fluentui/react-icons'
import { Button, Modal, TextField, cx } from '../../../app/ui'
import { copyName, queryNameError } from '../logic/draft'
import { enterDataFormula, enterDataQuery, parseEnterData, type EnterDataTable } from '../logic/enterData'
import { setStepFormula } from '../logic/steps'
import { newQuery, updateSelectedSource } from '../actions'
import { closePqDialog } from '../pqDialogs'
import { selectedQuery, usePq } from '../pqStore'
import { stepFormula } from './common'

function emptyTable(): EnterDataTable {
  return { columns: ['Column1'], rows: [['']] }
}

function defaultName(): string {
  const d = usePq.getState().draft
  return d.queries.some((q) => q.name.toLowerCase() === 'table') ? copyName(d, 'Table') : 'Table'
}

export function EnterDataDialog({ step }: { step?: string }) {
  const [table, setTable] = useState<EnterDataTable>(() => (step ? (parseEnterData(stepFormula(step) ?? '') ?? emptyTable()) : emptyTable()))
  const [name, setName] = useState(defaultName)
  const nameErr = step ? null : queryNameError(usePq.getState().draft, name)
  const cols = table.columns.length

  const setCell = (r: number, c: number, v: string) =>
    setTable((t) => {
      const rows = t.rows.map((row) => [...row])
      while (rows.length <= r) rows.push(Array.from({ length: t.columns.length }, () => ''))
      rows[r]![c] = v
      return { ...t, rows }
    })
  const addColumn = () =>
    setTable((t) => {
      let n = t.columns.length + 1
      while (t.columns.includes(`Column${n}`)) n++
      return { columns: [...t.columns, `Column${n}`], rows: t.rows.map((r) => [...r, '']) }
    })
  const addRow = () => setTable((t) => ({ ...t, rows: [...t.rows, Array.from({ length: t.columns.length }, () => '')] }))
  const renameColumn = (i: number, v: string) => setTable((t) => ({ ...t, columns: t.columns.map((c, j) => (j === i ? v : c)) }))

  /** Paste a block of cells (tab / newline separated) at (r, c), growing the table. */
  const paste = (r: number, c: number, text: string): boolean => {
    if (!/[\t\n]/.test(text)) return false
    const block = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    setTable((t) => {
      const width = Math.max(t.columns.length, c + Math.max(...block.map((b) => b.length)))
      const columns = [...t.columns]
      for (let i = columns.length; i < width; i++) columns.push(`Column${i + 1}`)
      const rows = t.rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
      block.forEach((line, i) => {
        while (rows.length <= r + i) rows.push(Array.from({ length: width }, () => ''))
        line.forEach((v, j) => (rows[r + i]![c + j] = v))
      })
      return { columns, rows }
    })
    return true
  }

  const dupes = useMemo(() => {
    const seen = new Set<string>()
    for (const c of table.columns) {
      const k = c.trim().toLowerCase()
      if (!k || seen.has(k)) return true
      seen.add(k)
    }
    return false
  }, [table.columns])
  const valid = !dupes && (step ? true : !nameErr)

  const create = () => {
    if (!valid) return
    const t = { columns: table.columns.map((c) => c.trim()), rows: table.rows }
    if (step) {
      const q = selectedQuery()
      const next = q ? setStepFormula(q.source, step, enterDataFormula(t)) : null
      if (next) updateSelectedSource(next)
    } else newQuery({ name: name.trim(), kind: 'table', source: enterDataQuery(t), loadEnabled: true })
    closePqDialog()
  }

  return (
    <Modal
      title="Create Table"
      onClose={closePqDialog}
      width={760}
      height={540}
      footerLeft={
        !step ? (
          <div className="wbi-row" style={{ gap: 8 }}>
            <span className="wbi-pq-dlg__label" style={{ margin: 0 }}>
              Name:
            </span>
            <TextField size="small" value={name} onChange={setName} error={nameErr ?? undefined} style={{ width: 220 }} />
          </div>
        ) : null
      }
      footer={
        step ? (
          <>
            <Button variant="primary" disabled={!valid} onClick={create}>
              OK
            </Button>
            <Button onClick={closePqDialog}>Cancel</Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={!valid} onClick={create}>
              Load
            </Button>
            <Button disabled={!valid} onClick={create}>
              Edit
            </Button>
            <Button onClick={closePqDialog}>Cancel</Button>
          </>
        )
      }
    >
      <div className="wbi-pq-dlg__enter">
        <table className="wbi-pq-dlg__entergrid">
          <thead>
            <tr>
              <th className="wbi-pq-dlg__rownum" />
              {table.columns.map((c, i) => (
                <th key={i}>
                  <input className={cx(table.columns.filter((x) => x.trim().toLowerCase() === c.trim().toLowerCase()).length > 1 && 'is-invalid')} value={c} onChange={(e) => renameColumn(i, e.target.value)} aria-label={`Column ${i + 1} name`} />
                </th>
              ))}
              <th className="wbi-pq-dlg__addcol">
                <button type="button" title="Insert column" onClick={addColumn}>
                  <AddRegular fontSize={14} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                <td className="wbi-pq-dlg__rownum">{r + 1}</td>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c}>
                    <input
                      value={row[c] ?? ''}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onPaste={(e) => {
                        if (paste(r, c, e.clipboardData.getData('text/plain'))) e.preventDefault()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && r === table.rows.length - 1) addRow()
                      }}
                    />
                  </td>
                ))}
                <td />
              </tr>
            ))}
            <tr className="wbi-pq-dlg__addrow" onClick={addRow} title="Insert row">
              <td className="wbi-pq-dlg__rownum">*</td>
              {Array.from({ length: cols + 1 }, (_, c) => (
                <td key={c} />
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {dupes && <div className="wbi-dlg-error" style={{ marginTop: 8 }}>Column names must be unique and not empty.</div>}
    </Modal>
  )
}

/** Home ▸ Enter data ("Create table"): type or paste a small table; saved as PBI's compressed-JSON M partition. */
import { useRef, useState } from 'react'
import { AddRegular } from '@fluentui/react-icons'
import { Button, Modal, TextField } from '../../app/ui'
import { useApp } from '../../state/store'
import { buildEnterDataTable, isEnterDataPartition, parseEnterDataM, resolveTypes, type EnterDataType } from './logic/enterData'
import { nameError, uniqueName } from './logic/modelOps'
import './modeling.css'

const TYPE_LABEL: Record<EnterDataType, string> = { text: 'ABC', int64: '123', number: '1.2', date: '📅', datetime: '📅', logical: '✓✗' }

export function EnterDataDialog({ onClose, editTable }: { onClose(): void; editTable?: string }) {
  const model = useApp((s) => s.project?.model)
  const existing = editTable ? model?.tables.find((t) => t.name === editTable) : undefined
  const parsed = existing && isEnterDataPartition(existing.partitions[0]) ? parseEnterDataM(existing.partitions[0].expression!) : null
  const [name, setName] = useState(() => existing?.name ?? uniqueName('Table', model?.tables.map((t) => t.name) ?? []))
  const [cols, setCols] = useState<string[]>(() => parsed?.columns.map((c) => c.name) ?? ['Column1'])
  const [rows, setRows] = useState<string[][]>(() => {
    const r = parsed?.rows.map((row) => row.map((c) => c ?? '')) ?? []
    return [...r, Array(Math.max(1, parsed?.columns.length ?? 1)).fill('')]
  })
  const gridRef = useRef<HTMLDivElement>(null)
  if (!model) return null
  const nErr = existing && name === existing.name ? null : nameError(model, 'table', name)
  const dupCol = cols.find((c, i) => cols.findIndex((x) => x.toLowerCase() === c.toLowerCase()) !== i)
  const emptyCol = cols.some((c) => !c.trim())
  const error = nErr ?? (dupCol ? `The column name '${dupCol}' is used more than once.` : emptyCol ? 'Column names cannot be empty.' : null)
  const dataRows = rows.filter((r) => r.some((c) => c !== ''))
  const types = resolveTypes(cols.map((c) => ({ name: c })), dataRows)

  const setCell = (r: number, c: number, v: string) => {
    const next = rows.map((row) => [...row])
    next[r][c] = v
    if (r === rows.length - 1 && v !== '') next.push(Array(cols.length).fill(''))
    setRows(next)
  }
  const addColumn = () => {
    setCols([...cols, uniqueName(`Column${cols.length + 1}`, cols)])
    setRows(rows.map((r) => [...r, '']))
  }
  const paste = (e: React.ClipboardEvent, r0: number, c0: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    e.preventDefault()
    const grid = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    const width = Math.max(cols.length, c0 + Math.max(...grid.map((g) => g.length)))
    const nextCols = [...cols]
    while (nextCols.length < width) nextCols.push(uniqueName(`Column${nextCols.length + 1}`, nextCols))
    const next = rows.map((row) => [...row, ...Array(width - row.length).fill('')])
    grid.forEach((line, i) => {
      const r = r0 + i
      while (next.length <= r) next.push(Array(width).fill(''))
      line.forEach((v, j) => (next[r][c0 + j] = v))
    })
    if (next[next.length - 1].some((c) => c !== '')) next.push(Array(width).fill(''))
    setCols(nextCols)
    setRows(next)
  }
  const load = () => {
    if (error) return
    const { table, data } = buildEnterDataTable(name.trim(), cols.map((c) => ({ name: c.trim() })), dataRows, existing?.lineageTag)
    const state = useApp.getState()
    const project = state.project
    if (!project) return
    if (existing) {
      // keep properties of columns that still exist
      table.columns = table.columns.map((c) => {
        const prev = existing.columns.find((x) => x.name === c.name)
        return prev ? { ...prev, dataType: c.dataType, sourceColumn: c.sourceColumn } : c
      })
      table.measures = existing.measures
      table.hierarchies = existing.hierarchies
      project.data.tables.delete(existing.name)
    }
    project.data.tables.set(table.name, data)
    project.data.status.set(table.name, { state: 'loaded', source: 'import', at: new Date().toISOString(), rowCount: data.rowCount })
    state.mutateModel(existing ? `Edit table ${table.name}` : `Enter data ${table.name}`, (m) => {
      if (existing) {
        const i = m.tables.findIndex((t) => t.name === existing.name)
        if (i >= 0) m.tables[i] = table
      } else m.tables.push(table)
    })
    state.selectField({ kind: 'table', table: table.name })
    onClose()
  }
  const move = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const target = e.key === 'Enter' || e.key === 'ArrowDown' ? [r + 1, c] : e.key === 'ArrowUp' ? [r - 1, c] : null
    if (!target) return
    e.preventDefault()
    const el = gridRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${target[0]}:${target[1]}"]`)
    el?.focus()
  }
  return (
    <Modal
      title="Create table"
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button variant="primary" disabled={!!error} onClick={load}>
            Load
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-enter">
        <div className="wbi-enter__grid" ref={gridRef}>
          <table>
            <thead>
              <tr>
                <th className="wbi-enter__rownum" />
                {cols.map((c, i) => (
                  <th key={i}>
                    <span className="wbi-enter__type" title={types[i]}>
                      {TYPE_LABEL[types[i]]}
                    </span>
                    <input value={c} aria-label={`Column ${i + 1} name`} onChange={(e) => setCols(cols.map((x, j) => (j === i ? e.target.value : x)))} />
                  </th>
                ))}
                <th className="wbi-enter__add">
                  <button type="button" className="wbi-iconbtn" onClick={addColumn} title="Insert column" aria-label="Insert column">
                    <AddRegular />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <td className="wbi-enter__rownum">{r === rows.length - 1 ? '*' : r + 1}</td>
                  {cols.map((_, c) => (
                    <td key={c}>
                      <input data-cell={`${r}:${c}`} value={row[c] ?? ''} onChange={(e) => setCell(r, c, e.target.value)} onPaste={(e) => paste(e, r, c)} onKeyDown={(e) => move(e, r, c)} aria-label={`Row ${r + 1} ${cols[c]}`} />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TextField label="Name" value={name} onChange={setName} />
        {error && <div className="wbi-form__error">{error}</div>}
        <div className="wbi-form__hint">Paste data from a spreadsheet (Ctrl+V) or type it. Column types are detected automatically, like Power BI's "Changed Type" step.</div>
      </div>
    </Modal>
  )
}

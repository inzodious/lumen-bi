/**
 * PBI "Create Table" (Enter data): editable grid with "+" row/column adders, editable headers,
 * multi-line paste (TSV from Excel), and a Name field. Load creates a table whose M partition embeds
 * the rows exactly like Power BI Desktop (deflated JSON in Binary.FromText).
 */
import { useState } from 'react'
import { Button, Modal, TextField } from '../../app/ui'
import { useApp } from '../../state/store'
import { enterDataM } from './mcode'
import { loadImportedTables, uniqueTableName } from './loadTables'
import { typeStringTable } from './parsers'
import { mColumns } from './readers'

export function EnterDataDialog({ onClose }: { onClose(): void }) {
  const model = useApp((s) => s.project?.model)
  const [name, setName] = useState(() => (model ? uniqueTableName(model, 'Table') : 'Table'))
  const [headers, setHeaders] = useState<string[]>(['Column1'])
  const [rows, setRows] = useState<string[][]>([['']])

  const setCell = (r: number, c: number, v: string) => setRows((rs) => rs.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)))
  const addCol = () => {
    setHeaders((h) => [...h, `Column${h.length + 1}`])
    setRows((rs) => rs.map((r) => [...r, '']))
  }
  const addRow = () => setRows((rs) => [...rs, headers.map(() => '')])

  /** Paste a block of TSV starting at (r, c), growing the grid as needed. */
  const paste = (e: React.ClipboardEvent, r: number, c: number, header: boolean) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    e.preventDefault()
    const block = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    const width = Math.max(...block.map((b) => b.length))
    const needCols = c + width
    let hs = [...headers]
    while (hs.length < needCols) hs.push(`Column${hs.length + 1}`)
    let body = rows.map((row) => [...row, ...Array(hs.length - row.length).fill('')])
    let startRow = r
    let data = block
    if (header) {
      hs = hs.map((h, i) => (i >= c && i < c + width ? block[0][i - c] || h : h))
      data = block.slice(1)
      startRow = 0
    }
    while (body.length < startRow + data.length) body.push(hs.map(() => ''))
    body = body.map((row, i) => (i >= startRow && i < startRow + data.length ? row.map((x, j) => (j >= c && j < c + width ? (data[i - startRow][j - c] ?? '') : x)) : row))
    setHeaders(hs)
    setRows(body)
  }

  const cleanHeaders = headers.map((h, i) => h.trim() || `Column${i + 1}`)
  const dup = new Set(cleanHeaders.map((h) => h.toLowerCase())).size !== cleanHeaders.length
  const body = rows.filter((r) => r.some((v) => v.trim() !== ''))
  const load = (transform: boolean) => {
    const typed = typeStringTable(cleanHeaders, body)
    const cols = mColumns(typed)
    onClose()
    loadImportedTables([{ name: name.trim() || 'Table', m: enterDataM(cols, body), columns: cols.map((c) => ({ name: c.name, type: c.type })), data: typed }], { transform })
  }

  return (
    <Modal
      title="Create Table"
      onClose={onClose}
      width="min(880px, calc(100vw - 64px))"
      height="min(600px, calc(100vh - 64px))"
      footerLeft={
        <div style={{ width: 280 }}>
          <TextField label="Name" value={name} onChange={setName} />
        </div>
      }
      footer={
        <>
          <Button variant="primary" disabled={dup || !name.trim()} onClick={() => load(false)}>
            Load
          </Button>
          <Button disabled={dup || !name.trim()} onClick={() => load(true)}>
            Edit
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-ed">
        <div className="wbi-ed__gridwrap">
          <table className="wbi-ed__grid">
            <thead>
              <tr>
                <th className="wbi-ed__rownum" />
                {headers.map((h, c) => (
                  <th key={c}>
                    <input aria-label={`Column ${c + 1} name`} value={h} onChange={(e) => setHeaders((hs) => hs.map((x, i) => (i === c ? e.target.value : x)))} onPaste={(e) => paste(e, 0, c, true)} />
                  </th>
                ))}
                <th style={{ minWidth: 32, width: 32 }}>
                  <button type="button" className="wbi-ed__add" aria-label="Add column" title="Insert column" onClick={addCol}>
                    +
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <td className="wbi-ed__rownum">{r + 1}</td>
                  {headers.map((_, c) => (
                    <td key={c}>
                      <input
                        aria-label={`Row ${r + 1}, ${headers[c]}`}
                        value={row[c] ?? ''}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onPaste={(e) => paste(e, r, c, false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && r === rows.length - 1) addRow()
                        }}
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
              <tr>
                <td className="wbi-ed__rownum">
                  <button type="button" className="wbi-ed__add" aria-label="Add row" title="Insert row" onClick={addRow}>
                    +
                  </button>
                </td>
                <td colSpan={headers.length + 1} />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="wbi-dlg-help">
          {dup ? <span className="wbi-dlg-error">Column names must be unique.</span> : 'Type or paste data (for example from Excel). Double-click a header to rename it. Column types are detected when you load.'}
        </div>
      </div>
    </Modal>
  )
}

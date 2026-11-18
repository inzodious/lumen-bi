/** PBI "Export data" dialog for a visual: which data (summarized) + file format (.xlsx / .csv). */
import { useState } from 'react'
import { useDataExport, writeVisualData, EXPORT_ROW_LIMITS } from '../export'
import { Button, Dropdown, Modal, Radio } from '../app/ui'
import { cx } from '../app/ui/cx'

export function ExportDataDialog() {
  const pending = useDataExport((s) => s.pending)
  const set = useDataExport((s) => s.set)
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [busy, setBusy] = useState(false)
  if (!pending) return null
  const { req } = pending
  const rows = req.data?.rows.length ?? 0
  const close = () => set(null)
  const go = async () => {
    setBusy(true)
    const path = await writeVisualData(req, format)
    setBusy(false)
    if (path) close()
  }
  return (
    <Modal
      title="Which data do you want to export?"
      onClose={close}
      width={560}
      onSubmit={() => void go()}
      footer={
        <>
          <Button variant="primary" disabled={busy} onClick={() => void go()}>
            Export
          </Button>
          <Button onClick={close}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col" style={{ gap: 14 }}>
        <div className="wbi-xd__options">
          <div className={cx('wbi-xd__option', 'is-selected')}>
            <Radio checked onChange={() => undefined} />
            <div>
              <div className="wbi-xd__option-title">Summarized data</div>
              <div className="wbi-xd__option-desc">
                Export the data used to create “{req.title || 'this visual'}” — {rows.toLocaleString()} row{rows === 1 ? '' : 's'}, {req.data?.columns.length ?? 0} column{req.data?.columns.length === 1 ? '' : 's'}.
              </div>
            </div>
          </div>
          <div className={cx('wbi-xd__option', 'is-disabled')} title="Not available in this build">
            <Radio checked={false} disabled />
            <div>
              <div className="wbi-xd__option-title">Underlying data</div>
              <div className="wbi-xd__option-desc">Rows of the underlying tables (not available yet).</div>
            </div>
          </div>
        </div>
        <Dropdown
          label="File format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'xlsx', label: `.xlsx (Excel ${EXPORT_ROW_LIMITS.xlsx.toLocaleString()}-row max)` },
            { value: 'csv', label: `.csv (${EXPORT_ROW_LIMITS.csv.toLocaleString()}-row max)` }
          ]}
        />
        <div className="wbi-dlg-help">Applied filters and the visual's sort order are reflected in the exported data.</div>
      </div>
    </Modal>
  )
}

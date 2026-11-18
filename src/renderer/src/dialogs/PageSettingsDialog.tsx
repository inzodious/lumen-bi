/** Page size settings for the active page (Format ▸ Canvas settings presets: 16:9, 4:3, Letter, Tooltip, Custom). */
import { useState } from 'react'
import { useApp } from '../state/store'
import { findPage } from '../report/pbir'
import { Button, Dropdown, Modal, NumberField } from '../app/ui'

export const PAGE_PRESETS = [
  { key: '16:9', label: '16:9', width: 1280, height: 720 },
  { key: '4:3', label: '4:3', width: 960, height: 720 },
  { key: 'letter', label: 'Letter', width: 816, height: 1056 },
  { key: 'tooltip', label: 'Tooltip', width: 320, height: 240 }
] as const

export function presetOf(width: number, height: number): string {
  return PAGE_PRESETS.find((p) => p.width === width && p.height === height)?.key ?? 'custom'
}

export function PageSettingsDialog({ onClose }: { onClose(): void }) {
  const page = useApp((s) => findPage(s.project?.report, s.activePage))
  const mutateReport = useApp((s) => s.mutateReport)
  const [w, setW] = useState<number>(Number(page?.json?.width ?? 1280))
  const [h, setH] = useState<number>(Number(page?.json?.height ?? 720))
  const [display, setDisplay] = useState<string>(page?.json?.displayOption ?? 'FitToPage')
  const preset = presetOf(w, h)
  const apply = () => {
    if (!page) return onClose()
    mutateReport('Page size', (r) => {
      const p = findPage(r, page.name)
      if (!p) return
      p.json.width = w
      p.json.height = h
      p.json.displayOption = display
    })
    onClose()
  }
  return (
    <Modal
      title="Canvas settings"
      onClose={onClose}
      width={460}
      onSubmit={apply}
      footer={
        <>
          <Button variant="primary" disabled={!page} onClick={apply}>
            OK
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col" style={{ gap: 14 }}>
        <Dropdown
          label="Type"
          value={preset}
          onChange={(k) => {
            const p = PAGE_PRESETS.find((x) => x.key === k)
            if (p) {
              setW(p.width)
              setH(p.height)
            }
          }}
          options={[...PAGE_PRESETS.map((p) => ({ value: p.key as string, label: `${p.label} (${p.width} × ${p.height})` })), { value: 'custom', label: 'Custom' }]}
        />
        <div className="wbi-dlg-grid2">
          <NumberField label="Width (px)" value={w} min={160} max={10000} onChange={(v) => v !== undefined && setW(Math.round(v))} />
          <NumberField label="Height (px)" value={h} min={120} max={10000} onChange={(v) => v !== undefined && setH(Math.round(v))} />
        </div>
        <Dropdown
          label="Page view"
          value={display}
          onChange={setDisplay}
          options={[
            { value: 'FitToPage', label: 'Fit to page' },
            { value: 'FitToWidth', label: 'Fit to width' },
            { value: 'ActualSize', label: 'Actual size' }
          ]}
        />
      </div>
    </Modal>
  )
}

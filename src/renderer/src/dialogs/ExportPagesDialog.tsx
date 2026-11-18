/**
 * Report export options (File ▸ Export ▸ PDF / PowerPoint / images / HTML): which pages to export, in report order,
 * plus the format's own options (PNG resolution). Opened by export/openExportDialog.
 *
 * Keyboard: ↑/↓ move between pages, Space toggles the focused page (Shift+Space / Shift+click: range from the last
 * toggled page), Ctrl+A selects every page, Enter exports (when at least one page is selected), Escape cancels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckmarkFilled, EyeOffRegular, SubtractFilled } from '@fluentui/react-icons'
import { Button, Modal, Radio } from '../app/ui'
import { cx } from '../app/ui/cx'
import { useApp } from '../state/store'
import {
  exportPageEntries, exportReport, orderedSelection, quickSelection, rangeSelection, recallSelection, rememberSelection, selectionState, toggleSelection, usePngExportPrefs, useReportExportDialog,
  type ExportPageEntry, type QuickSelection, type ReportExportFormat
} from '../export'

const TITLES: Record<ReportExportFormat, string> = {
  pdf: 'Export to PDF',
  pptx: 'Export to PowerPoint',
  png: 'Export pages as images',
  html: 'Export to HTML'
}

const UNIT: Record<ReportExportFormat, string> = {
  pdf: 'One PDF page per report page, at the report page size.',
  pptx: 'One slide per page after a title slide; applied filters are listed in the slide notes.',
  png: 'One PNG file per page, written into the folder you choose next.',
  html: 'One self-contained web page; its page tabs list exactly the exported pages.'
}

/** Session key for the remembered selection: the opened file when there is one, else the project id. */
export function reportSelectionKey(project: { id: string; source: { path?: string } } | null | undefined): string {
  return project?.source.path || project?.id || ''
}

export function ExportPagesDialog() {
  const format = useReportExportDialog((s) => s.format)
  if (!format) return null
  return <ExportPagesBody key={format} format={format} />
}

function ExportPagesBody({ format }: { format: ReportExportFormat }) {
  const project = useApp((s) => s.project)
  const activePage = useApp((s) => s.activePage)
  const pages = useMemo(() => exportPageEntries(project?.report), [project?.report])
  const key = reportSelectionKey(project)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(recallSelection(key, pages)))
  const [focus, setFocus] = useState<string | null>(() => pages[0]?.name ?? null)
  const anchor = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pngRes = usePngExportPrefs((s) => s.resolution)
  const [resolution, setResolution] = useState(pngRes)

  const close = useCallback(() => useReportExportDialog.getState().open(null), [])
  const count = pages.filter((p) => selected.has(p.name)).length
  const all = selectionState(pages, selected)
  const canExport = count > 0

  const go = useCallback(() => {
    if (!canExport) return
    const chosen = orderedSelection(pages, selected)
    rememberSelection(key, pages, chosen)
    if (format === 'png') usePngExportPrefs.getState().set(resolution)
    close()
    void exportReport(format, { pages: chosen, ...(format === 'png' ? { resolution } : {}) })
  }, [canExport, pages, selected, key, format, resolution, close])

  const toggle = (p: ExportPageEntry, shift: boolean) => {
    const on = !selected.has(p.name)
    setSelected((s) => (shift && anchor.current ? rangeSelection(pages, s, anchor.current, p.name, on) : toggleSelection(s, p.name, on)))
    anchor.current = p.name
    setFocus(p.name)
  }
  const quick = (k: QuickSelection) => {
    setSelected(new Set(quickSelection(k, pages, activePage)))
    anchor.current = null
  }
  const focusRow = (name: string) => {
    setFocus(name)
    listRef.current?.querySelector<HTMLElement>(`[data-page="${CSS.escape(name)}"]`)?.focus()
  }

  // Ctrl+A anywhere in the dialog selects every page (capture phase: the canvas' own Ctrl+A must not see it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return
      const modals = document.querySelectorAll('.wbi-modal')
      if (!modals.length || !modals[modals.length - 1].classList.contains('wbi-xp')) return
      e.preventDefault()
      e.stopPropagation()
      setSelected(new Set(pages.map((p) => p.name)))
      anchor.current = null
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pages])
  // rows keep their keys to themselves (the report canvas nudges selected visuals on arrow keys)
  const onRowKey = (e: React.KeyboardEvent, p: ExportPageEntry, i: number) => {
    if (e.key === ' ' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') e.stopPropagation()
    if (e.key === ' ') {
      e.preventDefault()
      toggle(p, e.shiftKey)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = pages[Math.max(0, Math.min(pages.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (n) focusRow(n.name)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const n = e.key === 'Home' ? pages[0] : pages[pages.length - 1]
      if (n) focusRow(n.name)
    }
  }

  const reason = 'Select at least one page to export.'
  return (
    <Modal
      title={TITLES[format]}
      onClose={close}
      width={520}
      onSubmit={go}
      className="wbi-xp"
      footerLeft={!canExport ? <span className="wbi-xp__reason">{reason}</span> : undefined}
      footer={
        <>
          <Button variant="primary" disabled={!canExport} title={canExport ? undefined : reason} onClick={go}>
            Export
          </Button>
          <Button onClick={close}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col wbi-xp__body" style={{ gap: 12 }}>
        <div className="wbi-dlg-help">{UNIT[format]} Pages are exported in report order, hidden pages included when ticked.</div>
        <div className="wbi-xp__quick" role="group" aria-label="Quick selection">
          <span className="wbi-xp__label">Select</span>
          <Button size="small" onClick={() => quick('all')}>All</Button>
          <Button size="small" onClick={() => quick('none')}>None</Button>
          <Button size="small" onClick={() => quick('visible')}>Visible only</Button>
          <Button size="small" disabled={!activePage} onClick={() => quick('current')}>Current page</Button>
        </div>
        <div className="wbi-xp__list" role="group" aria-label="Pages">
          <div className="wbi-xp__head">
            <Box
              checked={all}
              label="Select all"
              onToggle={() => {
                setSelected(new Set(quickSelection(all === true ? 'none' : 'all', pages)))
                anchor.current = null
              }}
            />
            <span className="wbi-xp__count" aria-live="polite">
              {count} of {pages.length} page{pages.length === 1 ? '' : 's'} selected
            </span>
          </div>
          <div className="wbi-xp__rows" ref={listRef}>
            {pages.map((p, i) => {
              const on = selected.has(p.name)
              return (
                <div
                  key={p.name}
                  data-page={p.name}
                  role="checkbox"
                  aria-checked={on}
                  tabIndex={focus === p.name ? 0 : -1}
                  className={cx('wbi-xp__row', on && 'is-on')}
                  onMouseDown={(e) => e.shiftKey && e.preventDefault() /* no text selection on shift-click */}
                  onClick={(e) => {
                    e.currentTarget.focus() // shift-click suppresses the default focus change (mousedown)
                    toggle(p, e.shiftKey)
                  }}
                  onFocus={() => setFocus(p.name)}
                  onKeyDown={(e) => onRowKey(e, p, i)}
                >
                  <span className={cx('wbi-check', on && 'is-checked')} aria-hidden>
                    <span className="wbi-check__box">{on ? <CheckmarkFilled fontSize={12} /> : null}</span>
                  </span>
                  <span className="wbi-xp__name" title={p.displayName}>
                    {p.displayName}
                  </span>
                  {p.kind === 'tooltip' && <span className="wbi-xp__badge">Tooltip</span>}
                  {p.kind === 'drillthrough' && <span className="wbi-xp__badge">Drillthrough</span>}
                  {p.hidden && <EyeOffRegular className="wbi-xp__hidden" fontSize={16} aria-label="Hidden page" title="Hidden page" />}
                </div>
              )
            })}
          </div>
        </div>
        {format === 'png' && (
          <div className="wbi-xp__quick wbi-xp__res" role="radiogroup" aria-label="Resolution">
            <span className="wbi-xp__label">Resolution</span>
            {[1, 2, 3].map((r) => (
              <Radio key={r} checked={resolution === r} onChange={() => setResolution(r)} label={`${r}×${r === 1 ? ' (page size)' : ''}`} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Tri-state checkbox drawn like the shared Checkbox; Space toggles, Enter is left to the dialog (Export). */
function Box({ checked, label, onToggle }: { checked: boolean | 'mixed'; label: string; onToggle(): void }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      className={cx('wbi-check', checked === true && 'is-checked', checked === 'mixed' && 'is-mixed', 'wbi-xp__all')}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onToggle()
        }
      }}
    >
      <span className="wbi-check__box">{checked === true ? <CheckmarkFilled fontSize={12} /> : checked === 'mixed' ? <SubtractFilled fontSize={12} /> : null}</span>
      <span className="wbi-check__label">{label}</span>
    </span>
  )
}

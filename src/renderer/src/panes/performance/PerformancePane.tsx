/**
 * Performance analyzer (PBI Desktop layout): Start recording · Refresh visuals · Stop, then Clear · Export, and the
 * log — one group per user action ("Refreshed visual", "Changed a slicer", …) with a row per visual that expands into
 * DAX query / Visual display / Other and "Copy query". Sortable by name or duration (third click: back to action order).
 *
 * The canvas reports timings through report/perf.ts (`useVisualPerf`, ignored unless recording); how the three
 * categories are measured — and how they differ from PBI's — is documented there.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowClockwiseRegular, ArrowExportRegular, ArrowSortDownRegular, ArrowSortUpRegular, ChevronDownRegular, ChevronRightRegular, DismissCircleRegular, RecordRegular, RecordStopRegular } from '@fluentui/react-icons'
import { toast } from '../../app/ui/Notify'
import { useShell, type PerfEntry } from '../../app/shellState'
import { useApp } from '../../state/store'
import { PaneFrame } from '../PaneFrame'
import { cx } from '../../app/ui'
import { buildRows, nextSort, toExportJson, type PerfSort } from '../../report/perf'
import { copyToClipboard } from '../../visuals/tables/copy'
import './performance.css'

const ms = (n: number | undefined) => Math.round(n ?? 0).toLocaleString()

function ToolButton({ icon, label, title, disabled, onClick }: { icon: ReactNode; label: string; title?: string; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" className="wbi-perf__btn" disabled={disabled} title={title} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function PerformancePane() {
  const recording = useShell((s) => s.perfRecording)
  const setRecording = useShell((s) => s.setPerfRecording)
  const log = useShell((s) => s.perfLog)
  const clear = useShell((s) => s.clearPerf)
  const hasProject = useApp((s) => !!s.project)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [sort, setSort] = useState<PerfSort>(null)
  const rows = useMemo(() => buildRows(log, sort), [log, sort])
  const hasVisuals = useMemo(() => log.some((e) => !e.marker), [log])

  // action order is chronological: keep the newest rows in view (like PBI) unless the user scrolled up
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = listRef.current
    if (el && !sort && stick.current) el.scrollTop = el.scrollHeight
  }, [rows, sort])

  const toggle = (key: string, row?: HTMLElement) => {
    setOpen((s) => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })
    // expanding a row at the bottom of the list: bring its DAX query / Visual display / Other lines into view
    const item = row?.parentElement
    if (item) requestAnimationFrame(() => item.scrollIntoView({ block: 'nearest' }))
  }
  const sortIcon = (by: 'name' | 'duration') => (sort?.by !== by ? null : sort.dir === 'asc' ? <ArrowSortUpRegular fontSize={12} /> : <ArrowSortDownRegular fontSize={12} />)
  const ariaSort = (by: 'name' | 'duration') => (sort?.by !== by ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending')

  return (
    <PaneFrame id="performance" title="Performance analyzer" minWidth={200}>
      <div className="wbi-perf">
        <div className="wbi-perf__toolbar" role="toolbar" aria-label="Performance analyzer">
          <ToolButton icon={<RecordRegular fontSize={16} className={cx(recording && 'wbi-perf__rec')} />} label="Start recording" disabled={!hasProject || recording} onClick={() => setRecording(true)} />
          <ToolButton icon={<ArrowClockwiseRegular fontSize={16} />} label="Refresh visuals" title="Reload every visual on the page and record how long each takes" disabled={!recording} onClick={() => useApp.getState().dataChanged()} />
          <ToolButton icon={<RecordStopRegular fontSize={16} />} label="Stop" disabled={!recording} onClick={() => setRecording(false)} />
          {/* PBI's second row (Clear · Export); a real line break only when the first three fit on one row (performance.css) */}
          <span className="wbi-perf__break" aria-hidden />
          <ToolButton
            icon={<DismissCircleRegular fontSize={16} />}
            label="Clear"
            disabled={!log.length}
            onClick={() => {
              clear()
              setOpen(new Set())
            }}
          />
          <ToolButton icon={<ArrowExportRegular fontSize={16} />} label="Export" title="Save the log as a JSON file (shaped like Power BI's PowerBIPerformanceData.json)" disabled={!hasVisuals} onClick={() => void exportLog(log)} />
        </div>
        <div className="wbi-perf__head" role="row">
          <button type="button" role="columnheader" aria-sort={ariaSort('name')} className={cx('wbi-perf__sort', 'wbi-perf__sort--name', sort?.by === 'name' && 'is-on')} title="Sort by name" onClick={() => setSort(nextSort(sort, 'name'))}>
            <span>Name</span>
            {sortIcon('name')}
          </button>
          <button type="button" role="columnheader" aria-sort={ariaSort('duration')} className={cx('wbi-perf__sort', sort?.by === 'duration' && 'is-on')} title="Sort by duration" onClick={() => setSort(nextSort(sort, 'duration'))}>
            <span>Duration (ms)</span>
            {sortIcon('duration')}
          </button>
        </div>
        <div
          className="wbi-perf__list"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
        >
          {rows.map((row) => {
            if (row.kind === 'action')
              return (
                <div key={row.key} className="wbi-perf__action" data-action={row.label}>
                  <span className="wbi-perf__text">{row.label}</span>
                  <span className="wbi-perf__when">{new Date(row.at).toLocaleTimeString()}</span>
                </div>
              )
            const e = row.entry
            const isOpen = open.has(row.key)
            const hasQuery = !!e.queries?.length || (e.query ?? 0) > 0
            return (
              <div key={row.key} className="wbi-perf__item" data-visual={e.visual}>
                <div className={cx('wbi-perf__row', !sort && 'is-grouped')} role="button" tabIndex={0} aria-expanded={isOpen} onClick={(ev) => toggle(row.key, ev.currentTarget)} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), toggle(row.key, ev.currentTarget))}>
                  <span className="wbi-perf__chev">{isOpen ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />}</span>
                  <span className="wbi-perf__text wbi-perf__name" title={e.title || e.visual}>
                    {e.title || e.visual}
                  </span>
                  <span className="wbi-perf__ms">{ms(e.ms)}</span>
                </div>
                {isOpen && (
                  <div className={cx('wbi-perf__detail', !sort && 'is-grouped')}>
                    {hasQuery && <Part label="DAX query" value={e.query} hint="Time spent in the queries this visual sent to the engine" />}
                    <Part label="Visual display" value={e.render ?? e.ms - (e.query ?? 0)} hint="Time spent rendering this visual's own content" />
                    <Part label="Other" value={e.other} hint="The rest of the time until the page was painted: waiting for the other visuals, layout and painting (shared by all visuals that loaded together)" />
                    {!!e.queries?.length && (
                      <button type="button" className="wbi-perf__copy" title={e.queries.length === 1 ? 'Copy the DAX query this visual ran' : `Copy the ${e.queries.length} DAX queries this visual ran`} onClick={() => void copyQueries(e)}>
                        Copy query
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {!hasVisuals && (
            <div className="wbi-pane__empty">{recording ? 'Recording… Interact with the report, or select Refresh visuals, to see how long each visual takes to load.' : 'Select Start recording, then interact with the report to see how each visual performs.'}</div>
          )}
        </div>
      </div>
    </PaneFrame>
  )
}

function Part({ label, value, hint }: { label: string; value: number | undefined; hint: string }) {
  return (
    <div className="wbi-perf__part" data-part={label} title={hint}>
      <span className="wbi-perf__text">{label}</span>
      <span className="wbi-perf__ms">{ms(value)}</span>
    </div>
  )
}

async function copyQueries(e: PerfEntry): Promise<void> {
  const n = e.queries?.length ?? 0
  const ok = n > 0 && (await copyToClipboard(e.queries!.join('\n\n')))
  if (ok) toast({ kind: 'info', message: `Copied ${n} quer${n === 1 ? 'y' : 'ies'} to the clipboard.` })
  else toast({ kind: 'error', message: "Couldn't copy the query to the clipboard." })
}

async function exportLog(log: PerfEntry[]): Promise<void> {
  try {
    const path = await window.wbi.dialog.saveFile({ title: 'Export performance data', defaultPath: 'PerformanceData.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (!path) return
    await window.wbi.fs.writeFile(path, new TextEncoder().encode(toExportJson(log)))
    toast({ kind: 'success', title: 'Performance data exported', message: path })
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't export the performance data", message: err instanceof Error ? err.message : String(err) })
  }
}

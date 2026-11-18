/**
 * Performance analyzer: Start/Stop recording, Refresh visuals, Clear, and the per-visual timing log.
 * Integration point: the canvas reports render timings with
 *   useShell.getState().logPerf({ visual, title, ms })
 * (ignored unless recording). Timings are wall-clock query + render time measured by the canvas.
 */
import { useMemo, useState } from 'react'
import { ChevronDownRegular, ChevronRightRegular, RecordRegular, RecordStopRegular, ArrowClockwiseRegular, DeleteRegular, ArrowExportRegular } from '@fluentui/react-icons'
import { toast } from '../../app/ui/Notify'
import type { PerfEntry } from '../../app/shellState'
import { useApp } from '../../state/store'
import { useShell } from '../../app/shellState'
import { PaneFrame } from '../PaneFrame'
import { Button, cx } from '../../app/ui'
import '../selection/selection.css'
import './performance.css'

export function PerformancePane() {
  const recording = useShell((s) => s.perfRecording)
  const setRecording = useShell((s) => s.setPerfRecording)
  const log = useShell((s) => s.perfLog)
  const clear = useShell((s) => s.clearPerf)
  const hasProject = useApp((s) => !!s.project)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [sort, setSort] = useState<'time' | 'duration'>('time')
  const rows = useMemo(() => {
    const list = log.map((e, i) => ({ ...e, i }))
    return sort === 'duration' ? list.sort((a, b) => b.ms - a.ms) : list.reverse()
  }, [log, sort])
  const max = Math.max(1, ...log.map((e) => e.ms))

  return (
    <PaneFrame id="performance" title="Performance analyzer">
      <div className="wbi-sel__toolbar">
        <Button size="small" icon={recording ? <RecordStopRegular fontSize={14} /> : <RecordRegular fontSize={14} />} disabled={!hasProject} onClick={() => setRecording(!recording)}>
          {recording ? 'Stop' : 'Start recording'}
        </Button>
        <Button size="small" icon={<ArrowClockwiseRegular fontSize={14} />} disabled={!recording} onClick={() => useApp.getState().dataChanged()}>
          Refresh visuals
        </Button>
        <span className="wbi-sel__spacer" />
        <Button size="small" variant="subtle" icon={<ArrowExportRegular fontSize={14} />} disabled={!log.length} onClick={() => void exportLog(log)} title="Export the log as JSON (like PBI's PowerBIPerformanceData.json)">
          Export
        </Button>
        <Button size="small" variant="subtle" icon={<DeleteRegular fontSize={14} />} disabled={!log.length} onClick={clear}>
          Clear
        </Button>
      </div>
      <div className="wbi-perf__head">
        <span className="wbi-perf__name">Name</span>
        <button type="button" className={cx('wbi-perf__sort', sort === 'duration' && 'is-on')} onClick={() => setSort(sort === 'duration' ? 'time' : 'duration')}>
          Duration (ms) {sort === 'duration' ? '▼' : ''}
        </button>
      </div>
      <div className="wbi-sel__list">
        {!log.length && <div className="wbi-pane__empty">{recording ? 'Interact with the report or select Refresh visuals to record how long each visual takes to load.' : 'Select Start recording, then interact with the report to see how each visual performs.'}</div>}
        {rows.map((e) => (
          <div key={e.i}>
            <div className="wbi-sel__row" onClick={() => setOpen((s) => (s.has(e.i) ? new Set([...s].filter((x) => x !== e.i)) : new Set([...s, e.i])))}>
              <span className="wbi-sel__chev">{open.has(e.i) ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />}</span>
              <span className="wbi-sel__name">{e.title || e.visual}</span>
              <span className="wbi-perf__ms">{Math.round(e.ms).toLocaleString()}</span>
            </div>
            {open.has(e.i) && (
              <div className="wbi-perf__detail">
                <div className="wbi-perf__bar" title={`Query ${Math.round(e.query ?? 0)} ms · Visual display ${Math.round(e.render ?? e.ms)} ms`}>
                  <span className="is-query" style={{ width: `${((e.query ?? 0) / max) * 100}%` }} />
                  <span className="is-render" style={{ width: `${((e.render ?? e.ms - (e.query ?? 0)) / max) * 100}%` }} />
                </div>
                {e.query !== undefined && (
                  <div className="wbi-perf__split">
                    <span>
                      <i className="is-query" /> Query <b>{Math.round(e.query).toLocaleString()}</b>
                    </span>
                    <span>
                      <i className="is-render" /> Visual display <b>{Math.round(e.render ?? 0).toLocaleString()}</b>
                    </span>
                  </div>
                )}
                {!!e.queries?.length && (
                  <button
                    type="button"
                    className="wbi-perf__copy"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      void navigator.clipboard?.writeText(e.queries!.join('\n\n')).catch(() => undefined)
                      toast({ kind: 'info', message: `Copied ${e.queries!.length} quer${e.queries!.length === 1 ? 'y' : 'ies'} to the clipboard.` })
                    }}
                    title="Copies the DAX queries this visual ran"
                  >
                    Copy query
                  </button>
                )}
                <div className="wbi-muted">
                  {new Date(e.at).toLocaleTimeString()}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </PaneFrame>
  )
}

async function exportLog(log: PerfEntry[]): Promise<void> {
  const path = await window.wbi.dialog.saveFile({ title: 'Export performance data', defaultPath: 'PerformanceData.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!path) return
  const json = JSON.stringify({ version: '1.1.0', exportedAt: new Date().toISOString(), events: log.map((e) => ({ visual: e.visual, title: e.title, page: e.page, start: new Date(e.at - e.ms).toISOString(), durationMs: e.ms, queryMs: e.query, displayMs: e.render, queries: e.queries })) }, null, 2)
  await window.wbi.fs.writeFile(path, new TextEncoder().encode(json))
  toast({ kind: 'success', title: 'Performance data exported', message: path })
}

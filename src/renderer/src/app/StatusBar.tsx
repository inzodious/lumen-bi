/**
 * Bottom status bar: "Page X of Y" (report view) / table stats (table view), data status badges
 * (sample data, refresh errors, engine errors), and the zoom control (− slider + percentage, fit).
 */
import { useMemo } from 'react'
import { AddRegular, SubtractRegular, ArrowFitRegular, BeakerRegular, ErrorCircleRegular, CheckmarkCircleRegular } from '@fluentui/react-icons'
import { useApp } from '../state/store'
import { orderedPages } from '../report/pbir'
import { regenerateSampleData, syntheticTables, tablesWithoutData } from './commands'
import { showContextMenu } from './ui/Menu'
import { useShell } from './shellState'
import { Tip } from './ui/Tooltip'
import { APP_NAME } from './brand'

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export function StatusBar() {
  const project = useApp((s) => s.project)
  const view = useApp((s) => s.view)
  const activePage = useApp((s) => s.activePage)
  const editMode = useApp((s) => s.editMode)
  const zoom = useApp((s) => s.zoom)
  const canvasScale = useApp((s) => s.canvasScale)
  const setZoom = useApp((s) => s.setZoom)
  const setPageView = useApp((s) => s.setPageView)
  const engineError = useApp((s) => s.engineError)
  const busy = useApp((s) => s.busy)
  const revision = useApp((s) => s.revision)
  const selectedField = useApp((s) => s.selectedField)
  const openDialog = useShell((s) => s.openDialog)

  const pages = useMemo(() => (project?.report ? orderedPages(project.report).filter((p) => editMode || p.json?.visibility !== 'HiddenInViewMode') : []), [project?.report, editMode])
  const pageIdx = pages.findIndex((p) => p.name === activePage)
  const synthetic = useMemo(() => syntheticTables(project), [project, revision])
  const missing = useMemo(() => (project ? tablesWithoutData(project) : []), [project, revision])
  const errors = useMemo(() => (project ? [...project.data.status].filter(([, s]) => s.state === 'error') : []), [project, revision])

  const scale = zoom ?? canvasScale
  const pct = Math.round(scale * 100)
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > scale + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < scale - 0.001)
    setZoom(next ?? scale)
  }

  let left: string = ''
  if (!project) left = APP_NAME
  else if (view === 'report' && pages.length) left = `Page ${pageIdx + 1} of ${pages.length}`
  else if (view === 'data' && selectedField) {
    const td = project.data.tables.get(selectedField.table)
    left = `Table: ${selectedField.table} (${(td?.rowCount ?? 0).toLocaleString()} rows)`
    if (selectedField.kind === 'column') {
      const col = td?.columns.find((c) => c.name.toLowerCase() === selectedField.name.toLowerCase())
      if (col) left += ` Column: ${selectedField.name} (${new Set(col.values.map((v) => (v instanceof Date ? v.getTime() : v))).size.toLocaleString()} distinct values)`
    }
  } else if (view === 'model') left = `${project.model.tables.length} tables, ${project.model.relationships.length} relationships`

  return (
    <footer className="wbi-statusbar">
      <span className="wbi-statusbar__item">{left}</span>
      {busy && <span className="wbi-statusbar__item wbi-muted">{busy.message}</span>}
      <span className="wbi-statusbar__spacer" />
      {synthetic.length > 0 && (
        <Tip title="Sample data" description={`${synthetic.length} table(s) contain generated sample rows, not data from the source. Click to regenerate them with new random values, or to refresh from the source.`} placement="above">
          <button
            type="button"
            className="wbi-statusbar__badge wbi-statusbar__badge--sample"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              // opens above the status bar, right-aligned with the badge (3 items + separator ≈ 116px tall)
              showContextMenu({ x: Math.max(8, r.right - 250), y: Math.max(8, r.top - 120) }, [
                { label: 'Regenerate sample data', onClick: () => void regenerateSampleData() },
                { label: 'Sample data options…', onClick: () => openDialog({ id: 'options', section: 'dataLoad' }) },
                { separator: true },
                { label: 'Refresh from the source…', onClick: () => openDialog({ id: 'refresh' }) }
              ])
            }}
          >
            <BeakerRegular fontSize={14} /> Sample data
          </button>
        </Tip>
      )}
      {errors.length > 0 && (
        <Tip title="Refresh errors" description={errors.map(([t, s]) => `${t}: ${s.state === 'error' ? s.message : ''}`).join('\n').slice(0, 400)} placement="above">
          <span className="wbi-statusbar__badge wbi-statusbar__badge--error">
            <ErrorCircleRegular fontSize={14} /> {errors.length} table error{errors.length === 1 ? '' : 's'}
          </span>
        </Tip>
      )}
      {engineError && (
        <Tip title="Engine unavailable" description={engineError} placement="above">
          <span className="wbi-statusbar__badge wbi-statusbar__badge--error">
            <ErrorCircleRegular fontSize={14} /> Engine error
          </span>
        </Tip>
      )}
      {project && !synthetic.length && !missing.length && !errors.length && !engineError && project.model.tables.length > 0 && (
        <span className="wbi-statusbar__item wbi-muted">
          <CheckmarkCircleRegular fontSize={14} /> Data loaded
        </span>
      )}
      {project && missing.length > 0 && <span className="wbi-statusbar__item wbi-muted">{missing.length} table(s) without data</span>}
      {view === 'report' && project?.report && (
        <div className="wbi-zoom">
          <button type="button" className="wbi-zoom__btn" aria-label="Zoom out" onClick={() => step(-1)}>
            <SubtractRegular fontSize={14} />
          </button>
          <input type="range" min={10} max={400} value={Math.min(400, Math.max(10, pct))} aria-label="Zoom" onChange={(e) => setZoom(Number(e.target.value) / 100)} />
          <button type="button" className="wbi-zoom__btn" aria-label="Zoom in" onClick={() => step(1)}>
            <AddRegular fontSize={14} />
          </button>
          <span className="wbi-zoom__pct">{pct}%</span>
          <Tip title="Fit to page" placement="above">
            <button
              type="button"
              className="wbi-zoom__btn"
              aria-label="Fit to page"
              onClick={() => {
                setPageView('fitToPage')
                setZoom(null)
              }}
            >
              <ArrowFitRegular fontSize={14} />
            </button>
          </Tip>
        </div>
      )}
    </footer>
  )
}

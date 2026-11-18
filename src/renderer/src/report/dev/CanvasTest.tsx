/**
 * Dev route `#/canvas-test` — loads the in-code canvas fixture into the app store and renders the
 * report view. Uses the real engine when `createEngine` works, otherwise the visuals gallery's mock engine.
 *
 * Query options (after the hash): `?page=overview|details|tooltip|hidden`, `edit=0` (reading view),
 * `select=<fixture key>` (selected visual), `focus=<key>` / `table=<key>`, `spotlight=<key>`,
 * `cross=1` (cross-highlight "Bikes" from the column chart), `tip=1` (report-page tooltip), `menu=1`
 * (context menu), `print=1` (PrintLayout of all pages).
 */
import { useEffect, useState } from 'react'
import { useApp } from '../../state/store'
import { useInteraction } from '../../state/interaction'
import { columnExpr } from '@core/report/sq'
import { createMockEngine } from '../../visuals/gallery/mockEngine'
import { ReportView } from '../ReportView'
import { PrintLayout } from '../PrintLayout'
import { setReady } from '../ReportView'
import { FIXTURE, fixtureProject } from './fixture'

function params(): URLSearchParams {
  const h = typeof location !== 'undefined' ? location.hash : ''
  const q = h.indexOf('?')
  return new URLSearchParams(q >= 0 ? h.slice(q + 1) : '')
}

/** Synthesize a drag of the column chart by (+120, +60) screen px, then select the grouped textbox (two clicks). */
function simulateDrag() {
  const el = document.querySelector(`[data-visual="${FIXTURE.categoryChart}"]`) as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  const ev = (type: string, cx: number, cy: number, target: Element) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 7, button: 0, buttons: 1, isPrimary: true }))
  const page = document.querySelector('.wbi-page')!
  ev('pointerdown', x, y, el)
  for (let i = 1; i <= 6; i++) ev('pointermove', x + i * 20, y + i * 10, page)
  ev('pointerup', x + 120, y + 60, page)
  const tb = document.querySelector('[data-type="textbox"]') as HTMLElement | null
  if (tb) {
    const t = tb.getBoundingClientRect()
    ev('pointerdown', t.left + 5, t.top + 5, tb)
    ev('pointerup', t.left + 5, t.top + 5, page)
    ev('pointerdown', t.left + 5, t.top + 5, tb)
    ev('pointerup', t.left + 5, t.top + 5, page)
  }
}

export function CanvasTest() {
  const [loaded, setLoaded] = useState(false)
  const p = params()
  useEffect(() => {
    const project = fixtureProject()
    const app = useApp.getState()
    app.setProject(project)
    if (!useApp.getState().engine) {
      const engine = createMockEngine(project.model, project.data)
      useApp.setState({ engine, engineError: undefined })
    }
    const key = (k: string | null) => (k ? ((FIXTURE as Record<string, string>)[k] ?? k) : undefined)
    const page = key(p.get('page'))
    if (page) useApp.getState().setActivePage(page)
    useApp.getState().setEditMode(p.get('edit') !== '0')
    const sel = key(p.get('select'))
    if (sel) useApp.getState().selectVisuals([sel])
    const it = useInteraction.getState()
    const focus = key(p.get('focus'))
    if (focus) it.setFocus({ page: useApp.getState().activePage!, visual: focus, mode: 'focus' })
    const table = key(p.get('table'))
    if (table) it.setFocus({ page: useApp.getState().activePage!, visual: table, mode: 'table' })
    const spot = key(p.get('spotlight'))
    if (spot) it.setSpotlight({ page: useApp.getState().activePage!, visual: spot })
    if (p.get('cross') === '1') {
      it.setCrossFilter(FIXTURE.overview, { source: FIXTURE.categoryChart, identities: [{ fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] }] })
    }
    if (p.get('tip') === '1') {
      it.setTooltip({
        page: FIXTURE.overview,
        visual: FIXTURE.categoryChart,
        req: { x: 700, y: 300, items: [{ label: 'Category', value: 'Bikes' }], identity: { fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] } },
        sourceFilters: []
      })
    }
    if (p.get('menu') === '1') {
      it.setContextMenu({ page: FIXTURE.overview, visual: FIXTURE.categoryChart, req: { x: 600, y: 250, identity: { fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] } } })
    }
    setLoaded(true)
    if (p.get('drag') === '1') setTimeout(simulateDrag, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!loaded) return null
  if (p.get('print') === '1') {
    return (
      <div style={{ height: '100vh', overflow: 'auto', background: '#888' }}>
        <PrintLayout onReady={() => setReady(true)} includeHidden />
      </div>
    )
  }
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ReportView />
    </div>
  )
}

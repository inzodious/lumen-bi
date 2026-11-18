/**
 * Model view: diagram of table cards + relationship lines, layout tabs, zoom/fit, mini-map and a
 * Properties pane. Positions come from / are written back to `diagramLayout.json` (PBI format).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AddRegular, ArrowMaximizeRegular, ChevronLeftRegular, ChevronRightRegular, ZoomInRegular, ZoomOutRegular, DismissRegular } from '@fluentui/react-icons'
import type { RelationshipDef, SemanticModel } from '@core/model/types'
import { useApp } from '../../state/store'
import { PropertiesPane, type PropertiesSelection } from '../../dialogs/modeling/PropertiesPane'
import { ViewAsBanner } from '../../dialogs/modeling/RolesDialogs'
import { deleteField, newColumn, newMeasure, openEditRelationship, openMarkAsDateTable, openNewRelationship, setHidden, openManageRelationships } from '../../dialogs/modeling/commands'
import { confirmDialog } from '../../app/ui/Modal'
import { Dropdown, showContextMenu, cx, type MenuItem } from '../../app/ui'
import { DEFAULT_CARD_WIDTH, HEADER_HEIGHT, LAYOUT_FILE, ROW_HEIGHT, addDiagram, diagramTables, readLayout, resolveNodes, serializeLayout, updateLayoutNodes, type DiagramNode } from './layout'
import { bounds, edgeGeometry, fitView, type Rect } from './edges'
import { TableCard, cardRows, rowY, type CardRow } from './TableCard'
import '../../dialogs/modeling/ribbonTabs'
import './model-view.css'

interface ViewState {
  zoom: number
  panX: number
  panY: number
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number; moved: boolean }
  | { kind: 'move'; table: string; sx: number; sy: number; x: number; y: number; moved: boolean }
  | { kind: 'resize'; table: string; sx: number; sy: number; w: number; h: number }
  | { kind: 'link'; table: string; column: string; sx: number; sy: number; active: boolean }
  | { kind: 'minimap' }

const MIN_ZOOM = 0.1
const MAX_ZOOM = 2

export function ModelView() {
  const model = useApp((s) => s.project?.model)
  if (!model) return <div className="wbi-mv__empty">Open a report or semantic model to see its model.</div>
  return <ModelDiagram model={model} />
}

function ModelDiagram({ model }: { model: SemanticModel }) {
  const sel = useApp((s) => s.selectedField)
  const layout = useMemo(() => readLayout(model), [model])
  const diagrams = layout?.diagrams.length ? layout.diagrams.map((d) => d.name) : ['All tables']
  const [diagram, setDiagram] = useState(() => layout?.selectedDiagram && diagrams.includes(layout.selectedDiagram) ? layout.selectedDiagram : diagrams[0])
  const activeDiagram = diagrams.includes(diagram) ? diagram : diagrams[0]
  const isAll = activeDiagram === diagrams[0]
  const baseNodes = useMemo(() => resolveNodes(model, layout, activeDiagram), [model, layout, activeDiagram])
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number; width?: number; height?: number }>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [relSel, setRelSel] = useState<string | null>(null)
  const [hoverRel, setHoverRel] = useState<string | null>(null)
  const [showProps, setShowProps] = useState(true)
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 40, panY: 40 })
  const [linkEnd, setLinkEnd] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const hostRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const fitted = useRef<string | null>(null)

  const tablesByName = useMemo(() => new Map(diagramTables(model).map((t) => [t.name, t])), [model])
  const nodes: DiagramNode[] = useMemo(
    () =>
      baseNodes
        .filter((n) => tablesByName.has(n.nodeIndex))
        .map((n) => {
          const o = overrides[n.nodeIndex]
          return o ? { ...n, location: { x: o.x, y: o.y }, size: { width: o.width ?? n.size.width, height: o.height ?? n.size.height } } : n
        }),
    [baseNodes, overrides, tablesByName]
  )
  const rowsByTable = useMemo(() => new Map([...tablesByName.values()].map((t) => [t.name, cardRows(t)])), [tablesByName])
  const rects = useMemo(() => {
    const m = new Map<string, Rect>()
    for (const n of nodes) {
      const rows = rowsByTable.get(n.nodeIndex) ?? []
      const contentH = HEADER_HEIGHT + Math.max(1, rows.length) * ROW_HEIGHT + 10
      const h = collapsed.has(n.nodeIndex) ? HEADER_HEIGHT : Math.min(n.size.height, contentH)
      m.set(n.nodeIndex, { x: n.location.x, y: n.location.y, width: n.size.width || DEFAULT_CARD_WIDTH, height: h })
    }
    return m
  }, [nodes, rowsByTable, collapsed])

  // measure host
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const fit = useCallback(() => setView(fitView(bounds([...rects.values()]), size.w, size.h, { min: 0.35, max: 1 })), [rects, size])
  useEffect(() => {
    if (fitted.current === activeDiagram || size.w < 50 || size.h < 50) return
    fitted.current = activeDiagram
    fit()
  }, [activeDiagram, fit, size.w])

  // selection
  const selection: PropertiesSelection | null = relSel ? { kind: 'relationship', name: relSel } : sel
  const selectField = (s: Parameters<ReturnType<typeof useApp.getState>['selectField']>[0]) => {
    setRelSel(null)
    useApp.getState().selectField(s)
  }

  // relationships visible in this diagram
  const visibleRels = useMemo(() => model.relationships.filter((r) => rects.has(r.fromTable) && rects.has(r.toTable)), [model.relationships, rects])
  const activeRel = hoverRel ?? relSel
  const highlightedFields = useMemo(() => {
    const m = new Map<string, Set<string>>()
    const add = (t: string, c: string) => m.set(t, new Set([...(m.get(t) ?? []), c]))
    const r = model.relationships.find((x) => x.name === activeRel)
    if (r) {
      add(r.fromTable, r.fromColumn)
      add(r.toTable, r.toColumn)
    }
    return m
  }, [activeRel, model.relationships])
  const selectedTable = sel?.table ?? null
  const relatedTables = useMemo(() => {
    const s = new Set<string>()
    if (!selectedTable) return s
    for (const r of model.relationships) {
      if (r.fromTable === selectedTable) s.add(r.toTable)
      if (r.toTable === selectedTable) s.add(r.fromTable)
    }
    return s
  }, [selectedTable, model.relationships])

  // persistence
  const persist = useCallback(
    (changed: string[], next: Record<string, { x: number; y: number; width?: number; height?: number }>) => {
      const updates = nodes
        .filter((n) => changed.includes(n.nodeIndex))
        .map((n) => {
          const o = next[n.nodeIndex]
          return { ...n, location: { x: o?.x ?? n.location.x, y: o?.y ?? n.location.y }, size: { width: o?.width ?? n.size.width, height: o?.height ?? n.size.height } }
        })
      // first save of an auto-laid-out "All tables": write every node so the layout is stable
      const all = !layout || !layout.diagrams.find((d) => d.name === activeDiagram)?.nodes.length ? nodes.map((n) => updates.find((u) => u.nodeIndex === n.nodeIndex) ?? n) : updates
      const nextLayout = updateLayoutNodes(readLayout(useApp.getState().project!.model), activeDiagram, all)
      useApp.getState().patchModelSidecar(LAYOUT_FILE, serializeLayout(nextLayout))
      setOverrides({})
    },
    [nodes, layout, activeDiagram]
  )

  // mouse handling
  const toWorld = (cx: number, cy: number) => {
    const r = hostRef.current!.getBoundingClientRect()
    return { x: (cx - r.left - view.panX) / view.zoom, y: (cy - r.top - view.panY) / view.zoom }
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      if (d.kind === 'pan') {
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
        setView((v) => ({ ...v, panX: d.panX + dx, panY: d.panY + dy }))
      } else if (d.kind === 'move') {
        const dx = (e.clientX - d.sx) / view.zoom
        const dy = (e.clientY - d.sy) / view.zoom
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
        if (d.moved) setOverrides((o) => ({ ...o, [d.table]: { ...o[d.table], x: Math.round(d.x + dx), y: Math.round(d.y + dy) } }))
      } else if (d.kind === 'resize') {
        const dx = (e.clientX - d.sx) / view.zoom
        const dy = (e.clientY - d.sy) / view.zoom
        const r = rects.get(d.table)!
        setOverrides((o) => ({ ...o, [d.table]: { x: r.x, y: r.y, width: Math.max(140, Math.round(d.w + dx)), height: Math.max(HEADER_HEIGHT + ROW_HEIGHT, Math.round(d.h + dy)) } }))
      } else if (d.kind === 'link') {
        if (!d.active && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 5) d.active = true
        if (d.active) setLinkEnd(toWorld(e.clientX, e.clientY))
      }
    }
    const up = () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.kind === 'move' && d.moved) persist([d.table], overridesRef.current)
      if (d.kind === 'resize') persist([d.table], overridesRef.current)
      if (d.kind === 'pan' && !d.moved) {
        setRelSel(null)
        useApp.getState().selectField(null)
      }
      if (d.kind === 'link') setLinkEnd(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const r = hostRef.current!.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      setView((v) => {
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
        return { zoom, panX: mx - ((mx - v.panX) / v.zoom) * zoom, panY: my - ((my - v.panY) / v.zoom) * zoom }
      })
    } else setView((v) => ({ ...v, panX: v.panX - (e.shiftKey ? e.deltaY : e.deltaX), panY: v.panY - (e.shiftKey ? 0 : e.deltaY) }))
  }
  const zoomBy = (f: number) =>
    setView((v) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * f))
      const mx = size.w / 2
      const my = size.h / 2
      return { zoom, panX: mx - ((mx - v.panX) / v.zoom) * zoom, panY: my - ((my - v.panY) / v.zoom) * zoom }
    })

  // keyboard: Delete removes the selected relationship
  useEffect(() => {
    const key = async (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || !relSel) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, .cm-editor')) return
      const r = await confirmDialog({ title: 'Delete relationship', message: 'Are you sure you want to delete this relationship?', buttons: ['Delete', 'Cancel'] })
      if (r !== 0) return
      useApp.getState().mutateModel('Delete relationship', (m) => {
        m.relationships = m.relationships.filter((x) => x.name !== relSel)
      })
      setRelSel(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [relSel])

  const tableMenu = (e: React.MouseEvent, table: string) => {
    e.preventDefault()
    e.stopPropagation()
    selectField({ kind: 'table', table })
    const t = tablesByName.get(table)
    const items: MenuItem[] = [
      { label: 'New measure', onClick: () => newMeasure(table) },
      { label: 'New column', onClick: () => newColumn(table) },
      { separator: true },
      { label: collapsed.has(table) ? 'Expand' : 'Collapse', onClick: () => toggleCollapse(table) },
      { label: t?.isHidden ? 'Unhide in report view' : 'Hide in report view', onClick: () => setHidden({ kind: 'table', table }, !t?.isHidden) },
      { label: 'Mark as date table', onClick: () => openMarkAsDateTable(table) },
      { label: 'Manage relationships', onClick: openManageRelationships },
      { separator: true },
      ...(!isAll ? [{ label: 'Remove from diagram', onClick: () => removeFromDiagram(table) } as MenuItem] : []),
      { label: 'Delete from model', onClick: () => void deleteField({ kind: 'table', table }) }
    ]
    showContextMenu(e, items)
  }
  const fieldMenu = (e: React.MouseEvent, table: string, row: CardRow) => {
    if (row.kind === 'separator') return
    e.preventDefault()
    e.stopPropagation()
    selectField({ kind: row.kind, table, name: row.name })
    const t = tablesByName.get(table)
    const hidden = row.kind === 'column' ? t?.columns.find((c) => c.name === row.name)?.isHidden : row.kind === 'measure' ? t?.measures.find((m) => m.name === row.name)?.isHidden : t?.hierarchies.find((h) => h.name === row.name)?.isHidden
    showContextMenu(e, [
      { label: hidden ? 'Unhide in report view' : 'Hide in report view', onClick: () => setHidden({ kind: row.kind as 'column', table, name: row.name }, !hidden) },
      { label: 'New measure', onClick: () => newMeasure(table) },
      { label: 'New column', onClick: () => newColumn(table) },
      { separator: true },
      { label: 'Delete from model', onClick: () => void deleteField({ kind: row.kind as 'column', table, name: row.name }) }
    ])
  }
  const relMenu = (e: React.MouseEvent, r: RelationshipDef) => {
    e.preventDefault()
    e.stopPropagation()
    setRelSel(r.name)
    showContextMenu(e, [
      { label: 'Properties', onClick: () => openEditRelationship(r.name) },
      {
        label: r.isActive === false ? 'Make active' : 'Make inactive',
        onClick: () =>
          useApp.getState().mutateModel('Edit relationship', (m) => {
            const x = m.relationships.find((y) => y.name === r.name)
            if (x) x.isActive = x.isActive === false
          })
      },
      {
        label: 'Delete',
        onClick: () =>
          useApp.getState().mutateModel('Delete relationship', (m) => {
            m.relationships = m.relationships.filter((x) => x.name !== r.name)
          })
      }
    ])
  }
  const toggleCollapse = (t: string) => setCollapsed((c) => {
    const n = new Set(c)
    if (n.has(t)) n.delete(t)
    else n.add(t)
    return n
  })
  const removeFromDiagram = (table: string) => {
    const l = readLayout(useApp.getState().project!.model)
    if (!l) return
    const d = l.diagrams.find((x) => x.name === activeDiagram)
    if (!d) return
    d.nodes = d.nodes.filter((n) => n.nodeIndex !== table)
    useApp.getState().patchModelSidecar(LAYOUT_FILE, serializeLayout(l))
  }
  const addToDiagram = (table: string) => {
    const t = tablesByName.get(table)
    if (!t) return
    const b = bounds([...rects.values()])
    const node: DiagramNode = { location: { x: b ? b.x + b.width + 60 : 40, y: b ? b.y : 40 }, nodeIndex: table, nodeLineageTag: t.lineageTag, size: { width: DEFAULT_CARD_WIDTH, height: 300 } }
    useApp.getState().patchModelSidecar(LAYOUT_FILE, serializeLayout(updateLayoutNodes(readLayout(useApp.getState().project!.model), activeDiagram, [node])))
  }
  const newLayout = () => {
    const current = readLayout(model)
    let n = 1
    while (diagrams.includes(`Layout ${n}`)) n++
    const name = `Layout ${n}`
    const base = current ?? updateLayoutNodes(null, 'All tables', nodes)
    useApp.getState().patchModelSidecar(LAYOUT_FILE, serializeLayout(addDiagram(base, name, [])))
    setDiagram(name)
  }

  const linkDrag = drag.current?.kind === 'link' ? drag.current : null
  const linkFrom = linkDrag && linkEnd ? (() => {
    const r = rects.get(linkDrag.table)
    const ry = rowY(rowsByTable.get(linkDrag.table) ?? [], linkDrag.column)
    return r ? { x: r.x + r.width, y: r.y + (ry ?? HEADER_HEIGHT / 2) } : null
  })() : null
  const content = bounds([...rects.values()])

  return (
    <div className="wbi-mv">
      <ViewAsBanner />
      <div className="wbi-mv__main">
        <div className="wbi-mv__canvaswrap">
          <div
            ref={hostRef}
            className={cx('wbi-mv__canvas', linkDrag?.active && 'is-linking')}
            onWheel={onWheel}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX: view.panX, panY: view.panY, moved: false }
            }}
            role="application"
            aria-label="Model diagram"
          >
            <div className="wbi-mv__world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
              <svg className="wbi-mv__edges" width="1" height="1" overflow="visible">
                <defs>
                  <marker id="wbi-mv-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" />
                  </marker>
                </defs>
                {visibleRels.map((r) => {
                  const a = rects.get(r.fromTable)!
                  const b = rects.get(r.toTable)!
                  const ay = collapsed.has(r.fromTable) ? null : rowY(rowsByTable.get(r.fromTable) ?? [], r.fromColumn)
                  const by = collapsed.has(r.toTable) ? null : rowY(rowsByTable.get(r.toTable) ?? [], r.toColumn)
                  const g = edgeGeometry(a, ay === null ? null : a.y + ay, b, by === null ? null : b.y + by)
                  const active = activeRel === r.name
                  const both = r.crossFilteringBehavior === 'bothDirections'
                  // filter flows from the one side (to) to the many side (from): arrow points toward "from"
                  const toward = g.angle + 180
                  return (
                    <g
                      key={r.name}
                      className={cx('wbi-mv-edge', r.isActive === false && 'is-inactive', active && 'is-active')}
                      onMouseEnter={() => setHoverRel(r.name)}
                      onMouseLeave={() => setHoverRel((h) => (h === r.name ? null : h))}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        setRelSel(r.name)
                      }}
                      onDoubleClick={() => openEditRelationship(r.name)}
                      onContextMenu={(e) => relMenu(e, r)}
                    >
                      <path d={g.path} className="wbi-mv-edge__hit" />
                      <path d={g.path} className="wbi-mv-edge__line" />
                      <text x={g.l1.x} y={g.l1.y} className="wbi-mv-edge__card">
                        {r.fromCardinality === 'one' ? '1' : '*'}
                      </text>
                      <text x={g.l2.x} y={g.l2.y} className="wbi-mv-edge__card">
                        {r.toCardinality === 'many' ? '*' : '1'}
                      </text>
                      <g transform={`translate(${g.mid.x},${g.mid.y}) rotate(${toward})`} className="wbi-mv-edge__dir">
                        {both ? (
                          <>
                            <path d="M-11,-5 L-3,0 L-11,5 z" />
                            <path d="M11,-5 L3,0 L11,5 z" />
                          </>
                        ) : (
                          <path d="M-4,-5 L4,0 L-4,5 z" />
                        )}
                      </g>
                    </g>
                  )
                })}
                {linkFrom && linkEnd && <line x1={linkFrom.x} y1={linkFrom.y} x2={linkEnd.x} y2={linkEnd.y} className="wbi-mv-link" />}
              </svg>
              {nodes.map((n) => {
                const t = tablesByName.get(n.nodeIndex)!
                const r = rects.get(n.nodeIndex)!
                return (
                  <TableCard
                    key={n.nodeIndex}
                    table={t}
                    rows={rowsByTable.get(n.nodeIndex) ?? []}
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    collapsed={collapsed.has(n.nodeIndex)}
                    selected={sel?.table === t.name && !relSel}
                    selectedField={sel && sel.table === t.name && sel.kind !== 'table' && !relSel ? { kind: sel.kind, name: sel.name } : null}
                    highlighted={highlightedFields.get(t.name) ?? EMPTY}
                    related={!relSel && relatedTables.has(t.name)}
                    dimmed={false}
                    onHeaderDown={(e) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      selectField({ kind: 'table', table: t.name })
                      drag.current = { kind: 'move', table: t.name, sx: e.clientX, sy: e.clientY, x: r.x, y: r.y, moved: false }
                    }}
                    onFieldDown={(e, row) => {
                      if (e.button !== 0 || row.kind === 'separator') return
                      e.stopPropagation()
                      selectField({ kind: row.kind, table: t.name, name: row.name })
                      if (row.kind === 'column') drag.current = { kind: 'link', table: t.name, column: row.name, sx: e.clientX, sy: e.clientY, active: false }
                    }}
                    onFieldUp={(_e, row) => {
                      const d = drag.current
                      if (d?.kind === 'link' && d.active && row.kind === 'column' && d.table !== t.name) {
                        openNewRelationship({ table1: d.table, column1: d.column, table2: t.name, column2: row.name })
                      }
                    }}
                    onToggleCollapse={() => toggleCollapse(t.name)}
                    onMenu={(e) => tableMenu(e, t.name)}
                    onFieldContext={(e, row) => fieldMenu(e, t.name, row)}
                    onResizeDown={(e) => {
                      e.stopPropagation()
                      drag.current = { kind: 'resize', table: t.name, sx: e.clientX, sy: e.clientY, w: r.width, h: r.height }
                    }}
                  />
                )
              })}
            </div>
            {!nodes.length && <div className="wbi-mv__hint">{isAll ? 'This model has no tables.' : 'This layout is empty. Add tables with the "Add table" box below.'}</div>}
          </div>
          <MiniMap rects={[...rects.values()]} content={content} view={view} size={size} onNavigate={(cx0, cy0) => setView((v) => ({ ...v, panX: size.w / 2 - cx0 * v.zoom, panY: size.h / 2 - cy0 * v.zoom }))} />
          <div className="wbi-mv__zoom">
            <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" title="Zoom out">
              <ZoomOutRegular />
            </button>
            <input type="range" min={MIN_ZOOM * 100} max={MAX_ZOOM * 100} value={Math.round(view.zoom * 100)} onChange={(e) => zoomBy(Number(e.target.value) / 100 / view.zoom)} aria-label="Zoom" />
            <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" title="Zoom in">
              <ZoomInRegular />
            </button>
            <span className="wbi-mv__zoompct">{Math.round(view.zoom * 100)}%</span>
            <button type="button" onClick={fit} aria-label="Fit to screen" title="Fit to screen">
              <ArrowMaximizeRegular />
            </button>
          </div>
        </div>
        {showProps ? (
          <aside className="wbi-mv__props" aria-label="Properties">
            <div className="wbi-mv__propshead">
              <span>Properties</span>
              <button type="button" className="wbi-iconbtn" onClick={() => setShowProps(false)} aria-label="Collapse properties" title="Collapse">
                <ChevronRightRegular />
              </button>
            </div>
            <div className="wbi-mv__propsbody">
              <PropertiesPane selection={selection} />
            </div>
          </aside>
        ) : (
          <button type="button" className="wbi-mv__propsopen" onClick={() => setShowProps(true)} aria-label="Expand properties" title="Properties">
            <ChevronLeftRegular />
            <span>Properties</span>
          </button>
        )}
      </div>
      <div className="wbi-mv__tabs" role="tablist">
        {diagrams.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === activeDiagram} className={cx('wbi-mv__tab', d === activeDiagram && 'is-active')} onClick={() => setDiagram(d)}>
            {d}
            {d !== diagrams[0] && d === activeDiagram && (
              <span
                className="wbi-mv__tabx"
                role="button"
                aria-label={`Delete layout ${d}`}
                onClick={(e) => {
                  e.stopPropagation()
                  const l = readLayout(model)
                  if (!l) return
                  l.diagrams = l.diagrams.filter((x) => x.name !== d)
                  l.diagrams.forEach((x, i) => (x.ordinal = i))
                  useApp.getState().patchModelSidecar(LAYOUT_FILE, serializeLayout(l))
                  setDiagram(diagrams[0])
                }}
              >
                <DismissRegular />
              </span>
            )}
          </button>
        ))}
        <button type="button" className="wbi-mv__tab wbi-mv__tabadd" onClick={newLayout} aria-label="New layout" title="New layout">
          <AddRegular />
        </button>
        {!isAll && (
          <div className="wbi-mv__addtable">
            <Dropdown<string> size="small" value={undefined} placeholder="Add table…" options={[...tablesByName.keys()].filter((n) => !rects.has(n)).map((n) => ({ value: n, label: n }))} onChange={addToDiagram} searchable />
          </div>
        )}
      </div>
    </div>
  )
}

const EMPTY = new Set<string>()

function MiniMap({ rects, content, view, size, onNavigate }: { rects: Rect[]; content: Rect | null; view: ViewState; size: { w: number; h: number }; onNavigate(x: number, y: number): void }) {
  if (!content || rects.length < 2) return null
  const W = 180
  const H = 120
  const vp = { x: -view.panX / view.zoom, y: -view.panY / view.zoom, width: size.w / view.zoom, height: size.h / view.zoom }
  // nothing to navigate when everything is visible
  if (content.x >= vp.x && content.y >= vp.y && content.x + content.width <= vp.x + vp.width && content.y + content.height <= vp.y + vp.height) return null
  const all = bounds([content, vp])!
  const s = Math.min(W / all.width, H / all.height)
  const ox = (W - all.width * s) / 2 - all.x * s
  const oy = (H - all.height * s) / 2 - all.y * s
  const nav = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onNavigate((e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s)
  }
  return (
    <svg
      className="wbi-mv__minimap"
      width={W}
      height={H}
      onMouseDown={(e) => {
        e.stopPropagation()
        nav(e)
      }}
      onMouseMove={(e) => e.buttons === 1 && nav(e)}
      aria-label="Mini map"
    >
      {rects.map((r, i) => (
        <rect key={i} x={ox + r.x * s} y={oy + r.y * s} width={Math.max(2, r.width * s)} height={Math.max(2, r.height * s)} className="wbi-mv__mmcard" />
      ))}
      <rect x={ox + vp.x * s} y={oy + vp.y * s} width={vp.width * s} height={vp.height * s} className="wbi-mv__mmview" />
    </svg>
  )
}

/**
 * Model view: diagram of table cards + relationship lines, layout tabs, zoom/fit, mini-map and a
 * Properties pane. Card positions come from / are written back to `diagramLayout.json` (PBI format).
 *
 * Lumen additions (stored per layout in `diagramLayout.lumen.json`, see @core/io/diagramSidecar):
 *  - editable relationship lines: curved / orthogonal / straight (layout default + per-line override), pinch
 *    points (drag a line to bend it), draggable line ends;
 *  - table groups: labelled, tinted containers behind the cards (move together, rename, recolour, resize, collapse).
 * Every edit goes through `mutateModelSidecars` — one undo step each, no engine rebuild.
 *
 * Routing rule when cards move: a line's ends follow their cards; its pinch points stay where the user put
 * them, unless both of its tables move together (multi-selection or group), in which case they travel along.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AddRegular, ArrowMaximizeRegular, ChevronLeftRegular, ChevronRightRegular, ZoomInRegular, ZoomOutRegular, DismissRegular } from '@fluentui/react-icons'
import type { SemanticModel } from '@core/model/types'
import {
  GROUP_COLORS,
  LUMEN_LAYOUT_FILE,
  isRouteEmpty,
  lumenDiagram,
  parseLumenLayout,
  pruneLumenDiagram,
  removeLumenDiagram,
  resolveLumenDiagram,
  serializeLumenLayout,
  updateLumenDiagram,
  type AnchorSide,
  type GroupBounds,
  type GroupColor,
  type LineStyle,
  type LumenDiagram,
  type RouteDef
} from '@core/io/diagramSidecar'
import { useApp } from '../../state/store'
import { PropertiesPane, type PropertiesSelection } from '../../dialogs/modeling/PropertiesPane'
import { ViewAsBanner } from '../../dialogs/modeling/RolesDialogs'
import { deleteField, newColumn, newMeasure, openEditRelationship, openMarkAsDateTable, openNewRelationship, setHidden, openManageRelationships } from '../../dialogs/modeling/commands'
import { confirmDialog } from '../../app/ui/Modal'
import { Dropdown, showContextMenu, cx, type MenuItem } from '../../app/ui'
import { DEFAULT_CARD_WIDTH, HEADER_HEIGHT, LAYOUT_FILE, ROW_HEIGHT, addDiagram, diagramTables, parseLayout, resolveNodes, serializeLayout, updateLayoutNodes, type DiagramNode } from './layout'
import { bounds, fitView, type Rect } from './edges'
import { TableCard, cardRows, rowY, type CardRow } from './TableCard'
import { EdgeLayer, HandleLayer, type EdgeView } from './EdgeLayer'
import { GroupBox, GROUP_COLOR_LABELS } from './GroupBox'
import { DiagramToolbar, LINE_STYLE_LABELS, LineStyleIcon } from './DiagramToolbar'
import { autoEndToward, buildRoute, edgeDecor, insertWaypoint, moveWaypoint, nearestAnchor, nearestOnRoute, removeWaypoint, resolveEnds, type End, type Pt } from './routing'
import { snapFraction, snapPoint } from './snapping'
import { GROUP_PALETTE, cardsInMarquee, chipRect, fitGroup, membershipAfterDrop, manualBounds, rectFromPoints, resizeGroup, union, type DropGroup, type ResizeHandle } from './groups'
import { DEFAULT_LINE_STYLE, applyFollow, createGroup, effectiveStyle, followMove, groupOf, patchGroup, setLineStyle, setMembership, setRoute, ungroup } from './diagramOps'
import { exportDiagram } from './exportDiagram'
import { useDiagramPrefs } from './diagramPrefs'
import '../../dialogs/modeling/ribbonTabs'
import './model-view.css'

interface ViewState {
  zoom: number
  panX: number
  panY: number
}

type CardOverride = { x: number; y: number; width?: number; height?: number }

type Drag =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number; moved: boolean }
  | { kind: 'marquee'; sx: number; sy: number; x0: number; y0: number; base: string[]; moved: boolean }
  | { kind: 'move'; tables: string[]; start: Record<string, { x: number; y: number }>; sx: number; sy: number; dx: number; dy: number; moved: boolean; group: string | null; single: string | null; frozen: DropGroup[] }
  | { kind: 'resize'; table: string; sx: number; sy: number; x: number; y: number; w: number; h: number; next: CardOverride | null }
  | { kind: 'link'; table: string; column: string; sx: number; sy: number; active: boolean }
  | { kind: 'bend'; rel: string; sx: number; sy: number }
  | { kind: 'waypoint'; rel: string; index: number; base: RouteDef; created: boolean; moved: boolean; sx: number; sy: number; next: RouteDef }
  | { kind: 'anchor'; rel: string; end: 'from' | 'to'; base: RouteDef; moved: boolean; sx: number; sy: number; next: RouteDef }
  | { kind: 'gresize'; id: string; handle: ResizeHandle; start: Rect; fit: Rect; sx: number; sy: number; next: Rect | null }

/** Transient (not yet committed) state of a drag: shown live, written to the document on mouse-up. */
interface Draft {
  routes?: Record<string, RouteDef>
  bounds?: Record<string, GroupBounds>
}

interface GroupView {
  id: string
  name: string
  color: GroupColor
  collapsed: boolean
  /** member tables that are cards of this diagram */
  members: string[]
  /** smallest rectangle around the members (+ padding) */
  fit: Rect
  /** fit ∪ manual bounds */
  expanded: Rect
  /** what is drawn: `expanded`, or the chip when collapsed */
  rect: Rect
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const OPPOSITE: Record<AnchorSide, AnchorSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }

export function ModelView() {
  const model = useApp((s) => s.project?.model)
  if (!model) return <div className="wbi-mv__empty">Open a report or semantic model to see its model.</div>
  return <ModelDiagram model={model} />
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor') || !!document.querySelector('.wbi-modal')
}

function ModelDiagram({ model }: { model: SemanticModel }) {
  const sel = useApp((s) => s.selectedField)
  const layoutText = model.sidecarFiles?.[LAYOUT_FILE]
  const lumenText = model.sidecarFiles?.[LUMEN_LAYOUT_FILE]
  const layout = useMemo(() => parseLayout(layoutText), [layoutText])
  const lumen = useMemo(() => parseLumenLayout(lumenText), [lumenText])
  const diagrams = layout?.diagrams.length ? layout.diagrams.map((d) => d.name) : ['All tables']
  const [diagram, setDiagram] = useState(() => (layout?.selectedDiagram && diagrams.includes(layout.selectedDiagram) ? layout.selectedDiagram : diagrams[0]))
  const activeDiagram = diagrams.includes(diagram) ? diagram : diagrams[0]
  const isAll = activeDiagram === diagrams[0]
  const baseNodes = useMemo(() => resolveNodes(model, layout, activeDiagram), [model, layout, activeDiagram])
  /** this layout's routing + groups as they apply to the model right now (stale references resolved) */
  const stored = useMemo(() => resolveLumenDiagram(lumenDiagram(lumen, activeDiagram), model), [lumen, activeDiagram, model])
  const prefs = useDiagramPrefs()
  /** style of layouts that store none: the user's preferred default, else the built-in one */
  const fallbackStyle: LineStyle = prefs.lineStyle ?? DEFAULT_LINE_STYLE
  const viewStyle: LineStyle = stored.lineStyle ?? fallbackStyle
  const mode = prefs.mode
  const snap = prefs.snap

  const [overrides, setOverrides] = useState<Record<string, CardOverride>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [relSel, setRelSel] = useState<string | null>(null)
  const [wpSel, setWpSel] = useState<{ rel: string; index: number } | null>(null)
  const [hoverRel, setHoverRel] = useState<string | null>(null)
  const [selTables, setSelTables] = useState<string[]>([])
  const [groupSel, setGroupSel] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number } | null>(null)
  /** group changes the dragged cards would get if dropped now (table → group id | null) */
  const [dropPreview, setDropPreview] = useState<Map<string, string | null> | null>(null)
  const [showProps, setShowProps] = useState(true)
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 40, panY: 40 })
  const [linkEnd, setLinkEnd] = useState<Pt | null>(null)
  const [linkTarget, setLinkTarget] = useState<{ table: string; column: string | null } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState<Drag['kind'] | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const fitted = useRef<string | null>(null)
  const spaceDown = useRef(false)

  const tablesByName = useMemo(() => new Map(diagramTables(model).map((t) => [t.name, t])), [model])
  const lineageTags = useMemo(() => new Map(model.tables.map((t) => [t.name, t.lineageTag])), [model.tables])
  const storedNodes = useMemo(() => baseNodes.filter((n) => tablesByName.has(n.nodeIndex)), [baseNodes, tablesByName])
  const nodes: DiagramNode[] = useMemo(
    () =>
      storedNodes.map((n) => {
        const o = overrides[n.nodeIndex]
        return o ? { ...n, location: { x: o.x, y: o.y }, size: { width: o.width ?? n.size.width, height: o.height ?? n.size.height } } : n
      }),
    [storedNodes, overrides]
  )
  const rowsByTable = useMemo(() => new Map([...tablesByName.values()].map((t) => [t.name, cardRows(t)])), [tablesByName])
  /** every card of this diagram (including the ones hidden inside a collapsed group) */
  const cardRects = useMemo(() => {
    const m = new Map<string, Rect>()
    for (const n of nodes) {
      const rows = rowsByTable.get(n.nodeIndex) ?? []
      const contentH = HEADER_HEIGHT + Math.max(1, rows.length) * ROW_HEIGHT + 10
      const h = collapsed.has(n.nodeIndex) ? HEADER_HEIGHT : Math.min(n.size.height, contentH)
      m.set(n.nodeIndex, { x: n.location.x, y: n.location.y, width: n.size.width || DEFAULT_CARD_WIDTH, height: h })
    }
    return m
  }, [nodes, rowsByTable, collapsed])

  // ---------------------------------------------------------------- groups
  const groups: GroupView[] = useMemo(() => {
    const out: GroupView[] = []
    for (const g of stored.groups ?? []) {
      const members = g.tables.map((m) => m.name).filter((n) => cardRects.has(n))
      if (!members.length) continue
      // a dragged member that is about to leave no longer stretches the container
      const staying = members.filter((n) => !dropPreview || !dropPreview.has(n) || dropPreview.get(n) === g.id)
      const fit = fitGroup((staying.length ? staying : members).map((n) => cardRects.get(n)!))!
      const manual = draft?.bounds?.[g.id] ?? g.bounds
      const expanded = manual ? union(fit, manual) : fit
      out.push({ id: g.id, name: g.name, color: g.color ?? 'gray', collapsed: !!g.collapsed, members, fit, expanded, rect: g.collapsed ? chipRect(expanded) : expanded })
    }
    return out
  }, [stored.groups, cardRects, draft?.bounds, dropPreview])
  /** table → the collapsed group hiding it */
  const hiddenIn = useMemo(() => {
    const m = new Map<string, GroupView>()
    for (const g of groups) if (g.collapsed) for (const t of g.members) m.set(t, g)
    return m
  }, [groups])
  /** visible cards only */
  const rects = useMemo(() => new Map([...cardRects].filter(([n]) => !hiddenIn.has(n))), [cardRects, hiddenIn])
  const groupOfTable = useMemo(() => {
    const m = new Map<string, GroupView>()
    for (const g of groups) for (const t of g.members) m.set(t, g)
    return m
  }, [groups])

  // ---------------------------------------------------------------- selection
  const selectedTables = useMemo(() => {
    const multi = selTables.filter((t) => rects.has(t))
    if (multi.length) return multi
    return sel && !relSel && !groupSel && rects.has(sel.table) ? [sel.table] : []
  }, [selTables, rects, sel, relSel, groupSel])
  const selection: PropertiesSelection | null = relSel ? { kind: 'relationship', name: relSel } : groupSel ? null : sel
  const selectField = (s: Parameters<ReturnType<typeof useApp.getState>['selectField']>[0]) => {
    setRelSel(null)
    setWpSel(null)
    setGroupSel(null)
    useApp.getState().selectField(s)
  }
  const clearSelection = () => {
    setSelTables([])
    selectField(null)
  }
  const selectRel = (name: string) => {
    setRelSel(name)
    setGroupSel(null)
    setSelTables([])
  }
  const selectGroup = (id: string) => {
    setGroupSel(id)
    setRelSel(null)
    setWpSel(null)
    setSelTables([])
  }

  // ---------------------------------------------------------------- relationship lines
  const visibleRels = useMemo(() => model.relationships.filter((r) => cardRects.has(r.fromTable) && cardRects.has(r.toTable)), [model.relationships, cardRects])
  const edges: EdgeView[] = useMemo(() => {
    const out: EdgeView[] = []
    for (const r of visibleRels) {
      const ga = hiddenIn.get(r.fromTable)
      const gb = hiddenIn.get(r.toTable)
      // both tables inside the same collapsed group: nothing to draw
      if (ga && ga === gb) continue
      const a = ga ? ga.rect : cardRects.get(r.fromTable)!
      const b = gb ? gb.rect : cardRects.get(r.toTable)!
      const editable = !ga && !gb
      const storedRoute = draft?.routes?.[r.name] ?? stored.routes?.[r.name]
      // lines to a collapsed group's chip are routed automatically (their stored routing returns on expand)
      const route = editable ? storedRoute : storedRoute?.style ? { style: storedRoute.style } : undefined
      const ay = ga || collapsed.has(r.fromTable) ? null : rowY(rowsByTable.get(r.fromTable) ?? [], r.fromColumn)
      const by = gb || collapsed.has(r.toTable) ? null : rowY(rowsByTable.get(r.toTable) ?? [], r.toColumn)
      const ends = resolveEnds(a, ay === null ? null : a.y + ay, b, by === null ? null : b.y + by, route)
      const style = effectiveStyle(stored, route, fallbackStyle)
      const geom = buildRoute(ends.from, ends.to, route?.waypoints ?? [], style)
      out.push({ rel: r, geom, decor: edgeDecor(geom), style, route, editable })
    }
    return out
  }, [visibleRels, hiddenIn, cardRects, draft?.routes, stored, collapsed, rowsByTable, fallbackStyle])
  const edgeByRel = useMemo(() => new Map(edges.map((e) => [e.rel.name, e])), [edges])
  const activeRel = hoverRel ?? relSel
  const highlightedFields = useMemo(() => {
    const m = new Map<string, Set<string>>()
    const add = (t: string, c: string) => m.set(t, new Set([...(m.get(t) ?? []), c]))
    const r = model.relationships.find((x) => x.name === activeRel)
    if (r) {
      add(r.fromTable, r.fromColumn)
      add(r.toTable, r.toColumn)
    }
    if (linkTarget?.column) add(linkTarget.table, linkTarget.column)
    return m
  }, [activeRel, model.relationships, linkTarget])
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

  // ---------------------------------------------------------------- view (zoom / fit)
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  /** everything the diagram shows: cards, group containers / chips, pinch points */
  const content = useMemo(() => {
    const all: Rect[] = [...rects.values(), ...groups.map((g) => g.rect)]
    for (const e of edges) for (const w of e.geom.waypoints) all.push({ x: w.x, y: w.y, width: 0, height: 0 })
    return bounds(all)
  }, [rects, groups, edges])
  const fit = useCallback(() => setView(fitView(content, size.w, size.h, { min: 0.35, max: 1 })), [content, size])
  useEffect(() => {
    if (fitted.current === activeDiagram || size.w < 50 || size.h < 50) return
    fitted.current = activeDiagram
    fit()
  }, [activeDiagram, fit, size.w])

  // ---------------------------------------------------------------- persistence (undoable)
  /**
   * One undoable edit of this layout: card positions/sizes (→ diagramLayout.json) and/or Lumen data
   * (→ diagramLayout.lumen.json; the file disappears again when nothing custom is left). `pin` also stores the
   * positions of an auto-laid-out diagram, so pinch points and group extents keep their place relative to the cards.
   */
  const commit = useCallback(
    (label: string, edit: { cards?: Record<string, CardOverride>; lumen?: (d: LumenDiagram) => void; pin?: boolean }) => {
      useApp.getState().mutateModelSidecars(label, (files) => {
        const current = useApp.getState().project!.model
        const lay = parseLayout(files[LAYOUT_FILE])
        const hasNodes = !!lay?.diagrams.find((d) => d.name === activeDiagram)?.nodes.length
        const changed = storedNodes
          .filter((n) => edit.cards && n.nodeIndex in edit.cards)
          .map((n) => {
            const o = edit.cards![n.nodeIndex]
            return { ...n, location: { x: o.x, y: o.y }, size: { width: o.width ?? n.size.width, height: o.height ?? n.size.height } }
          })
        if (changed.length || (edit.pin && !hasNodes)) {
          // first save of an auto-laid-out diagram: write every node so the layout is stable
          const all = hasNodes ? changed : storedNodes.map((n) => changed.find((u) => u.nodeIndex === n.nodeIndex) ?? n)
          if (all.length) files[LAYOUT_FILE] = serializeLayout(updateLayoutNodes(lay, activeDiagram, all))
        }
        if (edit.lumen) {
          const next = updateLumenDiagram(parseLumenLayout(files[LUMEN_LAYOUT_FILE]), activeDiagram, (d) => {
            pruneLumenDiagram(d, current)
            edit.lumen!(d)
          })
          // entries of layout tabs that no longer exist (removed outside Lumen) go too
          const tabs = parseLayout(files[LAYOUT_FILE])?.diagrams.map((d) => d.name)
          const valid = new Set(tabs?.length ? tabs : ['All tables'])
          valid.add(activeDiagram)
          next.diagrams = next.diagrams.filter((d) => valid.has(d.name))
          const text = serializeLumenLayout(next)
          if (text === null) delete files[LUMEN_LAYOUT_FILE]
          else files[LUMEN_LAYOUT_FILE] = text
        }
      })
      setOverrides({})
      setDraft(null)
    },
    [storedNodes, activeDiagram]
  )
  const editRoute = (label: string, rel: string, route: RouteDef | undefined) => commit(label, { lumen: (d) => setRoute(d, rel, route), pin: true })

  // ---------------------------------------------------------------- group / line commands
  const groupTables = (tables: string[]) => {
    if (!tables.length) return
    let id: string | null = null
    commit('Group tables', {
      lumen: (d) => {
        id = createGroup(d, tables, lineageTags)
      },
      pin: true
    })
    if (id) selectGroup(id)
  }
  /** groups the Ungroup command applies to: the selected container, else the containers of the selected tables */
  const ungroupTargets = groupSel ? [groupSel] : [...new Set(selectedTables.map((t) => groupOfTable.get(t)?.id).filter((x): x is string => !!x))]
  const ungroupSelected = () => {
    if (!ungroupTargets.length) return
    const ids = ungroupTargets
    commit('Ungroup tables', { lumen: (d) => ungroup(d, ids) })
    setGroupSel(null)
  }
  const removeWp = (rel: string, index: number) => {
    const route = stored.routes?.[rel]
    if (!route) return
    editRoute('Remove pinch point', rel, removeWaypoint(route, index))
    setWpSel(null)
  }
  const changeViewStyle = (style: LineStyle) => {
    if (style !== viewStyle) commit('Change line style', { lumen: (d) => setLineStyle(d, style, fallbackStyle) })
  }

  // ---------------------------------------------------------------- mouse handling
  const toWorld = (cx0: number, cy0: number): Pt => {
    const r = hostRef.current!.getBoundingClientRect()
    return { x: (cx0 - r.left - view.panX) / view.zoom, y: (cy0 - r.top - view.panY) / view.zoom }
  }
  const begin = (d: Drag) => {
    drag.current = d
    setDragging(d.kind)
  }
  /** snap candidates for a pinch point of `rel`: every other pinch point, the card centres, this line's ends */
  const snapTargets = (rel: string, index: number): { xs: number[]; ys: number[] } => {
    const xs: number[] = []
    const ys: number[] = []
    for (const e of edges) {
      e.geom.waypoints.forEach((w, i) => {
        if (e.rel.name === rel && i === index) return
        xs.push(w.x)
        ys.push(w.y)
      })
      if (e.rel.name === rel)
        for (const end of [e.geom.from, e.geom.to]) {
          xs.push(end.point.x)
          ys.push(end.point.y)
        }
    }
    for (const r of rects.values()) {
      xs.push(r.x + r.width / 2)
      ys.push(r.y + r.height / 2)
    }
    return { xs, ys }
  }
  /** the column row / card under a screen point (target of a relationship being dragged out) */
  const fieldAt = (x: number, y: number, from: string): { table: string; column: string | null } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const card = el?.closest<HTMLElement>('.wbi-mv-card')
    const table = card?.dataset['table']
    if (!table || table === from) return null
    const field = el?.closest<HTMLElement>('.wbi-mv-field')
    return { table, column: field?.dataset['kind'] === 'column' ? (field.dataset['field'] ?? null) : null }
  }
  /** group changes for cards dragged to (start + dx, dy): only the tables whose group would change */
  const groupChanges = (d: Extract<Drag, { kind: 'move' }>): Map<string, string | null> => {
    if (d.group) return new Map()
    const moved = d.tables.map((t) => ({ table: t, rect: { ...cardRects.get(t)!, x: d.start[t].x + d.dx, y: d.start[t].y + d.dy } }))
    const after = membershipAfterDrop(d.frozen, moved)
    return new Map([...after].filter(([t, g]) => (d.frozen.find((f) => f.tables.includes(t))?.id ?? null) !== g))
  }

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const dxw = (e.clientX - d.sx) / view.zoom
      const dyw = (e.clientY - d.sy) / view.zoom
      const far = Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3
      if (d.kind === 'pan') {
        if (far) d.moved = true
        setView((v) => ({ ...v, panX: d.panX + (e.clientX - d.sx), panY: d.panY + (e.clientY - d.sy) }))
      } else if (d.kind === 'marquee') {
        if (far) d.moved = true
        if (!d.moved) return
        const p = toWorld(e.clientX, e.clientY)
        const box = rectFromPoints(d.x0, d.y0, p.x, p.y)
        setMarquee(box)
        setSelTables([...new Set([...d.base, ...cardsInMarquee(rects, box)])])
      } else if (d.kind === 'move') {
        if (far) d.moved = true
        if (!d.moved) return
        d.dx = Math.round(dxw)
        d.dy = Math.round(dyw)
        setOverrides((o) => {
          const next = { ...o }
          for (const t of d.tables) next[t] = { ...o[t], x: d.start[t].x + d.dx, y: d.start[t].y + d.dy }
          return next
        })
        const follow = followMove(stored, new Set(d.tables), d.dx, d.dy, model.relationships)
        setDraft(Object.keys(follow.routes).length || Object.keys(follow.bounds).length ? follow : null)
        // dragging cards (not a whole group): preview which container they would end up in
        const changes = groupChanges(d)
        setDropPreview((prev) => (sameMap(prev, changes) ? prev : changes.size ? changes : null))
      } else if (d.kind === 'resize') {
        const next: CardOverride = { x: d.x, y: d.y, width: Math.max(140, Math.round(d.w + dxw)), height: Math.max(HEADER_HEIGHT + ROW_HEIGHT, Math.round(d.h + dyw)) }
        d.next = next
        setOverrides((o) => ({ ...o, [d.table]: next }))
      } else if (d.kind === 'link') {
        if (!d.active && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 5) d.active = true
        if (d.active) {
          setLinkEnd(toWorld(e.clientX, e.clientY))
          const t = fieldAt(e.clientX, e.clientY, d.table)
          setLinkTarget((prev) => (prev?.table === t?.table && prev?.column === t?.column ? prev : t))
        }
      } else if (d.kind === 'bend') {
        if (!far) return
        // the line is being dragged: put a pinch point under the cursor (where the drag started) and move that
        const ev = edgeByRel.get(d.rel)
        if (!ev?.editable) return
        const hit = nearestOnRoute(ev.geom, toWorld(d.sx, d.sy))
        const base = insertWaypoint(stored.routes?.[d.rel], hit.seg, { x: hit.x, y: hit.y })
        const index = Math.min(Math.max(0, hit.seg), (base.waypoints?.length ?? 1) - 1)
        drag.current = { kind: 'waypoint', rel: d.rel, index, base, created: true, moved: true, sx: d.sx, sy: d.sy, next: base }
        setDragging('waypoint')
        setWpSel({ rel: d.rel, index })
        move(e)
      } else if (d.kind === 'waypoint') {
        if (far) d.moved = true
        if (!d.moved) return
        const targets = snapTargets(d.rel, d.index)
        const s = snapPoint(toWorld(e.clientX, e.clientY), { enabled: snap && !e.altKey, threshold: 6 / view.zoom, ...targets })
        d.next = moveWaypoint(d.base, d.index, s)
        setDraft({ routes: { [d.rel]: d.next } })
        setGuides(s.guideX !== undefined || s.guideY !== undefined ? { x: s.guideX, y: s.guideY } : null)
      } else if (d.kind === 'anchor') {
        if (far) d.moved = true
        if (!d.moved) return
        const ev = edgeByRel.get(d.rel)
        const table = ev ? (d.end === 'from' ? ev.rel.fromTable : ev.rel.toTable) : ''
        const r = cardRects.get(table)
        if (!ev || !r) return
        const a = nearestAnchor(r, toWorld(e.clientX, e.clientY))
        // snap to the middle of the side and, on the left/right sides, to the joined column's row
        const vertical = a.side === 'left' || a.side === 'right'
        const ry = collapsed.has(table) ? null : rowY(rowsByTable.get(table) ?? [], d.end === 'from' ? ev.rel.fromColumn : ev.rel.toColumn)
        const fractions = [0.5, ...(vertical && ry !== null && ry < r.height ? [ry / r.height] : [])]
        a.t = snapFraction(a.t, vertical ? r.height : r.width, fractions, 7 / view.zoom, snap && !e.altKey)
        d.next = { ...d.base, [d.end]: a }
        setDraft({ routes: { [d.rel]: d.next } })
      } else if (d.kind === 'gresize') {
        const next = resizeGroup(d.start, d.handle, dxw, dyw, d.fit)
        d.next = next
        setDraft({ bounds: { [d.id]: next } })
      }
    }
    const up = (e: MouseEvent) => {
      const d = drag.current
      drag.current = null
      if (!d) return
      setDragging(null)
      if (d.kind === 'pan') {
        if (!d.moved) clearSelection()
      } else if (d.kind === 'marquee') {
        setMarquee(null)
        if (!d.moved) clearSelection()
      } else if (d.kind === 'move') {
        setDropPreview(null)
        if (!d.moved) {
          // a plain click on one card of a multi-selection selects just that card
          if (d.single && d.tables.length > 1) setSelTables([d.single])
          return
        }
        const cards: Record<string, CardOverride> = {}
        for (const t of d.tables) cards[t] = { x: d.start[t].x + d.dx, y: d.start[t].y + d.dy }
        const follow = followMove(stored, new Set(d.tables), d.dx, d.dy, model.relationships)
        const changes = groupChanges(d)
        const touchesLumen = changes.size > 0 || Object.keys(follow.routes).length > 0 || Object.keys(follow.bounds).length > 0
        commit(d.group ? 'Move group' : d.tables.length > 1 ? 'Move tables' : 'Move table', {
          cards,
          ...(touchesLumen
            ? {
                lumen: (ld: LumenDiagram) => {
                  applyFollow(ld, follow)
                  setMembership(ld, changes, lineageTags)
                }
              }
            : {})
        })
      } else if (d.kind === 'resize') {
        if (d.next) commit('Resize table', { cards: { [d.table]: d.next } })
      } else if (d.kind === 'link') {
        const target = d.active ? fieldAt(e.clientX, e.clientY, d.table) : null
        setLinkEnd(null)
        setLinkTarget(null)
        if (target) openNewRelationship({ table1: d.table, column1: d.column, table2: target.table, ...(target.column ? { column2: target.column } : {}) })
      } else if (d.kind === 'waypoint') {
        setGuides(null)
        if (d.moved) editRoute(d.created ? 'Bend relationship line' : 'Move pinch point', d.rel, d.next)
      } else if (d.kind === 'anchor') {
        if (d.moved) editRoute('Move line end', d.rel, d.next)
      } else if (d.kind === 'gresize') {
        const next = d.next
        if (next) commit('Resize group', { lumen: (ld) => patchGroup(ld, d.id, { bounds: manualBounds(next, d.fit) ?? null }), pin: true })
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

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

  /** Start moving cards: `tables` together; `group` = a whole container is dragged (membership cannot change). */
  const startMove = (e: React.MouseEvent, tables: string[], group: string | null, single: string | null) => {
    const start: Record<string, { x: number; y: number }> = {}
    for (const t of tables) {
      const r = cardRects.get(t)
      if (r) start[t] = { x: r.x, y: r.y }
    }
    const frozen: DropGroup[] = groups.map((g) => ({ id: g.id, rect: g.expanded, tables: g.members, collapsed: g.collapsed }))
    begin({ kind: 'move', tables: tables.filter((t) => t in start), start, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false, group, single, frozen })
  }

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const key = async (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (e.key === ' ') {
        spaceDown.current = true
        return
      }
      if (mod && k === 'g') {
        e.preventDefault()
        if (e.shiftKey) ungroupSelected()
        else groupTables(selectedTables)
        return
      }
      if (mod && k === 'a') {
        e.preventDefault()
        setRelSel(null)
        setGroupSel(null)
        setSelTables([...rects.keys()])
        return
      }
      if (e.key === 'Escape') {
        if (drag.current) {
          // abandon the drag in progress
          drag.current = null
          setDragging(null)
          setOverrides({})
          setDraft(null)
          setMarquee(null)
          setGuides(null)
          setDropPreview(null)
          setLinkEnd(null)
          setLinkTarget(null)
        } else if (wpSel) setWpSel(null)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (wpSel) {
        e.preventDefault()
        removeWp(wpSel.rel, wpSel.index)
        return
      }
      if (groupSel) {
        e.preventDefault()
        ungroupSelected()
        return
      }
      if (e.key !== 'Delete' || !relSel) return
      const r = await confirmDialog({ title: 'Delete relationship', message: 'Are you sure you want to delete this relationship?', buttons: ['Delete', 'Cancel'] })
      if (r !== 0) return
      useApp.getState().mutateModel('Delete relationship', (m) => {
        m.relationships = m.relationships.filter((x) => x.name !== relSel)
      })
      setRelSel(null)
    }
    const keyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceDown.current = false
    }
    const blur = () => {
      spaceDown.current = false
    }
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  })

  // a selection that no longer exists (undo, delete, layout switch) is dropped
  useEffect(() => {
    if (wpSel && !stored.routes?.[wpSel.rel]?.waypoints?.[wpSel.index]) setWpSel(null)
    if (groupSel && !groups.some((g) => g.id === groupSel)) setGroupSel(null)
    if (relSel && !model.relationships.some((r) => r.name === relSel)) setRelSel(null)
  }, [stored, groups, model.relationships, wpSel, groupSel, relSel])

  // ---------------------------------------------------------------- menus
  const lineStyleItems = (current: LineStyle | undefined, pick: (s: LineStyle | undefined) => void, withDefault: boolean): MenuItem[] => [
    ...(withDefault ? [{ label: `Layout default (${LINE_STYLE_LABELS[viewStyle]})`, checked: current === undefined, onClick: () => pick(undefined) } as MenuItem, { separator: true } as MenuItem] : []),
    ...(['curved', 'orthogonal', 'straight'] as const).map((s): MenuItem => ({ label: LINE_STYLE_LABELS[s], icon: <LineStyleIcon style={s} size={16} />, checked: current === s, onClick: () => pick(s) }))
  ]
  const tableMenu = (e: React.MouseEvent, table: string) => {
    e.preventDefault()
    e.stopPropagation()
    const targets = selectedTables.includes(table) && selectedTables.length > 1 ? selectedTables : [table]
    if (targets.length === 1) {
      selectField({ kind: 'table', table })
      setSelTables([table])
    }
    const t = tablesByName.get(table)
    const g = groupOfTable.get(table)
    const items: MenuItem[] = [
      { label: 'New measure', onClick: () => newMeasure(table) },
      { label: 'New column', onClick: () => newColumn(table) },
      { separator: true },
      { label: collapsed.has(table) ? 'Expand' : 'Collapse', onClick: () => toggleCollapse(table) },
      { label: t?.isHidden ? 'Unhide in report view' : 'Hide in report view', onClick: () => setHidden({ kind: 'table', table }, !t?.isHidden) },
      { label: 'Mark as date table', onClick: () => openMarkAsDateTable(table) },
      { label: 'Manage relationships', onClick: openManageRelationships },
      { separator: true },
      { label: targets.length > 1 ? `Group ${targets.length} tables` : 'Group', shortcut: 'Ctrl+G', onClick: () => groupTables(targets) },
      ...(g ? [{ label: `Remove from group "${g.name}"`, onClick: () => commit('Remove from group', { lumen: (d) => setMembership(d, new Map(targets.map((x) => [x, null])), lineageTags) }) } as MenuItem] : []),
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
    setSelTables([])
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
  const relMenu = (e: React.MouseEvent, ev: EdgeView) => {
    e.preventDefault()
    e.stopPropagation()
    const r = ev.rel
    selectRel(r.name)
    const route = stored.routes?.[r.name]
    const at = toWorld(e.clientX, e.clientY)
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
      { separator: true },
      {
        label: 'Line style',
        icon: <LineStyleIcon style={ev.style} size={16} />,
        submenu: lineStyleItems(
          route?.style,
          (s) => {
            const next: RouteDef = { ...(route ?? {}) }
            if (s) next.style = s
            else delete next.style
            commit('Change line style', { lumen: (d) => setRoute(d, r.name, next) })
          },
          true
        )
      },
      {
        label: 'Add pinch point',
        disabled: !ev.editable,
        onClick: () => {
          const hit = nearestOnRoute(ev.geom, at)
          editRoute('Add pinch point', r.name, insertWaypoint(route, hit.seg, { x: hit.x, y: hit.y }))
        }
      },
      { label: 'Reset line', disabled: isRouteEmpty(route), title: 'Remove the pinch points, manual ends and style of this line', onClick: () => editRoute('Reset line', r.name, undefined) },
      { separator: true },
      {
        label: 'Delete',
        onClick: () =>
          useApp.getState().mutateModel('Delete relationship', (m) => {
            m.relationships = m.relationships.filter((x) => x.name !== r.name)
          })
      }
    ])
  }
  const waypointMenu = (e: React.MouseEvent, ev: EdgeView, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    selectRel(ev.rel.name)
    setWpSel({ rel: ev.rel.name, index })
    showContextMenu(e, [
      { label: 'Remove pinch point', shortcut: 'Del', onClick: () => removeWp(ev.rel.name, index) },
      { label: 'Reset line', onClick: () => editRoute('Reset line', ev.rel.name, undefined) }
    ])
  }
  const toggleGroup = (g: GroupView) => commit(g.collapsed ? 'Expand group' : 'Collapse group', { lumen: (d) => patchGroup(d, g.id, { collapsed: !g.collapsed }), pin: true })
  const groupMenu = (e: React.MouseEvent, g: GroupView) => {
    e.preventDefault()
    e.stopPropagation()
    selectGroup(g.id)
    const def = stored.groups?.find((x) => x.id === g.id)
    showContextMenu(e, [
      { label: 'Rename', onClick: () => setRenaming(g.id) },
      {
        label: 'Color',
        submenu: GROUP_COLORS.map((c): MenuItem => ({ label: GROUP_COLOR_LABELS[c], icon: <span className="wbi-mv-swatch" style={{ background: GROUP_PALETTE[c].fill, borderColor: GROUP_PALETTE[c].border }} />, selected: g.color === c, onClick: () => commit('Change group color', { lumen: (d) => patchGroup(d, g.id, { color: c }) }) }))
      },
      { label: g.collapsed ? 'Expand' : 'Collapse', onClick: () => toggleGroup(g) },
      { label: 'Fit to tables', disabled: !def?.bounds, title: 'Shrink the container back to its tables', onClick: () => commit('Fit group', { lumen: (d) => patchGroup(d, g.id, { bounds: null }) }) },
      {
        label: 'Select tables',
        disabled: g.collapsed,
        onClick: () => {
          setGroupSel(null)
          setSelTables(g.members)
        }
      },
      { separator: true },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', title: 'Remove the container; its tables stay', onClick: () => commit('Ungroup tables', { lumen: (d) => ungroup(d, [g.id]) }) }
    ])
  }
  const canvasMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const custom = Object.keys(stored.routes ?? {}).length > 0
    showContextMenu(e, [
      {
        label: 'Line style',
        icon: <LineStyleIcon style={viewStyle} size={16} />,
        submenu: [
          ...lineStyleItems(viewStyle, (s) => s && changeViewStyle(s), false),
          { separator: true },
          {
            label: `Make ${LINE_STYLE_LABELS[viewStyle].toLowerCase()} my default`,
            title: 'Use this line style for every model and layout that does not store its own (a preference on this computer, not part of the file)',
            disabled: fallbackStyle === viewStyle,
            onClick: () => prefs.set({ lineStyle: viewStyle === DEFAULT_LINE_STYLE ? null : viewStyle })
          }
        ]
      },
      {
        label: 'Reset all lines',
        disabled: !custom,
        title: 'Remove every pinch point, manual end and per-line style in this layout',
        onClick: () =>
          commit('Reset all lines', {
            lumen: (d) => {
              delete d.routes
            }
          })
      },
      { separator: true },
      { label: 'Group selected tables', shortcut: 'Ctrl+G', disabled: !selectedTables.length, onClick: () => groupTables(selectedTables) },
      { label: 'Select all tables', shortcut: 'Ctrl+A', onClick: () => setSelTables([...rects.keys()]) },
      { separator: true },
      { label: 'Fit to screen', onClick: fit }
    ])
  }
  const toggleCollapse = (t: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
  const removeFromDiagram = (table: string) => {
    useApp.getState().mutateModelSidecars('Remove from diagram', (files) => {
      const l = parseLayout(files[LAYOUT_FILE])
      const d = l?.diagrams.find((x) => x.name === activeDiagram)
      if (!l || !d) return
      d.nodes = d.nodes.filter((n) => n.nodeIndex !== table)
      files[LAYOUT_FILE] = serializeLayout(l)
      // the table also leaves its group in this layout
      const lum = parseLumenLayout(files[LUMEN_LAYOUT_FILE])
      if (lum && groupOf(lumenDiagram(lum, activeDiagram), table)) {
        const text = serializeLumenLayout(updateLumenDiagram(lum, activeDiagram, (ld) => setMembership(ld, new Map([[table, null]]), lineageTags)))
        if (text === null) delete files[LUMEN_LAYOUT_FILE]
        else files[LUMEN_LAYOUT_FILE] = text
      }
    })
  }
  const addToDiagram = (table: string) => {
    const t = tablesByName.get(table)
    if (!t) return
    const b = bounds([...cardRects.values()])
    const node: DiagramNode = { location: { x: b ? b.x + b.width + 60 : 40, y: b ? b.y : 40 }, nodeIndex: table, nodeLineageTag: t.lineageTag, size: { width: DEFAULT_CARD_WIDTH, height: 300 } }
    useApp.getState().mutateModelSidecars('Add table to diagram', (files) => {
      files[LAYOUT_FILE] = serializeLayout(updateLayoutNodes(parseLayout(files[LAYOUT_FILE]), activeDiagram, [node]))
    })
  }
  const newLayout = () => {
    let n = 1
    while (diagrams.includes(`Layout ${n}`)) n++
    const name = `Layout ${n}`
    useApp.getState().mutateModelSidecars('New layout', (files) => {
      const current = parseLayout(files[LAYOUT_FILE])
      const base = current ?? updateLayoutNodes(null, 'All tables', storedNodes)
      files[LAYOUT_FILE] = serializeLayout(addDiagram(base, name, []))
    })
    setDiagram(name)
  }
  const deleteLayout = (name: string) => {
    useApp.getState().mutateModelSidecars('Delete layout', (files) => {
      const l = parseLayout(files[LAYOUT_FILE])
      if (!l) return
      l.diagrams = l.diagrams.filter((x) => x.name !== name)
      l.diagrams.forEach((x, i) => (x.ordinal = i))
      files[LAYOUT_FILE] = serializeLayout(l)
      // its routing and groups go with it
      const text = serializeLumenLayout(removeLumenDiagram(parseLumenLayout(files[LUMEN_LAYOUT_FILE]), name))
      if (text === null) delete files[LUMEN_LAYOUT_FILE]
      else files[LUMEN_LAYOUT_FILE] = text
    })
    setDiagram(diagrams[0])
  }

  // ---------------------------------------------------------------- relationship being dragged out (live preview)
  const linkDrag = drag.current?.kind === 'link' ? drag.current : null
  const linkPreview = useMemo(() => {
    if (!linkDrag?.active || !linkEnd) return null
    const src = rects.get(linkDrag.table)
    if (!src) return null
    const ry = collapsed.has(linkDrag.table) ? null : rowY(rowsByTable.get(linkDrag.table) ?? [], linkDrag.column)
    const srcY = ry === null ? null : src.y + ry
    let from = autoEndToward(src, srcY, linkEnd)
    let to: End
    const target = linkTarget ? rects.get(linkTarget.table) : undefined
    if (target && linkTarget) {
      // over a table: attach to it like the finished relationship would
      const ty = linkTarget.column && !collapsed.has(linkTarget.table) ? rowY(rowsByTable.get(linkTarget.table) ?? [], linkTarget.column) : null
      to = autoEndToward(target, ty === null ? null : target.y + ty, from.point)
      from = autoEndToward(src, srcY, to.point)
    } else {
      const side: AnchorSide = from.side === 'center' ? 'left' : OPPOSITE[from.side]
      to = { point: linkEnd, normal: { x: -from.normal.x, y: -from.normal.y }, side, manual: false }
    }
    return buildRoute(from, to, [], viewStyle).d
  }, [linkDrag?.active, linkDrag?.table, linkDrag?.column, linkEnd, linkTarget, rects, collapsed, rowsByTable, viewStyle])

  const doExport = () =>
    void exportDiagram({
      name: activeDiagram,
      cards: [...rects].map(([name, rect]) => ({ name, rect, collapsed: collapsed.has(name), rows: (rowsByTable.get(name) ?? []).map((r) => (r.kind === 'separator' ? null : r.name)) })),
      groups: groups.map((g) => ({ name: g.name, color: g.color, rect: g.rect, collapsed: g.collapsed, count: g.members.length })),
      edges: edges.map((e) => ({
        d: e.geom.d,
        inactive: e.rel.isActive === false,
        from: e.rel.fromCardinality === 'one' ? '1' : '*',
        to: e.rel.toCardinality === 'many' ? '*' : '1',
        decor: e.decor,
        both: e.rel.crossFilteringBehavior === 'bothDirections',
        towardTo: e.rel.fromCardinality === 'one' && e.rel.toCardinality === 'many'
      }))
    })

  return (
    <div className="wbi-mv">
      <ViewAsBanner />
      <div className="wbi-mv__main">
        <div className="wbi-mv__canvaswrap">
          <div
            ref={hostRef}
            className={cx('wbi-mv__canvas', linkDrag?.active && 'is-linking', mode === 'select' && 'is-select', dragging && `is-drag-${dragging}`)}
            onWheel={onWheel}
            onMouseDown={(e) => {
              if (e.button !== 0 && e.button !== 1) return
              const pan = e.button === 1 || spaceDown.current || (mode === 'pan' && !e.shiftKey)
              if (pan) {
                if (e.button === 1) e.preventDefault()
                begin({ kind: 'pan', sx: e.clientX, sy: e.clientY, panX: view.panX, panY: view.panY, moved: e.button === 1 })
              } else {
                const p = toWorld(e.clientX, e.clientY)
                // Ctrl (or Shift in select mode) adds to the current selection
                const additive = e.ctrlKey || e.metaKey || (mode === 'select' && e.shiftKey)
                begin({ kind: 'marquee', sx: e.clientX, sy: e.clientY, x0: p.x, y0: p.y, base: additive ? selectedTables : [], moved: false })
                setRelSel(null)
                setWpSel(null)
                setGroupSel(null)
                if (!additive) useApp.getState().selectField(null)
              }
            }}
            onContextMenu={canvasMenu}
            role="application"
            aria-label="Model diagram"
            data-line-style={viewStyle}
          >
            <div className="wbi-mv__world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
              {groups.map((g) => {
                const joining = dropPreview ? [...dropPreview.values()].includes(g.id) : false
                const leaving = dropPreview ? g.members.some((m) => dropPreview.has(m) && dropPreview.get(m) !== g.id) : false
                return (
                  <GroupBox
                    key={g.id}
                    id={g.id}
                    name={g.name}
                    color={g.color}
                    rect={g.rect}
                    collapsed={g.collapsed}
                    selected={groupSel === g.id}
                    count={g.members.length}
                    hint={joining ? 'join' : leaving ? 'leave' : null}
                    renaming={renaming === g.id}
                    onDown={(e) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      selectGroup(g.id)
                      useApp.getState().selectField(null)
                      startMove(e, g.members, g.id, null)
                    }}
                    onMenu={(e) => groupMenu(e, g)}
                    onToggleCollapse={() => toggleGroup(g)}
                    onStartRename={() => setRenaming(g.id)}
                    onRename={(name) => {
                      setRenaming(null)
                      if (name !== null && name.trim() && name.trim() !== g.name) commit('Rename group', { lumen: (d) => patchGroup(d, g.id, { name }) })
                    }}
                    onResizeDown={(e, handle) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      begin({ kind: 'gresize', id: g.id, handle, start: g.expanded, fit: g.fit, sx: e.clientX, sy: e.clientY, next: null })
                    }}
                  />
                )
              })}
              <EdgeLayer
                edges={edges}
                activeRel={activeRel}
                zoom={view.zoom}
                preview={linkPreview}
                onEnter={(rel) => !drag.current && setHoverRel(rel)}
                onLeave={(rel) => setHoverRel((h) => (h === rel ? null : h))}
                onDown={(e, ev) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  selectRel(ev.rel.name)
                  setWpSel(null)
                  if (ev.editable) begin({ kind: 'bend', rel: ev.rel.name, sx: e.clientX, sy: e.clientY })
                }}
                onDoubleClick={(ev) => openEditRelationship(ev.rel.name)}
                onMenu={relMenu}
              />
              {nodes.map((n) => {
                if (hiddenIn.has(n.nodeIndex)) return null
                const t = tablesByName.get(n.nodeIndex)!
                const r = rects.get(n.nodeIndex)!
                const multi = selectedTables.includes(t.name)
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
                    selected={multi}
                    selectedField={sel && sel.table === t.name && sel.kind !== 'table' && !relSel && !groupSel ? { kind: sel.kind, name: sel.name } : null}
                    highlighted={highlightedFields.get(t.name) ?? EMPTY}
                    related={!relSel && !groupSel && selectedTables.length <= 1 && relatedTables.has(t.name)}
                    dimmed={false}
                    onHeaderDown={(e) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        // toggle this card in the multi-selection
                        const next = multi ? selectedTables.filter((x) => x !== t.name) : [...selectedTables, t.name]
                        setRelSel(null)
                        setWpSel(null)
                        setGroupSel(null)
                        setSelTables(next)
                        useApp.getState().selectField(next.length ? { kind: 'table', table: next[next.length - 1] } : null)
                        return
                      }
                      const together = multi && selectedTables.length > 1 ? selectedTables : [t.name]
                      if (together.length === 1) setSelTables([t.name])
                      selectField({ kind: 'table', table: t.name })
                      startMove(e, together, null, t.name)
                    }}
                    onFieldDown={(e, row) => {
                      if (e.button !== 0 || row.kind === 'separator') return
                      e.stopPropagation()
                      setSelTables([])
                      selectField({ kind: row.kind, table: t.name, name: row.name })
                      if (row.kind === 'column') begin({ kind: 'link', table: t.name, column: row.name, sx: e.clientX, sy: e.clientY, active: false })
                    }}
                    onToggleCollapse={() => toggleCollapse(t.name)}
                    onMenu={(e) => tableMenu(e, t.name)}
                    onFieldContext={(e, row) => fieldMenu(e, t.name, row)}
                    onResizeDown={(e) => {
                      e.stopPropagation()
                      begin({ kind: 'resize', table: t.name, sx: e.clientX, sy: e.clientY, x: r.x, y: r.y, w: r.width, h: r.height, next: null })
                    }}
                  />
                )
              })}
              <HandleLayer
                edges={edges}
                activeRel={activeRel}
                selectedWaypoint={wpSel}
                zoom={view.zoom}
                guides={guides}
                marquee={marquee}
                onEnter={(rel) => !drag.current && setHoverRel(rel)}
                onLeave={(rel) => setHoverRel((h) => (h === rel ? null : h))}
                onWaypointDown={(e, ev, index) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  selectRel(ev.rel.name)
                  setWpSel({ rel: ev.rel.name, index })
                  const base = stored.routes?.[ev.rel.name]
                  if (base) begin({ kind: 'waypoint', rel: ev.rel.name, index, base, created: false, moved: false, sx: e.clientX, sy: e.clientY, next: base })
                }}
                onWaypointDoubleClick={(ev, index) => removeWp(ev.rel.name, index)}
                onWaypointMenu={waypointMenu}
                onEndDown={(e, ev, end) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  selectRel(ev.rel.name)
                  setWpSel(null)
                  const base = stored.routes?.[ev.rel.name] ?? {}
                  begin({ kind: 'anchor', rel: ev.rel.name, end, base, moved: false, sx: e.clientX, sy: e.clientY, next: base })
                }}
                onEndDoubleClick={(ev, end) => {
                  const route = stored.routes?.[ev.rel.name]
                  if (!route?.[end]) return
                  const next: RouteDef = { ...route }
                  delete next[end]
                  editRoute('Attach line end automatically', ev.rel.name, next)
                }}
              />
            </div>
            {!nodes.length && <div className="wbi-mv__hint">{isAll ? 'This model has no tables.' : 'This layout is empty. Add tables with the "Add table" box below.'}</div>}
          </div>
          <DiagramToolbar
            mode={mode}
            onMode={(m) => prefs.set({ mode: m })}
            lineStyle={viewStyle}
            onLineStyle={changeViewStyle}
            canGroup={selectedTables.length > 0}
            canUngroup={ungroupTargets.length > 0}
            onGroup={() => groupTables(selectedTables)}
            onUngroup={ungroupSelected}
            snap={snap}
            onSnap={(on) => prefs.set({ snap: on })}
            onExport={doExport}
          />
          <MiniMap rects={[...rects.values()]} groups={groups.map((g) => g.rect)} content={content} view={view} size={size} onNavigate={(cx0, cy0) => setView((v) => ({ ...v, panX: size.w / 2 - cx0 * v.zoom, panY: size.h / 2 - cy0 * v.zoom }))} />
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
                  deleteLayout(d)
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
            <Dropdown<string> size="small" value={undefined} placeholder="Add table…" options={[...tablesByName.keys()].filter((n) => !cardRects.has(n)).map((n) => ({ value: n, label: n }))} onChange={addToDiagram} searchable />
          </div>
        )}
      </div>
    </div>
  )
}

const EMPTY = new Set<string>()

function sameMap(a: Map<string, string | null> | null, b: Map<string, string | null>): boolean {
  if (!a) return b.size === 0
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

function MiniMap({ rects, groups, content, view, size, onNavigate }: { rects: Rect[]; groups: Rect[]; content: Rect | null; view: ViewState; size: { w: number; h: number }; onNavigate(x: number, y: number): void }) {
  if (!content || rects.length + groups.length < 2) return null
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
      {groups.map((r, i) => (
        <rect key={`g${i}`} x={ox + r.x * s} y={oy + r.y * s} width={Math.max(3, r.width * s)} height={Math.max(3, r.height * s)} rx={2} className="wbi-mv__mmgroup" />
      ))}
      {rects.map((r, i) => (
        <rect key={i} x={ox + r.x * s} y={oy + r.y * s} width={Math.max(2, r.width * s)} height={Math.max(2, r.height * s)} className="wbi-mv__mmcard" />
      ))}
      <rect x={ox + vp.x * s} y={oy + vp.y * s} width={vp.width * s} height={vp.height * s} className="wbi-mv__mmview" />
    </svg>
  )
}

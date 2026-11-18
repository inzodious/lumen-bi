/**
 * Relationship lines of the model diagram.
 *
 *  - <EdgeLayer>   the lines themselves (under the table cards): a wide invisible stroke for hover / selection /
 *                  dragging, the visible stroke (dashed when inactive), cardinality markers and the filter-direction
 *                  arrow placed along the line, plus the live preview while a new relationship is dragged out;
 *  - <HandleLayer> what must stay above the cards: pinch points (waypoints), the two draggable line ends of
 *                  the hovered/selected line, alignment guides and the selection marquee.
 */
import type { LineStyle, RouteDef } from '@core/io/diagramSidecar'
import type { RelationshipDef } from '@core/model/types'
import { cx } from '../../app/ui'
import type { Rect } from './edges'
import { segmentMidpoints, type EdgeDecor, type RouteGeometry } from './routing'

export interface EdgeView {
  rel: RelationshipDef
  geom: RouteGeometry
  decor: EdgeDecor
  style: LineStyle
  route: RouteDef | undefined
  /** every drawn line can be bent (kept for callers that draw read-only diagrams) */
  editable: boolean
  /** ends drawn to a collapsed group's chip instead of the (hidden) table card: those ends cannot be moved */
  chip?: { from: boolean; to: boolean }
}

export interface EdgeLayerProps {
  edges: EdgeView[]
  activeRel: string | null
  zoom: number
  /** live preview of a relationship being dragged from a column */
  preview: string | null
  onEnter(rel: string): void
  onLeave(rel: string): void
  onDown(e: React.MouseEvent, edge: EdgeView): void
  onDoubleClick(edge: EdgeView): void
  onMenu(e: React.MouseEvent, edge: EdgeView): void
  /** the pointer moves along a line (shows where a pinch point would be added) */
  onHover?(e: React.MouseEvent, edge: EdgeView): void
}

/** Tooltip of a relationship line: what can be done with it. */
export function lineTitle(ev: EdgeView): string {
  const chip = ev.chip?.from || ev.chip?.to
  return `Drag to bend this line (adds a pinch point) · double-click to edit the relationship · right-click for line style, pinch points and more${chip ? ' · this line ends on a collapsed group: expand the group to move that end' : ''}`
}

/** Filter flows from the one side to the many side; `from` is the many side unless the relationship says otherwise. */
function arrowAngle(r: RelationshipDef, lineAngle: number): number {
  const towardTo = r.fromCardinality === 'one' && r.toCardinality === 'many'
  return towardTo ? lineAngle : lineAngle + 180
}

export function EdgeLayer(p: EdgeLayerProps) {
  return (
    <svg className="wbi-mv__edges" width="1" height="1" overflow="visible">
      {p.edges.map((ev) => {
        const r = ev.rel
        const g = ev.geom
        const both = r.crossFilteringBehavior === 'bothDirections'
        return (
          <g
            key={r.name}
            className={cx('wbi-mv-edge', r.isActive === false && 'is-inactive', p.activeRel === r.name && 'is-active')}
            data-rel={r.name}
            data-style={ev.style}
            data-waypoints={g.waypoints.length}
            data-chip={ev.chip?.from || ev.chip?.to ? '1' : undefined}
            onMouseEnter={() => p.onEnter(r.name)}
            onMouseLeave={() => p.onLeave(r.name)}
            onMouseMove={(e) => p.onHover?.(e, ev)}
            onMouseDown={(e) => p.onDown(e, ev)}
            onDoubleClick={() => p.onDoubleClick(ev)}
            onContextMenu={(e) => p.onMenu(e, ev)}
          >
            <title>{lineTitle(ev)}</title>
            <path d={g.d} className="wbi-mv-edge__hit" style={{ strokeWidth: Math.max(12, 14 / p.zoom) }} />
            <path d={g.d} className="wbi-mv-edge__line" />
            <text x={ev.decor.l1.x} y={ev.decor.l1.y} className="wbi-mv-edge__card">
              {r.fromCardinality === 'one' ? '1' : '*'}
            </text>
            <text x={ev.decor.l2.x} y={ev.decor.l2.y} className="wbi-mv-edge__card">
              {r.toCardinality === 'many' ? '*' : '1'}
            </text>
            <g transform={`translate(${ev.decor.mid.x},${ev.decor.mid.y}) rotate(${arrowAngle(r, ev.decor.mid.angle)})`} className="wbi-mv-edge__dir">
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
      {p.preview && <path d={p.preview} className="wbi-mv-link" />}
    </svg>
  )
}

export interface HandleLayerProps {
  edges: EdgeView[]
  activeRel: string | null
  /** the selected line: drawn on top (ghost + grab area) with "+" handles to add pinch points */
  selectedRel: string | null
  /** hide the "+" handles (while something is dragged) */
  busy: boolean
  /** the "add a pinch point here" marker that follows the pointer along the hovered line (positioned by the view) */
  markerRef: React.Ref<SVGGElement>
  selectedWaypoint: { rel: string; index: number } | null
  zoom: number
  guides: { x?: number; y?: number } | null
  marquee: Rect | null
  onEnter(rel: string): void
  onLeave(rel: string): void
  onWaypointDown(e: React.MouseEvent, edge: EdgeView, index: number): void
  onWaypointDoubleClick(edge: EdgeView, index: number): void
  onWaypointMenu(e: React.MouseEvent, edge: EdgeView, index: number): void
  onEndDown(e: React.MouseEvent, edge: EdgeView, end: 'from' | 'to'): void
  onEndDoubleClick(edge: EdgeView, end: 'from' | 'to'): void
  /** mouse down on a "+" handle: add a pinch point on stretch `seg` at `at` (and drag it) */
  onAddDown(e: React.MouseEvent, edge: EdgeView, seg: number, at: { x: number; y: number }): void
  /** the selected line's grab area above the cards: same gestures as the line itself */
  onLineDown(e: React.MouseEvent, edge: EdgeView): void
  onLineDoubleClick(edge: EdgeView): void
  onLineMenu(e: React.MouseEvent, edge: EdgeView): void
  onLineHover(e: React.MouseEvent, edge: EdgeView): void
}

const FAR = 100000

export function HandleLayer(p: HandleLayerProps) {
  // handles keep their on-screen size whatever the zoom
  const k = 1 / p.zoom
  return (
    <svg className="wbi-mv__handles" width="1" height="1" overflow="visible">
      {p.guides?.x !== undefined && <line x1={p.guides.x} y1={-FAR} x2={p.guides.x} y2={FAR} className="wbi-mv-guide" style={{ strokeWidth: k }} />}
      {p.guides?.y !== undefined && <line x1={-FAR} y1={p.guides.y} x2={FAR} y2={p.guides.y} className="wbi-mv-guide" style={{ strokeWidth: k }} />}
      {p.edges.map((ev) => {
        const active = p.activeRel === ev.rel.name
        const selected = p.selectedRel === ev.rel.name
        if (!ev.editable) return null
        return (
          <g key={ev.rel.name} onMouseEnter={() => p.onEnter(ev.rel.name)} onMouseLeave={() => p.onLeave(ev.rel.name)}>
            {/* the hovered / selected line is repeated faintly above the cards, so the stretches it runs behind them show */}
            {(active || selected) && <path d={ev.geom.d} className="wbi-mv-ghost" style={{ strokeWidth: 1.5 * k }} />}
            {selected && (
              <path
                d={ev.geom.d}
                className="wbi-mv-selhit"
                data-rel={ev.rel.name}
                style={{ strokeWidth: 10 * k }}
                onMouseDown={(e) => p.onLineDown(e, ev)}
                onMouseMove={(e) => p.onLineHover(e, ev)}
                onDoubleClick={() => p.onLineDoubleClick(ev)}
                onContextMenu={(e) => p.onLineMenu(e, ev)}
              >
                <title>{lineTitle(ev)}</title>
              </path>
            )}
            {selected &&
              !p.busy &&
              segmentMidpoints(ev.geom).map((m) => (
                <g key={`add${m.seg}`} className="wbi-mv-add" data-rel={ev.rel.name} data-seg={m.seg} onMouseDown={(e) => p.onAddDown(e, ev, m.seg, m)}>
                  <title>Add a pinch point here (drag to bend the line)</title>
                  <circle cx={m.x} cy={m.y} r={9 * k} className="wbi-mv-add__hit" />
                  <circle cx={m.x} cy={m.y} r={6 * k} className="wbi-mv-add__dot" style={{ strokeWidth: 1.25 * k }} />
                  <path d={`M${m.x - 3 * k},${m.y} H${m.x + 3 * k} M${m.x},${m.y - 3 * k} V${m.y + 3 * k}`} className="wbi-mv-add__plus" style={{ strokeWidth: 1.5 * k }} />
                </g>
              ))}
            {active &&
              (['from', 'to'] as const).map((end) => {
                const e = ev.geom[end]
                if (e.side === 'center' || ev.chip?.[end]) return null
                return (
                  <g key={end} className={cx('wbi-mv-end', e.manual && 'is-manual')} data-rel={ev.rel.name} data-end={end} onMouseDown={(me) => p.onEndDown(me, ev, end)} onDoubleClick={() => p.onEndDoubleClick(ev, end)}>
                    <title>{e.manual ? 'Drag to move this end around the table · double-click to attach automatically' : 'Drag to choose where the line attaches to the table'}</title>
                    <circle cx={e.point.x} cy={e.point.y} r={9 * k} className="wbi-mv-end__hit" />
                    <rect x={e.point.x - 4 * k} y={e.point.y - 4 * k} width={8 * k} height={8 * k} rx={1.5 * k} className="wbi-mv-end__dot" style={{ strokeWidth: 1.5 * k }} />
                  </g>
                )
              })}
            {ev.geom.waypoints.map((w, i) => {
              const selected = p.selectedWaypoint?.rel === ev.rel.name && p.selectedWaypoint.index === i
              return (
                <g
                  key={i}
                  className={cx('wbi-mv-wp', active && 'is-active', selected && 'is-selected')}
                  data-rel={ev.rel.name}
                  data-index={i}
                  onMouseDown={(e) => p.onWaypointDown(e, ev, i)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    p.onWaypointDoubleClick(ev, i)
                  }}
                  onContextMenu={(e) => p.onWaypointMenu(e, ev, i)}
                >
                  <title>Pinch point — drag to move · double-click or Delete to remove</title>
                  <circle cx={w.x} cy={w.y} r={9 * k} className="wbi-mv-wp__hit" />
                  <circle cx={w.x} cy={w.y} r={(active ? 5 : 3.5) * k} className="wbi-mv-wp__dot" style={{ strokeWidth: 1.5 * k }} />
                </g>
              )
            })}
          </g>
        )
      })}
      {/* follows the pointer along the hovered line: "a pinch point goes here if you drag" */}
      <g ref={p.markerRef} className="wbi-mv-addmark" aria-hidden="true">
        <circle r={6 * k} className="wbi-mv-add__dot" style={{ strokeWidth: 1.25 * k }} />
        <path d={`M${-3 * k},0 H${3 * k} M0,${-3 * k} V${3 * k}`} className="wbi-mv-add__plus" style={{ strokeWidth: 1.5 * k }} />
      </g>
      {p.marquee && <rect x={p.marquee.x} y={p.marquee.y} width={p.marquee.width} height={p.marquee.height} className="wbi-mv-marquee" style={{ strokeWidth: k }} />}
    </svg>
  )
}

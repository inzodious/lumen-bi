/**
 * Visuals gallery (dev page, route `#/gallery`): renders every registered gallery entry with
 * realistic sample data inside a Power BI-like visual container, with working selection,
 * tooltips, drill and cross-highlight simulation.
 *
 * Data: the real engine (createEngine) over the sample model when it works, otherwise the
 * in-memory mock engine (mockEngine.ts). The active engine is shown in the header.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import '../index'
import { getVisual } from '../registry'
import type { DrillState, TooltipRequest, VisualHostContext } from '../contract'
import type { QueryEngine } from '@core/engine/api'
import { createEngine } from '@core/engine/engine'
import { resolveTheme, type ResolvedTheme } from '@core/report/theme'
import { measureExpr } from '@core/report/sq'
import type { DataPointIdentity, SQFilter } from '@core/report/sq'
import { buildSampleModel } from './sampleData'
import { createMockEngine } from './mockEngine'
import { galleryEntries, type GalleryEntry } from './registry'

// Pull in every family's gallery fixtures (visuals/<family>/gallery.ts).
import.meta.glob('../*/gallery.ts', { eager: true })

function pickEngine(): { engine: QueryEngine; kind: 'real' | 'mock'; note?: string } {
  const { model, data } = buildSampleModel()
  try {
    const real = createEngine(model, data)
    real.processCalculated()
    const probe = real.summarize({ groupBy: [], values: [{ id: 'v', expr: { kind: 'sq', expr: measureExpr('Sales', 'Total Sales') } }] })
    if (!probe.rows.length || typeof probe.rows[0][0] !== 'number') throw new Error('probe returned no data')
    return { engine: real, kind: 'real' }
  } catch (e) {
    return { engine: createMockEngine(model, data), kind: 'mock', note: e instanceof Error ? e.message : String(e) }
  }
}

const FONT = "'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', sans-serif"

export function Gallery() {
  const picked = useMemo(pickEngine, [])
  const theme = useMemo(() => resolveTheme(), [])
  const [tooltip, setTooltip] = useState<TooltipRequest | null>(null)
  // `#/gallery?filter=pie` pre-fills the filter (handy for headless captures of one family)
  const [filter, setFilter] = useState(() => {
    try {
      return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('filter') ?? ''
    } catch {
      return ''
    }
  })
  const entries = galleryEntries().filter((e) => !filter || filter.toLowerCase().split('|').some((f) => (e.id + ' ' + e.title + ' ' + e.section + ' ' + e.json?.visual?.visualType).toLowerCase().includes(f.trim())))
  const sections = [...new Set(entries.map((e) => e.section))]

  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        document.body.dataset.wbiReady = '1'
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [])

  return (
    <div style={{ height: '100vh', overflow: 'auto', background: '#EAEAEA', fontFamily: FONT, color: '#252423' }} onClick={() => setTooltip(null)}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#F3F2F1', borderBottom: '1px solid #E1DFDD', padding: '8px 16px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Visuals gallery</div>
        <div style={{ fontSize: 12, color: '#605E5C' }} title={picked.note}>
          engine: {picked.kind === 'real' ? 'DAX engine' : 'mock (in-memory)'} · {entries.length} visuals
        </div>
        <input
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginLeft: 'auto', font: `12px ${FONT}`, padding: '3px 6px', border: '1px solid #C8C6C4', borderRadius: 2, width: 180 }}
        />
      </div>
      <div style={{ padding: '8px 16px 32px' }}>
        {sections.map((sec) => (
          <section key={sec}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: '#605E5C', margin: '14px 0 8px' }}>{sec}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {entries
                .filter((e) => e.section === sec)
                .map((e) => (
                  <GalleryCard key={e.id} entry={e} engine={picked.engine} theme={theme} onTooltip={setTooltip} />
                ))}
            </div>
          </section>
        ))}
      </div>
      {tooltip ? <TooltipView req={tooltip} /> : null}
    </div>
  )
}

function GalleryCard({ entry, engine: sharedEngine, theme, onTooltip }: { entry: GalleryEntry; engine: QueryEngine; theme: ResolvedTheme; onTooltip(r: TooltipRequest | null): void }) {
  const [json, setJson] = useState(entry.json)
  const [selection, setSelection] = useState<DataPointIdentity[]>(entry.selection ?? [])
  const [drill, setDrill] = useState<DrillState>({ level: 0, path: [], ...entry.drill })
  const [slicerFilter, setSlicerFilter] = useState<SQFilter | undefined>(undefined)
  const engine = entry.engine ?? sharedEngine
  const def = getVisual(json?.visual?.visualType ?? '')
  const W = entry.width ?? 400
  const H = entry.height ?? 300
  const titleH = 26
  const pad = 6

  const ctx: VisualHostContext = useMemo(
    () => ({
      engine,
      theme,
      format: (v, f, t) => engine.format(v, f, t),
      locale: 'en-US',
      mode: entry.mode ?? 'view',
      filters: [...(entry.filters ?? []), ...(drill.path.length ? drillFilters(drill.path) : [])],
      highlightFilters: entry.highlightFilters,
      selection,
      select: (ids) => setSelection(ids),
      setSlicerFilter,
      slicerFilter,
      drill,
      setDrill,
      showTooltip: onTooltip,
      showContextMenu: (r) => console.info('[gallery] context menu', r),
      actions: {
        navigatePage: () => {},
        applyBookmark: () => {},
        back: () => {},
        drillthrough: () => {},
        openUrl: () => {},
        clearAllSlicers: () => {}
      },
      report: entry.report ?? { pages: [], activePage: '', bookmarks: [], resolveImage: () => undefined },
      updateVisual: (m) =>
        setJson((j: any) => {
          const c = structuredClone(j)
          m(c)
          return c
        })
    }),
    [engine, theme, selection, drill, slicerFilter, entry, onTooltip]
  )
  const hasHierarchy = (json?.visual?.query?.queryState?.Category?.projections ?? []).length > 1
  const Comp = def?.component
  const header: CSSProperties = { height: titleH, display: 'flex', alignItems: 'center', gap: 6, padding: `0 ${pad}px`, fontFamily: FONT }
  return (
    <div style={{ width: W, height: H, background: '#FFFFFF', boxShadow: '0 0 0 1px rgba(0,0,0,0.04)', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={header}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, color: '#252423' }} title={entry.title}>
          {entry.title}
        </div>
        {hasHierarchy ? (
          <div style={{ display: 'flex', gap: 2 }}>
            <HeaderBtn label="↑" title="Drill up" onClick={() => setDrill({ ...drill, level: Math.max(0, drill.level - 1), path: drill.path.slice(0, -1), expandedLevel: undefined })} />
            <HeaderBtn label="↓" title="Drill mode" active={!!drill.drillMode} onClick={() => setDrill({ ...drill, drillMode: !drill.drillMode })} />
            <HeaderBtn label="⇊" title="Expand all down one level" onClick={() => setDrill({ ...drill, expandedLevel: (drill.expandedLevel ?? drill.level) + 1 })} />
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, padding: `0 ${pad}px ${pad}px`, minHeight: 0 }}>
        {Comp ? (
          <Comp visual={{ name: entry.id, json }} pageName="gallery" width={W - pad * 2} height={H - titleH - pad} ctx={ctx} />
        ) : (
          <div style={{ color: '#A4262C', fontSize: 12 }}>No visual registered for {json?.visual?.visualType}</div>
        )}
      </div>
      <div style={{ position: 'absolute', right: 6, bottom: 2, fontSize: 9, color: '#B3B0AD' }}>{json?.visual?.visualType}</div>
    </div>
  )
}

function HeaderBtn({ label, title, onClick, active }: { label: string; title: string; onClick(): void; active?: boolean }) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{ width: 20, height: 20, border: 'none', borderRadius: 2, background: active ? '#E1DFDD' : 'transparent', cursor: 'pointer', color: '#252423', fontSize: 12, padding: 0 }}
    >
      {label}
    </button>
  )
}

function drillFilters(path: DataPointIdentity[]) {
  return path.map((id) => ({
    Version: 2,
    Where: [{ Condition: { In: { Expressions: id.fields.map((f) => f.expr), Values: [id.fields.map((f) => ({ Literal: { Value: lit(f.value) } }))] } } }]
  }))
}

function lit(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? `${v}L` : `${v}D`
  if (v instanceof Date) return `datetime'${v.toISOString().slice(0, 19)}'`
  if (v === null || v === undefined) return 'null'
  return `'${String(v).replace(/'/g, "''")}'`
}

/** Power BI–style tooltip card. */
export function TooltipView({ req }: { req: TooltipRequest }) {
  const left = Math.min(req.x + 14, window.innerWidth - 260)
  const top = Math.min(req.y + 14, window.innerHeight - 30 - req.items.length * 20)
  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 50,
        pointerEvents: 'none',
        background: '#FFFFFF',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        borderRadius: 2,
        padding: '6px 10px',
        fontFamily: FONT,
        fontSize: 12,
        minWidth: 120,
        maxWidth: 320
      }}
    >
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {req.items.map((it, i) => (
            <tr key={i}>
              <td style={{ color: '#605E5C', padding: '2px 12px 2px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{it.label}</td>
              <td style={{ color: '#252423', fontWeight: 600, padding: '2px 0', wordBreak: 'break-word' }}>{it.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

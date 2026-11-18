/**
 * Shared visual-state helpers: memoized data queries keyed on everything that changes results,
 * and the PBI-style empty / error / not-supported messages.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { VisualHostContext } from '../contract'

let engineIds = new WeakMap<object, number>()
let nextId = 1
function idOf(o: object | undefined | null): number {
  if (!o) return 0
  let id = engineIds.get(o)
  if (!id) {
    id = nextId++
    engineIds.set(o, id)
  }
  return id
}

/** Reset identity cache (tests). */
export function resetQueryKeys(): void {
  engineIds = new WeakMap()
}

export type QueryState<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Run a data query once per relevant input change. Errors are caught and returned so the
 * visual can render PBI's "Can't display the visual" state.
 */
export function useVisualQuery<T>(visualJson: any, ctx: VisualHostContext, run: () => T, extraKey = ''): QueryState<T> {
  const key = [
    idOf(visualJson),
    idOf(ctx.engine),
    idOf(ctx.theme),
    safeKey(ctx.filters),
    safeKey(ctx.highlightFilters ?? null),
    safeKey(ctx.drill ? { l: ctx.drill.level, p: ctx.drill.path, e: ctx.drill.expandedLevel } : null),
    extraKey
  ].join('§')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    try {
      return { ok: true, data: run() } as const
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) } as const
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

function safeKey(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (x instanceof Date ? `D${x.getTime()}` : x)) ?? ''
  } catch {
    return String(Math.random())
  }
}

const box: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: "'Segoe UI', 'Selawik', 'Open Sans', sans-serif",
  color: '#605E5C',
  textAlign: 'center',
  padding: 8,
  boxSizing: 'border-box',
  overflow: 'hidden'
}

/** Faded visual-type icon shown when the field wells are empty (Power BI's empty visual). */
export function EmptyVisual({ icon, width, height, message }: { icon?: string; width: number; height: number; message?: ReactNode }) {
  const s = Math.max(24, Math.min(width, height) * 0.45)
  return (
    <div style={box}>
      {icon ? (
        <div
          style={{ width: s, height: s, opacity: 0.25, filter: 'grayscale(1)' }}
          dangerouslySetInnerHTML={{ __html: icon.replace('<svg', `<svg width="${s}" height="${s}"`) }}
        />
      ) : null}
      {message && height > 80 ? <div style={{ fontSize: 11, maxWidth: 260 }}>{message}</div> : null}
    </div>
  )
}

export function VisualError({ error, height }: { error: string; height: number }) {
  return (
    <div style={box} title={error}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="#A4262C" strokeWidth="1.2" />
        <path d="M10 5.5v6" stroke="#A4262C" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="0.9" fill="#A4262C" />
      </svg>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#252423' }}>Can't display the visual.</div>
      {height > 90 ? <div style={{ fontSize: 11, maxWidth: 320, wordBreak: 'break-word' }}>{error}</div> : null}
    </div>
  )
}

export function NoData({ height }: { height: number }) {
  return <div style={{ ...box, fontSize: height > 60 ? 12 : 10 }}>No data available</div>
}

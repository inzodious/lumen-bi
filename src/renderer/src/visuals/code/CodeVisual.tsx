/**
 * Code visual renderer (host side). Queries the wells (codeModel.ts), evaluates the HTML template, transpiles the JSX
 * (lazily), and hands everything to a sandboxed frame (frameHost.ts). Interactions coming back from the frame are
 * applied through the host context exactly like a native visual's: select / Ctrl-select / clear cross-filters and
 * cross-highlights the page, drill follows the visual's drill state, tooltips and the context menu are the canvas'.
 *
 * In edit mode the frame is covered by a transparent layer so the canvas keeps selecting and moving the visual; clicks,
 * moves, wheel and right-clicks on that layer are forwarded into the frame (`:hover` rules see the forwarded hover).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { identityKey } from '@core/report/sq'
import { readCodeSource, readDrillText } from '@core/codevisual/model'
import { evaluateTemplate, TemplateError } from '@core/codevisual/template'
import { rootVars, rowStats, rowVars, styleText } from '@core/codevisual/cssvars'
import { checkCss } from '@core/codevisual/csscheck'
import { templateContext } from '@core/codevisual/context'
import { parseDrill, serializeDrill } from '@core/codevisual/drill'
import type { FrameMessage, ErrorPhase } from '@core/codevisual/protocol'
import type { CodeData, CodeRow } from '@core/codevisual/types'
import type { DrillState, VisualHostContext, VisualProps } from '../contract'
import { useVisualQuery } from '../common/VisualState'
import { useReadyHold } from '../common/readiness'
import { drillLevelExprs, queryCodeData, readCodeFormat, themeInfo, type CodeQuery } from './codeModel'
import { CodeFrameHost } from './frameHost'
import { cachedTranspile, transpileJsx, type TranspileResult } from './transpile'
import { drillInto, drillUp, expandNextLevel, nextLevel } from './drillOps'
import { resourceNames, loadResources } from './resources'
import { codeVisualActions } from './actions'
import './codeVisual.css'

export interface CodeVisualError {
  phase: ErrorPhase
  message: string
  line?: number
  column?: number
}

const PHASE_LABEL: Record<ErrorPhase, string> = {
  template: 'HTML template',
  css: 'CSS',
  transpile: 'JSX',
  runtime: 'JSX',
  promise: 'JSX (promise)',
  data: 'Data',
  timeout: 'Script'
}

const EMPTY_DRILL: DrillState = { level: 0, path: [] }

/** Template output for the data: the HTML, or an error. */
export function renderCodeTemplate(html: string, data: CodeData, env: { format(v: unknown, f?: string): string; resource(name: string): string | undefined }) {
  const stats = rowStats(data)
  const rowStyles = data.rows.map((r) => styleText(rowVars(r, data, stats)))
  if (!html.trim()) return { html: '', rowStyles, warnings: [] as string[] }
  const root = templateContext(data)
  const warnings: string[] = []
  const out = evaluateTemplate(html, root, env, {
    rowAttributes: (row: CodeRow) => ({ attrs: rowAttrs(row, data), style: rowStyles[row.index] ?? '' }),
    onMissing: (name, line, column) => warnings.push(`Unknown name "${name}" (line ${line}, column ${column})`)
  })
  return { html: out, rowStyles, warnings }
}

export function rowAttrs(row: CodeRow, data: CodeData): Record<string, string> {
  const a: Record<string, string> = { 'data-row': String(row.index), 'data-depth': String(row.depth) }
  if (data.hasSelection) a['data-selected'] = String(row.selected)
  if (data.hasHighlight) a['data-highlighted'] = String(row.highlighted === true)
  if (row.canDrill) a['data-can-drill'] = 'true'
  return a
}

/**
 * The saved drill state (lumenCode.drill) drives the runtime drill state whenever they differ after a document change:
 * the first render, undo / redo, a reopened file. Drill changes made on the page are saved by report/runtime.ts setDrill.
 */
function useSavedDrill(visualJson: any, ctx: VisualHostContext): void {
  const docText = readDrillText(visualJson)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  useEffect(() => {
    const c = ctxRef.current
    if ((serializeDrill(c.drill) ?? '') === docText) return
    const d = parseDrill(docText)
    c.setDrill(d ? { ...EMPTY_DRILL, ...d, drillMode: c.drill.drillMode } : { ...EMPTY_DRILL, drillMode: c.drill.drillMode })
  }, [docText, visualJson])
}

/** What the editor shows next to the preview (Data tab, problems). */
export interface CodeVisualStatus {
  error: CodeVisualError | null
  /** template names that resolved to nothing, CSS warnings */
  warnings: Array<{ phase: 'template' | 'css'; message: string; line?: number; column?: number }>
  data?: CodeData
  vars?: Record<string, string>
  rowStyles?: string[]
}

export function CodeVisual({ visual, pageName, width, height, ctx, onStatus }: VisualProps & { onStatus?(s: CodeVisualStatus): void }) {
  const json = visual.json
  const fmt = useMemo(() => readCodeFormat(json, ctx.theme), [json, ctx.theme])
  const src = useMemo(() => readCodeSource(json), [json])
  const selKey = ctx.selection.map(identityKey).join('|')
  const q = useVisualQuery(json, ctx, () => queryCodeData(json, ctx, fmt), selKey)
  useSavedDrill(json, ctx)
  const theme = useMemo(() => themeInfo(ctx.theme), [ctx.theme])

  // JSX: transpiled lazily (the Sucrase chunk loads on first use)
  const [tx, setTx] = useState<TranspileResult | undefined>(() => (src.jsx ? cachedTranspile(src.jsx) : undefined))
  useEffect(() => {
    if (!src.jsx) return setTx(undefined)
    const hit = cachedTranspile(src.jsx)
    if (hit) return setTx(hit)
    let live = true
    void transpileJsx(src.jsx).then((r) => live && setTx(r))
    return () => {
      live = false
    }
  }, [src.jsx])

  // registered report images referenced by the code, as data: URIs (the frame cannot load app URLs)
  const names = useMemo(() => resourceNames(src.html + '\n' + src.jsx + '\n' + src.css), [src])
  const [resources, setResources] = useState<Record<string, string> | null>(names.length ? null : {})
  useEffect(() => {
    if (!names.length) return setResources({})
    let live = true
    void loadResources(names, ctx.report).then((r) => live && setResources(r))
    return () => {
      live = false
    }
  }, [names, ctx.report])

  const data = q.ok ? q.data : undefined
  const tpl = useMemo(() => {
    if (!data) return undefined
    try {
      return { ok: true as const, ...renderCodeTemplate(src.html, data.data, { format: (v, f) => ctx.format(v as never, f), resource: (n) => resources?.[n] }) }
    } catch (e) {
      const t = e instanceof TemplateError ? e : undefined
      return { ok: false as const, error: { phase: 'template' as const, message: t ? t.message.replace(/ \(line \d+, column \d+\)$/, '') : String(e), line: t?.line, column: t?.column } }
    }
  }, [data, src.html, ctx, resources])
  const cssError = useMemo(() => checkCss(src.css).find((i) => i.severity === 'error'), [src.css])

  const [frameError, setFrameError] = useState<CodeVisualError | null>(null)
  const [runKey, setRunKey] = useState(0)

  const hostError: CodeVisualError | null = !q.ok
    ? { phase: 'data', message: q.error }
    : tpl && !tpl.ok
      ? tpl.error
      : cssError
        ? { phase: 'css', message: cssError.message, line: cssError.line, column: cssError.column }
        : tx && !tx.ok
          ? { phase: 'transpile', message: tx.message, line: tx.line, column: tx.column }
          : null
  const error = hostError ?? frameError

  // ---- frame lifecycle ---------------------------------------------------------------------
  const boxRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<CodeFrameHost | null>(null)
  const [rendered, setRendered] = useState(false)
  const seq = useRef(0)
  const live = useRef({ ctx, q: data as CodeQuery | undefined, name: visual.name })
  live.current = { ctx, q: data, name: visual.name }
  const title = String(json?.visual?.visualContainerObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value ?? '').replace(/^'|'$/g, '') || 'Code visual'

  const onMessage = useCallback((m: FrameMessage) => {
    const { ctx: c, q: cq, name } = live.current
    const rect = hostRef.current?.iframe.getBoundingClientRect()
    const scale = rect && hostRef.current!.iframe.offsetWidth ? rect.width / hostRef.current!.iframe.offsetWidth : 1
    const toClient = (x: number, y: number) => ({ x: (rect?.left ?? 0) + x * scale, y: (rect?.top ?? 0) + y * scale })
    const idOf = (key: string) => cq?.identities.get(key)
    const levels = drillLevelExprs(json, c)
    switch (m.type) {
      case 'rendered':
        setRendered(true)
        setFrameError(null)
        return
      case 'error':
        if (m.seq !== seq.current && m.phase !== 'promise' && m.phase !== 'runtime') return
        setFrameError({ phase: m.phase, message: m.message, line: m.line, column: m.column })
        setRendered(true)
        return
      case 'select': {
        const ids = m.keys.map(idOf).filter((x): x is NonNullable<typeof x> => !!x && x.fields.length > 0)
        if (!ids.length) return
        // drill mode (header "Drill down" toggled): a click drills instead of selecting, like native visuals
        if (c.drill.drillMode && ids.length === 1 && !m.multi) {
          const next = drillInto(c.drill, levels, ids[0])
          if (next) return c.setDrill(next)
        }
        c.showTooltip(null)
        c.select(ids, { multi: m.multi })
        return
      }
      case 'clear':
        if (c.selection.length) c.select([])
        return
      case 'tooltip': {
        const p = toClient(m.x, m.y)
        const items = m.items ?? (m.key ? (cq?.tooltip(m.key) ?? []) : [])
        if (!items.length) return c.showTooltip(null)
        c.showTooltip({ x: p.x, y: p.y, items, ...(m.key && idOf(m.key) ? { identity: idOf(m.key) } : {}) })
        return
      }
      case 'tooltipHide':
        return c.showTooltip(null)
      case 'menu': {
        const p = toClient(m.x, m.y)
        const id = m.key ? idOf(m.key) : undefined
        c.showTooltip(null)
        const row = m.key ? cq?.data.rows.find((r) => r.key === m.key) : undefined
        const entries = c.mode === 'edit' ? [{ label: 'Edit code', onClick: () => codeVisualActions().openEditor(name) }] : undefined
        c.showContextMenu({ x: p.x, y: p.y, ...(id && id.fields.length ? { identity: id, target: 'dataPoint' as const, value: row?.label } : { target: 'empty' as const }), ...(entries ? { entries } : {}) })
        return
      }
      case 'drill': {
        const id = idOf(m.key)
        const next = id ? drillInto(c.drill, levels, id) : undefined
        if (next) c.setDrill(next)
        return
      }
      case 'drillUp': {
        const next = drillUp(c.drill)
        if (next) c.setDrill(next)
        return
      }
      case 'nextLevel': {
        const next = nextLevel(c.drill, levels.length)
        if (next) c.setDrill(next)
        return
      }
      case 'expand': {
        const next = expandNextLevel(c.drill, levels.length)
        if (next) c.setDrill(next)
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json])
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const h = new CodeFrameHost(box, title, {
      message: (m) => onMessageRef.current(m),
      timeout: () => {
        setFrameError({ phase: 'timeout', message: 'The visual’s code stopped responding and was stopped (an endless loop or a very long computation).' })
        setRendered(true)
      }
    })
    hostRef.current = h
    return () => {
      h.destroy()
      if (hostRef.current === h) hostRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])

  useEffect(() => {
    if (hostRef.current) hostRef.current.iframe.title = title
  }, [title])

  // ---- send the render -----------------------------------------------------------------------
  const ready = !!data && !!tpl?.ok && resources !== null && (!src.jsx || !!tx)
  useEffect(() => {
    const h = hostRef.current
    if (!h || !ready || hostError || !data || !tpl?.ok) return
    const d = data.data
    seq.current++
    h.render({
      seq: seq.current,
      mode: src.jsx && tx?.ok ? 'jsx' : 'html',
      html: tpl.html,
      css: src.css,
      ...(src.jsx && tx?.ok ? { code: tx.code } : {}),
      vars: rootVars(d, theme, { width, height }),
      rowStyles: tpl.rowStyles,
      data: d,
      theme,
      resources: resources ?? {},
      state: { level: d.drill.level, hasHighlight: d.hasHighlight, hasSelection: d.hasSelection, editing: ctx.mode === 'edit', overflow: fmt.overflow, rowTooltips: fmt.rowTooltips }
    })
    // size changes are followed by the frame itself (ResizeObserver): not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hostError, data, tpl, src, tx, theme, resources, fmt, ctx.mode, runKey])

  useReadyHold(rendered || !!hostError)

  const cssWarnings = useMemo(() => checkCss(src.css).filter((i) => i.severity === 'warning'), [src.css])
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  useEffect(() => {
    if (!onStatusRef.current) return
    const d = data?.data
    const warnings: CodeVisualStatus['warnings'] = [
      ...(tpl?.ok ? tpl.warnings.map((w) => {
        const m = /\(line (\d+), column (\d+)\)$/.exec(w)
        return { phase: 'template' as const, message: w.replace(/ \(line \d+, column \d+\)$/, ''), ...(m ? { line: Number(m[1]), column: Number(m[2]) } : {}) }
      }) : []),
      ...cssWarnings.map((w) => ({ phase: 'css' as const, message: w.message, line: w.line, column: w.column }))
    ]
    onStatusRef.current({ error, warnings, data: d, vars: d ? rootVars(d, theme, { width, height }) : undefined, rowStyles: tpl?.ok ? tpl.rowStyles : undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error?.message, error?.line, error?.phase, tpl, cssWarnings, data, theme, width, height])

  // ---- edit mode: forward pointer input from the overlay ----------------------------------------
  const forward = (kind: 'click' | 'move' | 'leave' | 'menu' | 'wheel' | 'dblclick', e: ReactMouseEvent, extra: { dx?: number; dy?: number } = {}) => {
    const h = hostRef.current
    if (!h) return
    const r = h.iframe.getBoundingClientRect()
    const scale = h.iframe.offsetWidth ? r.width / h.iframe.offsetWidth : 1
    h.post({ type: 'pointer', kind, x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, ...extra })
  }
  const moveFrame = useRef(0)
  const editing = ctx.mode === 'edit'

  const noCode = !src.html.trim() && !src.jsx.trim()
  return (
    <div className="wbi-codevisual" style={{ width, height }} data-code-state={error ? 'error' : rendered ? 'rendered' : 'loading'} data-code-mode={src.jsx ? 'jsx' : 'html'}>
      <div ref={boxRef} className="wbi-codevisual__box" style={{ visibility: error ? 'hidden' : undefined }} />
      {editing && !error && (
        <div
          className="wbi-codevisual__overlay"
          onClick={(e) => forward('click', e)}
          onDoubleClick={(e) => {
            // double-click opens the code editor (the click itself was forwarded already)
            e.stopPropagation()
            codeVisualActions().openEditor(visual.name)
          }}
          onMouseMove={(e) => {
            const ev = { clientX: e.clientX, clientY: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey } as ReactMouseEvent
            cancelAnimationFrame(moveFrame.current)
            moveFrame.current = requestAnimationFrame(() => forward('move', ev))
          }}
          onMouseLeave={(e) => forward('leave', e)}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            forward('menu', e)
          }}
          onWheel={(e) => forward('wheel', e, { dx: e.deltaX, dy: e.deltaY })}
        />
      )}
      {noCode && !error && (
        <div className="wbi-codevisual__empty">
          <div className="wbi-codevisual__empty-title">This code visual has no code yet</div>
          {editing && height > 70 ? (
            <div className="wbi-codevisual__error-actions">
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => codeVisualActions().chooseTemplate(pageName, visual.name)}>
                Choose a template
              </button>
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => codeVisualActions().openEditor(visual.name, pageName)}>
                Edit code
              </button>
            </div>
          ) : null}
        </div>
      )}
      {error && <CodeErrorState error={error} height={height} onRetry={() => (setFrameError(null), setRendered(false), setRunKey((k) => k + 1))} onEdit={editing ? () => codeVisualActions().openEditor(visual.name) : undefined} />}
      {!error && data?.data.truncated && height > 60 && <div className="wbi-codevisual__notice">Showing the first {data.data.rowLimit.toLocaleString('en-US')} rows</div>}
    </div>
  )
}

function CodeErrorState({ error, height, onRetry, onEdit }: { error: CodeVisualError; height: number; onRetry(): void; onEdit?: () => void }) {
  const where = error.line ? ` at line ${error.line}${error.column ? `, column ${error.column}` : ''}` : ''
  return (
    <div className="wbi-codevisual__error" role="alert">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="#A4262C" strokeWidth="1.2" />
        <path d="M10 5.5v6" stroke="#A4262C" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="0.9" fill="#A4262C" />
      </svg>
      <div className="wbi-codevisual__error-title">
        {PHASE_LABEL[error.phase]} error{where}
      </div>
      {height > 90 && <div className="wbi-codevisual__error-msg">{error.message}</div>}
      {height > 60 && (
        <div className="wbi-codevisual__error-actions">
          {(error.phase === 'timeout' || error.phase === 'runtime' || error.phase === 'promise') && (
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onRetry}>
              Run again
            </button>
          )}
          {onEdit && (
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onEdit}>
              Edit code
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Code visual frame runtime. Runs inside the sandboxed iframe (`sandbox="allow-scripts"`, opaque origin, served by the
 * main process from `lumen-frame://code/` with a CSP that allows no network, see src/main/codeFrame.ts). Built as a
 * classic script (IIFE) by the `codeframe` plugin in electron.vite.config.ts; React is a second script (react.ts)
 * loaded only when a visual has JSX.
 *
 * It receives `render` messages from its parent (validated by core/codevisual/protocol.ts), draws the template HTML
 * or runs the author's component, applies the stylesheet and the CSS variables, and reports interactions back.
 */
import { PROTOCOL, validateHostMessage, type ErrorPhase, type FrameMessage, type RenderMessage, type TooltipLine } from '@core/codevisual/protocol'
import type { CodeData, CodeRow } from '@core/codevisual/types'
import { formatValue } from '@core/format/format'
import fontRules from '../src/assets/fonts/selawik/selawik.css?raw'

/**
 * The report's Segoe UI stand-in faces (the app's selawik.css). The font files are served next to the frame by the
 * main process (lumen-frame://<host>/fonts/…, cached by the browser), so each frame does not parse them again.
 */
const fontCss = fontRules.replace(/url\('\.\/([\w.-]+\.woff2)'\)/g, (_m, f: string) => `url('fonts/${f}')`)

type ReactNS = typeof import('react')
type ReactDOMClientNS = typeof import('react-dom/client')
interface ReactBundle {
  React: ReactNS
  ReactDOMClient: ReactDOMClientNS
  JSXRuntime: unknown
}

const w = window as unknown as { __lumenReact?: ReactBundle }

let token = ''
let n = 0
let current: RenderMessage | null = null

function post(msg: FrameMessage): void {
  if (!token) return
  parent.postMessage({ p: PROTOCOL, token, n: ++n, msg }, '*')
}

// ---------------------------------------------------------------------------------------------
// document setup
// ---------------------------------------------------------------------------------------------

const BASE_CSS = `
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;}
*,*::before,*::after{box-sizing:border-box;}
#lumen-root{position:relative;width:100%;height:100%;container-type:size;container-name:visual;overflow:hidden;
  font-family:var(--theme-font);color:var(--theme-foreground);font-size:var(--theme-label-size,12px);line-height:1.35;
  -webkit-font-smoothing:antialiased;user-select:none;}
#lumen-root[data-overflow="visible"]{overflow:visible;}
#lumen-root[data-overflow="auto"]{overflow:auto;}
#lumen-root:focus-visible{outline:none;}
[data-select],[data-drill],[data-drill-up],[data-expand],[data-next-level],[data-clear]{cursor:pointer;}
[data-lumen-focus]:focus-visible{outline:2px solid var(--theme-foreground, #252423);outline-offset:-2px;}
.lumen-error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  padding:8px;text-align:center;font:12px "Segoe UI","Selawik",sans-serif;color:#605E5C;}
.lumen-error b{color:#A4262C;font-weight:600;}
::-webkit-scrollbar{width:8px;height:8px;}::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--theme-foreground,#252423) 28%,transparent);border-radius:4px;}`

function styleEl(id: string, text = ''): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  if (el.textContent !== text) el.textContent = text
  return el
}

styleEl('lumen-fonts', fontCss)
styleEl('lumen-base', BASE_CSS)
const authorStyle = styleEl('lumen-author')
const root = document.createElement('div')
root.id = 'lumen-root'
document.body.appendChild(root)

// ---------------------------------------------------------------------------------------------
// size: --width / --height and the JSX `size` prop follow the frame (also between renders)
// ---------------------------------------------------------------------------------------------

let size = { width: window.innerWidth, height: window.innerHeight }
const sizeListeners = new Set<() => void>()
function applySize(): void {
  const s = { width: Math.round(root.clientWidth || window.innerWidth), height: Math.round(root.clientHeight || window.innerHeight) }
  root.style.setProperty('--width', `${s.width}px`)
  root.style.setProperty('--height', `${s.height}px`)
  if (s.width !== size.width || s.height !== size.height) {
    size = s
    for (const l of sizeListeners) l()
  }
}
new ResizeObserver(applySize).observe(root)

// ---------------------------------------------------------------------------------------------
// errors (line / column mapped back to the author's source)
// ---------------------------------------------------------------------------------------------

/** Line offset of `new Function` bodies: Chromium prefixes "function anonymous(args\n) {\n" (2 lines). */
const FN_LINE_OFFSET = 2

function locate(err: unknown): { line?: number; column?: number } {
  const stack = err instanceof Error ? (err.stack ?? '') : ''
  const m = /visual\.jsx:(\d+):(\d+)/.exec(stack)
  if (!m) return {}
  const line = Number(m[1]) - FN_LINE_OFFSET
  return line > 0 ? { line, column: Number(m[2]) } : {}
}

function showError(phase: ErrorPhase, message: string, where: { line?: number; column?: number } = {}): void {
  const seq = current?.seq ?? 0
  post({ type: 'error', seq, phase, message, ...where })
  // the host draws the readable error state; the frame clears its content so no half-drawn output remains
}

window.addEventListener('error', (e) => {
  const where = e.error ? locate(e.error) : e.filename?.includes('visual.jsx') ? { line: e.lineno - FN_LINE_OFFSET, column: e.colno } : {}
  showError('runtime', e.message || String(e.error), where)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  showError('promise', r instanceof Error ? r.message : String(r), locate(r))
})

// ---------------------------------------------------------------------------------------------
// interaction
// ---------------------------------------------------------------------------------------------

/** set while a click is dispatched; the author's handlers (or the declarative attributes) mark it handled */
let handledInEvent = false

function rowByIndex(i: number): CodeRow | undefined {
  return current?.data.rows[i]
}

function rowOf(el: Element | null): { row: CodeRow; el: HTMLElement } | undefined {
  const r = el?.closest?.('[data-row]') as HTMLElement | null
  if (!r) return undefined
  const row = rowByIndex(Number(r.dataset.row))
  return row ? { row, el: r } : undefined
}

function keyOf(r: CodeRow | string | number | null | undefined): string | undefined {
  if (r === null || r === undefined) return undefined
  if (typeof r === 'string') return r
  if (typeof r === 'number') return rowByIndex(r)?.key
  return typeof r.key === 'string' ? r.key : undefined
}

const api = {
  select(rows: CodeRow | CodeRow[] | string | null | undefined, opts?: { multi?: boolean }): void {
    handledInEvent = true
    const list = Array.isArray(rows) ? rows : rows === null || rows === undefined ? [] : [rows]
    const keys = list.map((r) => keyOf(r)).filter((k): k is string => !!k)
    if (!keys.length) post({ type: 'clear' })
    else post({ type: 'select', keys, multi: !!opts?.multi })
  },
  clear(): void {
    handledInEvent = true
    post({ type: 'clear' })
  },
  drill(row: CodeRow | string): void {
    handledInEvent = true
    const key = keyOf(row)
    if (key) post({ type: 'drill', key })
  },
  drillUp(): void {
    handledInEvent = true
    post({ type: 'drillUp' })
  },
  expandNextLevel(): void {
    handledInEvent = true
    post({ type: 'expand' })
  },
  goToNextLevel(): void {
    handledInEvent = true
    post({ type: 'nextLevel' })
  },
  tooltip(target: CodeRow | TooltipLine[] | null, ev?: { clientX: number; clientY: number }): void {
    if (!target) return post({ type: 'tooltipHide' })
    const x = ev?.clientX ?? lastPointer.x
    const y = ev?.clientY ?? lastPointer.y
    if (Array.isArray(target)) post({ type: 'tooltip', x, y, items: target.slice(0, 40).map((t) => ({ label: String(t.label ?? '').slice(0, 500), value: String(t.value ?? '').slice(0, 500) })) })
    else {
      const key = keyOf(target)
      if (key) post({ type: 'tooltip', x, y, key })
    }
  }
}

const lastPointer = { x: 0, y: 0 }

function onClick(ev: MouseEvent): void {
  const t = ev.target as Element | null
  const multi = ev.ctrlKey || ev.metaKey
  const hit = (sel: string) => t?.closest?.(sel) as HTMLElement | null
  if (hit('[data-drill-up]')) return api.drillUp()
  if (hit('[data-expand]')) return api.expandNextLevel()
  if (hit('[data-next-level]')) return api.goToNextLevel()
  if (hit('[data-clear]')) return api.clear()
  const r = rowOf(t)
  if (r && hit('[data-drill]') && r.el.contains(hit('[data-drill]'))) return api.drill(r.row)
  if (r && hit('[data-select]') && r.el.contains(hit('[data-select]'))) return api.select(r.row, { multi })
  // JSX handlers ran before this (React listens on its root container); a click nobody handled on empty space clears
  if (!handledInEvent && !hit('a,button,input,select,textarea,[data-row]') && current?.data.hasSelection) api.clear()
}

document.addEventListener('click', (ev) => {
  onClick(ev)
  handledInEvent = false
})
// links and forms never navigate the frame (it would only replace the visual with an error page: the network is blocked)
document.addEventListener(
  'click',
  (ev) => {
    const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (a && !a.getAttribute('href')!.startsWith('#')) ev.preventDefault()
  },
  true
)
document.addEventListener('submit', (ev) => ev.preventDefault(), true)
document.addEventListener('mousedown', () => (handledInEvent = false), true)
document.addEventListener('click', () => (handledInEvent = false), true)

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return
  const t = ev.target as HTMLElement | null
  if (!t?.matches?.('[data-lumen-focus]')) return
  ev.preventDefault()
  t.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey }))
})

let tipKey: string | undefined
document.addEventListener('mousemove', (ev) => {
  lastPointer.x = ev.clientX
  lastPointer.y = ev.clientY
  const t = ev.target as Element | null
  const r = rowOf(t)
  const off = !r || !!t?.closest?.('[data-no-tooltip]') || root.dataset.rowTooltips === 'off'
  if (off) {
    if (tipKey !== undefined) {
      tipKey = undefined
      post({ type: 'tooltipHide' })
    }
    return
  }
  tipKey = r!.row.key
  post({ type: 'tooltip', key: r!.row.key, x: ev.clientX, y: ev.clientY })
})
document.addEventListener('mouseleave', () => {
  tipKey = undefined
  post({ type: 'tooltipHide' })
})
document.addEventListener('contextmenu', (ev) => {
  ev.preventDefault()
  const r = rowOf(ev.target as Element | null)
  post({ type: 'menu', x: ev.clientX, y: ev.clientY, ...(r ? { key: r.row.key } : {}) })
})

// edit mode: the canvas keeps the pointer (to select / move the visual) and forwards clicks and moves
let hovered: Element[] = []
function setHover(el: Element | null): void {
  const chain: Element[] = []
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) chain.push(e)
  for (const h of hovered) if (!chain.includes(h)) h.removeAttribute('data-lumen-hover')
  for (const c of chain) c.setAttribute('data-lumen-hover', '')
  hovered = chain
}

function forwardPointer(m: Extract<ReturnType<typeof validateHostMessage>, { type: 'pointer' }>): void {
  const el = document.elementFromPoint(m.x, m.y)
  const init: MouseEventInit = { bubbles: true, cancelable: true, clientX: m.x, clientY: m.y, ctrlKey: m.ctrl, metaKey: m.ctrl, shiftKey: m.shift, view: window }
  switch (m.kind) {
    case 'move':
      setHover(el)
      el?.dispatchEvent(new MouseEvent('mouseover', init))
      el?.dispatchEvent(new MouseEvent('mousemove', init))
      break
    case 'leave':
      setHover(null)
      document.dispatchEvent(new MouseEvent('mouseleave', init))
      break
    case 'click':
      el?.dispatchEvent(new MouseEvent('mousedown', init))
      el?.dispatchEvent(new MouseEvent('mouseup', init))
      el?.dispatchEvent(new MouseEvent('click', init))
      break
    case 'dblclick':
      el?.dispatchEvent(new MouseEvent('dblclick', init))
      break
    case 'menu':
      el?.dispatchEvent(new MouseEvent('contextmenu', init))
      break
    case 'wheel': {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e)
        if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)) {
          e.scrollBy(m.dx ?? 0, m.dy ?? 0)
          break
        }
      }
      break
    }
  }
}

// ---------------------------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------------------------

/** `:hover` also matches the hover the edit-mode overlay forwards (data-lumen-hover). */
export function withForwardedHover(css: string): string {
  return css.replace(/:hover\b/g, ':is(:hover,[data-lumen-hover])')
}

function applyRoot(m: RenderMessage): void {
  const prev = current?.vars ?? {}
  for (const k of Object.keys(prev)) if (!(k in m.vars) && k !== '--width' && k !== '--height') root.style.removeProperty(k)
  for (const [k, v] of Object.entries(m.vars)) if (k !== '--width' && k !== '--height') root.style.setProperty(k, v)
  root.dataset.level = String(m.state.level)
  root.dataset.hasHighlight = String(m.state.hasHighlight)
  root.dataset.hasSelection = String(m.state.hasSelection)
  root.dataset.overflow = m.state.overflow
  root.dataset.mode = m.mode
  root.dataset.rowTooltips = m.state.rowTooltips ? 'on' : 'off'
  authorStyle.textContent = withForwardedHover(m.css)
  applySize()
}

/** Elements with data-select / data-drill become keyboard-focusable buttons. */
function markFocusable(): void {
  for (const el of Array.from(root.querySelectorAll('[data-select],[data-drill],[data-drill-up],[data-expand],[data-next-level],[data-clear]'))) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
    el.setAttribute('data-lumen-focus', '')
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button')
  }
}

let reactRoot: { render(n: unknown): void; unmount(): void } | null = null
let jsxHost: HTMLDivElement | null = null

function renderHtml(m: RenderMessage): void {
  if (reactRoot) {
    reactRoot.unmount()
    reactRoot = null
    jsxHost = null
  }
  root.innerHTML = m.html
  markFocusable()
}

let reactLoading: Promise<ReactBundle> | null = null
function loadReact(): Promise<ReactBundle> {
  if (w.__lumenReact) return Promise.resolve(w.__lumenReact)
  reactLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'react.js'
    s.onload = () => (w.__lumenReact ? resolve(w.__lumenReact) : reject(new Error('React runtime missing')))
    s.onerror = () => reject(new Error('The React runtime could not be loaded'))
    document.head.appendChild(s)
  })
  return reactLoading
}

const moduleCache = new Map<string, unknown>()

function compile(code: string, bundle: ReactBundle): unknown {
  const hit = moduleCache.get(code)
  if (hit) return hit
  const module = { exports: {} as Record<string, unknown> }
  const require = (name: string): unknown => {
    if (name === 'react') return bundle.React
    if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') return bundle.JSXRuntime
    throw new Error(`Only "react" can be imported in a code visual (not "${name}")`)
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('require', 'module', 'exports', 'React', `${code}\n//# sourceURL=visual.jsx`)
  fn(require, module, module.exports, bundle.React)
  const exp = module.exports as Record<string, unknown>
  const comp = exp.default ?? exp.Visual ?? (typeof module.exports === 'function' ? module.exports : undefined)
  if (typeof comp !== 'function') throw new Error('The JSX must export a component: export default function Visual(props) { … }')
  if (moduleCache.size > 8) moduleCache.clear()
  moduleCache.set(code, comp)
  return comp
}

/** The props the author's component receives. */
function buildProps(m: RenderMessage, sz: { width: number; height: number }): Record<string, unknown> {
  const d: CodeData = m.data
  const rows = d.rows.map((r, i) => {
    const o: Record<string, unknown> = { ...r, vars: styleVars(m.rowStyles[i] ?? '') }
    for (const c of d.columns) {
      const cell = r.cells[c.name]
      if (cell === undefined) continue
      if (!(c.name in o)) o[c.name] = cell
      if (!(c.js in o)) o[c.js] = cell
    }
    return o
  })
  const values: Record<string, unknown> = {}
  for (const c of d.columns) {
    if (c.kind !== 'value' || !d.totals[c.name]) continue
    values[c.name] = d.totals[c.name]
    values[c.js] = d.totals[c.name]
  }
  const selectedKeys = new Set(d.rows.filter((r) => r.selected).map((r) => r.key))
  return {
    rows,
    columns: d.columns,
    values,
    measures: values,
    totals: values,
    theme: m.theme,
    size: sz,
    params: d.params,
    drillInfo: d.drill,
    level: d.drill.level,
    breadcrumb: d.drill.breadcrumb,
    truncated: d.truncated,
    hasHighlight: d.hasHighlight,
    selection: d.rows.filter((r) => r.selected),
    html: m.html,
    select: api.select,
    clear: api.clear,
    drill: api.drill,
    drillUp: api.drillUp,
    expandNextLevel: api.expandNextLevel,
    goToNextLevel: api.goToNextLevel,
    tooltip: api.tooltip,
    isSelected: (r: CodeRow | string) => selectedKeys.has(keyOf(r) ?? ''),
    isHighlighted: (r: CodeRow) => (d.hasHighlight ? r.highlighted === true : true),
    format: formatHelper(d),
    resource: (name: string) => m.resources[name],
    rowStyle: (r: { vars?: Record<string, string> }) => r.vars ?? {},
    /** attributes that make an element the row's element (declarative data-select / data-drill, default tooltip, CSS variables) */
    rowProps: (r: CodeRow & { vars?: Record<string, string> }) => ({
      'data-row': r.index,
      'data-depth': r.depth,
      ...(d.hasSelection ? { 'data-selected': String(r.selected) } : {}),
      ...(d.hasHighlight ? { 'data-highlighted': String(r.highlighted === true) } : {}),
      ...(r.canDrill ? { 'data-can-drill': 'true' } : {}),
      style: r.vars ?? {}
    })
  }
}

function styleVars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(';')) {
    const i = part.indexOf(':')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

/** ISO date text (as cells carry dates) → Date with UTC fields = wall clock (Lumen's value contract). */
function isoToDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))) : null
}

/**
 * format(value, formatString?) in JSX: Lumen's own formatter (core/format, bundled into the frame), so numbers match
 * native visuals. A cell without a format string returns its `formatted` text (formatted by the host).
 */
function formatHelper(d: CodeData) {
  return (v: unknown, fmt?: string): string => {
    let type: string | undefined
    if (v && typeof v === 'object' && 'formatted' in (v as object)) {
      const c = v as { formatted: string; value: unknown; type: string }
      if (!fmt) return c.formatted
      v = c.value
      type = c.type
    }
    if (v === null || v === undefined) return ''
    if (typeof v === 'string' && (type === 'date' || (fmt && /^\d{4}-\d{2}-\d{2}/.test(v)))) {
      const dt = isoToDate(v)
      if (dt) return formatValue(dt, fmt)
    }
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return formatValue(v, fmt ?? d.columns.find((c) => c.kind === 'value')?.formatString)
    return String(v)
  }
}

function renderJsx(m: RenderMessage): Promise<void> {
  return loadReact().then((bundle) => {
    const { React, ReactDOMClient } = bundle
    let Comp: unknown
    try {
      Comp = compile(m.code ?? '', bundle)
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { phase: 'runtime' as ErrorPhase })
    }
    if (!reactRoot || !jsxHost || !root.contains(jsxHost)) {
      root.innerHTML = ''
      jsxHost = document.createElement('div')
      jsxHost.id = 'lumen-jsx'
      jsxHost.style.cssText = 'display:contents'
      root.appendChild(jsxHost)
      reactRoot = ReactDOMClient.createRoot(jsxHost, {
        onUncaughtError: (err: unknown) => showError('runtime', err instanceof Error ? err.message : String(err), locate(err)),
        onCaughtError: (err: unknown) => showError('runtime', err instanceof Error ? err.message : String(err), locate(err))
      } as never)
    }
    const Sized = () => {
      const [sz, setSz] = React.useState(size)
      React.useEffect(() => {
        const l = () => setSz(size)
        sizeListeners.add(l)
        l()
        return () => void sizeListeners.delete(l)
      }, [])
      React.useEffect(() => {
        markFocusable()
      })
      return React.createElement(Comp as never, buildProps(m, sz) as never)
    }
    reactRoot.render(React.createElement(Sized))
  })
}

/** After two frames (layout + paint); a timer fallback because hidden windows do not run animation frames. */
function afterPaint(fn: () => void): void {
  let done = false
  const fire = () => {
    if (done) return
    done = true
    fn()
  }
  requestAnimationFrame(() => requestAnimationFrame(fire))
  setTimeout(fire, 120)
}

async function render(m: RenderMessage): Promise<void> {
  current = m
  applyRoot(m)
  try {
    if (m.mode === 'jsx') await renderJsx(m)
    else renderHtml(m)
  } catch (e) {
    const phase = (e as { phase?: ErrorPhase }).phase ?? 'runtime'
    showError(phase, e instanceof Error ? e.message : String(e), locate(e))
    return
  }
  await document.fonts.ready.catch(() => undefined)
  afterPaint(() => {
    if (current === m) post({ type: 'rendered', seq: m.seq, height: root.scrollHeight })
  })
}

window.addEventListener('message', (ev) => {
  if (ev.source !== parent) return
  const m = validateHostMessage(ev.data)
  if (!m) return
  if (!token) token = m.token
  else if (m.token !== token) return
  if (m.type === 'render') void render(m)
  else if (m.type === 'pointer') forwardPointer(m)
  else if (m.type === 'ping') post({ type: 'pong', id: m.id })
})

parent.postMessage({ p: PROTOCOL, type: 'boot' }, '*')

import { useEffect, useMemo, useRef } from 'react'
import type { VisualProps, VisualHostContext } from '../contract'
import type { Scalar } from '@core/model/data'
import { identityKey, type DataPointIdentity } from '@core/report/sq'
import { evaluateField } from '../elements/evaluate'
import { buildSrcDoc, readHtmlContentOptions } from './htmlContentModel'
import { sanitizeHtml } from './htmlSanitize'
import { cellFormat, cellValue, runFieldQuery, type FieldQueryResult } from './fieldQuery'

export const HTML_ROLES = ['content', 'sampling']

let fontFaceCache: string | undefined
/** @font-face rules of the host page (bundled @fontsource fonts) so the iframe can use them. */
function hostFontFaces(): string {
  if (fontFaceCache !== undefined) return fontFaceCache
  let out = ''
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const r of Array.from(rules)) {
        if (!(r instanceof CSSFontFaceRule)) continue
        // url()s are relative to the stylesheet; the iframe document has a different base
        const base = sheet.href ?? document.baseURI
        const text = r.cssText.replace(/url\((["']?)([^"')]+)\1\)/g, (m, q: string, u: string) => {
          try {
            return `url(${q}${new URL(u, base).href}${q})`
          } catch {
            return m
          }
        })
        out += text + '\n'
        // Measures hard-code "Segoe UI" (often without fallbacks). On Linux, alias it to the bundled
        // Open Sans faces, preferring a locally installed Segoe UI / Selawik when present.
        if (/font-family:\s*["']?Open Sans/i.test(text)) {
          const aliased = text.replace(/font-family:\s*["']?Open Sans["']?/i, "font-family: 'Segoe UI'").replace(/src:\s*/i, "src: local('Segoe UI'), local('Selawik'), ")
          out += aliased + '\n'
          const w = /font-weight:\s*(\d+)/i.exec(text)?.[1]
          const named = w === '600' ? 'Segoe UI Semibold' : w === '700' ? 'Segoe UI Bold' : undefined
          if (named) out += aliased.replace("font-family: 'Segoe UI'", `font-family: '${named}'`).replace("local('Segoe UI')", `local('${named}')`) + '\n'
        }
      }
    }
  } catch {
    /* no DOM */
  }
  fontFaceCache = out
  return out
}

export interface HtmlEntries {
  entries: string[]
  identities: DataPointIdentity[]
  query?: FieldQueryResult
  error?: string
}

function asText(v: Scalar, ctx: VisualHostContext, fmt: string | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  return ctx.format(v, fmt)
}

export function queryHtmlEntries(visualJson: any, ctx: VisualHostContext): HtmlEntries {
  try {
    const q = runFieldQuery(visualJson, ctx, HTML_ROLES, { limit: 5000 })
    const contentFields = q.fields.filter((f) => f.projection.role === 'content')
    if (!contentFields.length) return { entries: [], identities: [] }
    const entries: string[] = []
    const identities: DataPointIdentity[] = []
    q.result.rows.forEach((row, i) => {
      const html = contentFields.map((f) => asText(cellValue(q, i, f), ctx, cellFormat(q, i, f))).join('')
      if (html === '' && contentFields.every((f) => f.kind === 'value')) return
      entries.push(html)
      identities.push({ fields: q.groups.map((g, gi) => ({ expr: g.expr, value: row[gi] ?? null })) })
    })
    return { entries, identities, query: q }
  } catch (e) {
    return { entries: [], identities: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export function HtmlContentVisual({ visual, width, height, ctx }: VisualProps) {
  const options = useMemo(() => readHtmlContentOptions(visual.json), [visual.json])
  const data = useMemo(() => queryHtmlEntries(visual.json, ctx), [visual.json, ctx])
  const css = useMemo(() => {
    if (options.stylesheetExpr) {
      const v = evaluateField(ctx, options.stylesheetExpr).value
      return typeof v === 'string' ? v : undefined
    }
    return options.stylesheet
  }, [options, ctx])
  const canSelect = data.identities.some((id) => id.fields.length > 0)
  const selected = new Set(ctx.selection.map(identityKey))
  const doc = useMemo(() => {
    const entries = data.entries.map((e) => (options.showRawHtml ? e : sanitizeHtml(e)))
    let html = buildSrcDoc({ entries, options, css, fontFaces: hostFontFaces(), sanitized: !options.showRawHtml })
    if (canSelect) {
      // mark selectable / dimmed entries (class attribute is ours, added after sanitization)
      html = html.replace(/<div class="htmlViewerEntry( raw)?" data-row="(\d+)">/g, (_m, raw: string | undefined, row: string) => {
        const id = data.identities[Number(row)]
        const dim = selected.size > 0 && id && !selected.has(identityKey(id))
        return `<div class="htmlViewerEntry${raw ?? ''} wbi-selectable${dim ? ' wbi-dim' : ''}" data-row="${row}">`
      })
    }
    return html
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, options, css, canSelect, [...selected].join('|')])

  const frame = useRef<HTMLIFrameElement>(null)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const dataRef = useRef(data)
  dataRef.current = data
  const optsRef = useRef(options)
  optsRef.current = options

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const attach = () => {
      const d = el.contentDocument
      if (!d) return
      d.addEventListener('click', (ev: MouseEvent) => {
        const c = ctxRef.current
        const target = ev.target as Element | null
        const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
        if (a) {
          ev.preventDefault()
          if (optsRef.current.hyperlinks && (c.mode === 'view' || ev.ctrlKey || ev.metaKey)) c.actions.openUrl(a.href)
          return
        }
        const entry = target?.closest?.('.htmlViewerEntry.wbi-selectable') as HTMLElement | null
        if (!entry) {
          if (c.selection.length) c.select([])
          return
        }
        const id = dataRef.current.identities[Number(entry.dataset.row)]
        if (!id) return
        const already = c.selection.some((s) => identityKey(s) === identityKey(id))
        if (ev.ctrlKey || ev.metaKey) c.select(already ? c.selection.filter((s) => identityKey(s) !== identityKey(id)) : [...c.selection, id], { multi: true })
        else c.select(already && c.selection.length === 1 ? [] : [id])
      })
      d.addEventListener('contextmenu', (ev: MouseEvent) => {
        ev.preventDefault()
        const r = el.getBoundingClientRect()
        ctxRef.current.showContextMenu({ x: r.left + ev.clientX, y: r.top + ev.clientY })
      })
    }
    el.addEventListener('load', attach)
    return () => el.removeEventListener('load', attach)
  }, [])

  if (data.error) {
    return <div style={{ width, height, padding: 8, color: '#A4262C', fontSize: 12, overflow: 'auto' }}>HTML Content: {data.error}</div>
  }
  return (
    <iframe
      ref={frame}
      title="HTML Content"
      sandbox="allow-same-origin"
      srcDoc={doc}
      // In edit mode the canvas must receive clicks (select / move the visual), so the frame is inert there.
      style={{ width, height, border: 0, display: 'block', background: 'transparent', colorScheme: 'light', pointerEvents: ctx.mode === 'edit' ? 'none' : undefined }}
    />
  )
}

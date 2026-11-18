/**
 * HTML Content (Daniel Marsh-Patrick's "HTML Content" custom visual) — options and document
 * assembly. Objects seen in PBIR:
 *   contentFormatting: showRawHtml, fontFamily, fontSize (pt), fontColor, align, hyperlinks, userSelect, noDataMessage
 *   stylesheet.stylesheet: CSS text, usually bound to a measure ({ expr: { Measure } })
 *   compatibility.legacyRendering (older entry layout; no visible effect for single-value content)
 * Roles: `content` (the HTML; measure or column), `sampling` (granularity columns → one entry per row).
 */
import { decodeLiteral } from '@core/report/literal'
import { preSanitize, sanitizeCssText } from './htmlSanitize'

export interface HtmlContentOptions {
  showRawHtml: boolean
  fontFamily: string
  /** pt */
  fontSize: number
  fontColor: string
  align: 'left' | 'center' | 'right' | 'justify'
  hyperlinks: boolean
  userSelect: boolean
  noDataMessage: string
  /** literal stylesheet (a measure-bound stylesheet is evaluated by the component) */
  stylesheet?: string
  stylesheetExpr?: any
}

function lit(raw: any): any {
  if (raw?.expr?.Literal) return decodeLiteral(raw.expr.Literal.Value)
  if (raw?.solid?.color?.expr?.Literal) return decodeLiteral(raw.solid.color.expr.Literal.Value)
  return undefined
}

export const HTML_CONTENT_DEFAULTS: Omit<HtmlContentOptions, 'stylesheet' | 'stylesheetExpr'> = {
  showRawHtml: false,
  fontFamily: "'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif",
  fontSize: 11,
  fontColor: '#000000',
  align: 'left',
  hyperlinks: false,
  userSelect: false,
  noDataMessage: 'No data available to display'
}

export function readHtmlContentOptions(visualJson: any): HtmlContentOptions {
  const o = visualJson?.visual?.objects ?? {}
  const cf: Record<string, any> = Object.assign({}, ...(o.contentFormatting ?? []).map((e: any) => e.properties ?? {}))
  const get = <T,>(k: string, fb: T): T => {
    const v = lit(cf[k])
    return (v === undefined || v === null ? fb : v) as T
  }
  const alignRaw = String(get('align', 'left')).toLowerCase()
  const ssRaw = o.stylesheet?.[0]?.properties?.stylesheet
  const ssExpr = ssRaw?.expr && !ssRaw.expr.Literal ? ssRaw.expr : undefined
  const ssLit = lit(ssRaw)
  return {
    showRawHtml: get<unknown>('showRawHtml', HTML_CONTENT_DEFAULTS.showRawHtml) === true,
    fontFamily: String(get('fontFamily', HTML_CONTENT_DEFAULTS.fontFamily)),
    fontSize: Number(get('fontSize', HTML_CONTENT_DEFAULTS.fontSize)) || HTML_CONTENT_DEFAULTS.fontSize,
    fontColor: String(get('fontColor', HTML_CONTENT_DEFAULTS.fontColor)),
    align: alignRaw === 'center' || alignRaw === 'right' || alignRaw === 'justify' ? alignRaw : 'left',
    hyperlinks: get<unknown>('hyperlinks', false) === true,
    userSelect: get<unknown>('userSelect', false) === true,
    noDataMessage: String(get('noDataMessage', HTML_CONTENT_DEFAULTS.noDataMessage)),
    stylesheet: typeof ssLit === 'string' ? ssLit : undefined,
    stylesheetExpr: ssExpr
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** CSS font stack with Linux fallbacks appended. */
function fontStack(f: string): string {
  return `${f}, 'Selawik', 'Open Sans', 'Noto Sans', sans-serif`
}

export interface SrcDocInput {
  entries: string[]
  options: HtmlContentOptions
  /** evaluated stylesheet text */
  css?: string
  /** @font-face rules copied from the host page so bundled fonts resolve inside the iframe */
  fontFaces?: string
  /** html entries are already sanitized (DOMPurify); otherwise preSanitize is applied */
  sanitized?: boolean
  selectable?: boolean
}

/** Full iframe document for the visual. */
export function buildSrcDoc(input: SrcDocInput): string {
  const o = input.options
  const body = input.entries.length
    ? input.entries
        .map((e, i) =>
          o.showRawHtml
            ? `<div class="htmlViewerEntry raw" data-row="${i}">${escapeHtml(e)}</div>`
            : `<div class="htmlViewerEntry" data-row="${i}">${input.sanitized ? e : preSanitize(e)}</div>`
        )
        .join('')
    : `<div class="htmlViewerNoData">${escapeHtml(o.noDataMessage)}</div>`
  const base = `
html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;}
body{overflow:auto;font-family:${fontStack(o.fontFamily)};font-size:${o.fontSize}pt;color:${o.fontColor};text-align:${o.align};
  -webkit-user-select:${o.userSelect ? 'text' : 'none'};user-select:${o.userSelect ? 'text' : 'none'};box-sizing:border-box;}
*,*::before,*::after{box-sizing:inherit;}
#htmlViewer{min-height:100%;}
.htmlViewerEntry{overflow-wrap:break-word;}
.htmlViewerEntry.raw{white-space:pre-wrap;font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:0.9em;}
.htmlViewerEntry.wbi-selectable{cursor:pointer;}
.htmlViewerEntry.wbi-dim{opacity:0.4;}
.htmlViewerNoData{color:#605E5C;padding:4px;}
::-webkit-scrollbar{width:8px;height:8px;}
::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.25);border-radius:4px;}
::-webkit-scrollbar-track{background:transparent;}`
  const css = input.css ? sanitizeCssText(input.css) : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>${input.fontFaces ?? ''}${base}</style>${css ? `<style>${css}</style>` : ''}</head><body><div id="htmlViewer">${body}</div></body></html>`
}

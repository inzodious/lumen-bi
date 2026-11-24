/**
 * Gradient paint pass: draws Lumen gradient fills (core/report/gradientFill.ts) on any visual, whatever it renders.
 *
 * A color property with a gradient keeps a solid fallback that is unique within the visual and its theme
 * (`gradientFallback(…, avoid)`), so wherever the visual drew that exact color, it drew this property. After the
 * visual renders, the pass looks for that color and swaps in the gradient:
 *
 *  - SVG `fill` / `stroke` (attribute or style) → `url(#…)` of a gradient in one shared, hidden `<defs>` (bounding-box
 *    units; a line with no height or width gets a user-space gradient along its length);
 *  - HTML `background-color` → a gradient background-image layer beneath any image the element has;
 *  - HTML `color` → gradient text (`background-clip: text`), keeping the element's own background as a lower layer.
 *
 * The element's alpha (PBI transparency already applied to the color) carries over to every stop. A MutationObserver
 * re-applies the pass to what the visual re-renders and undoes it on elements whose color changed. Borders and
 * outlines of HTML elements inside a visual stay solid; the container border (visual and group) is drawn by a masked
 * gradient layer instead (chrome.ts `gradientBorderLayer`).
 */
import { gradientCss, gradientId, svgGradientGeometry, type GradientFill } from '@core/report/gradientFill'
import { gradientOf, makePropContext } from '@core/report/props'
import { readFills } from '@core/report/gradientFill'
import type { ResolvedTheme } from '@core/report/theme'

/** '#RRGGBB' fallback → gradient, for the gradients that apply to a visual now. */
export type PaintMap = Map<string, GradientFill>

export function activeGradients(visualJson: any, theme: ResolvedTheme): PaintMap {
  const map: PaintMap = new Map()
  const fills = readFills(visualJson)
  if (!fills.length) return map
  const pc = makePropContext(visualJson, theme)
  for (const f of fills) if (gradientOf(pc, f)) map.set(f.fallback, f.gradient)
  return map
}

/** Parse a CSS / SVG color value into '#RRGGBB' + alpha. */
export function parseCssColor(v: string | null | undefined): { hex: string; a: number } | undefined {
  if (!v) return undefined
  const s = v.trim()
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
  if (m) {
    let h = m[1]
    if (h.length === 3) h = [...h].map((c) => c + c).join('')
    return { hex: '#' + h.slice(0, 6).toUpperCase(), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 }
  }
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(s)
  if (m) {
    const c = (x: string) => Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16).padStart(2, '0')
    return { hex: `#${c(m[1])}${c(m[2])}${c(m[3])}`.toUpperCase(), a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))) }
  }
  return undefined
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFS_ID = 'wbi-gradient-defs'

function sharedDefs(doc: Document): SVGDefsElement {
  let svg = doc.getElementById(DEFS_ID) as SVGSVGElement | null
  if (!svg) {
    svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement
    svg.id = DEFS_ID
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
    svg.appendChild(doc.createElementNS(SVG_NS, 'defs'))
    doc.body.appendChild(svg)
  }
  return svg.firstElementChild as SVGDefsElement
}

function alphaToTransparency(a: number): number {
  return Math.round((1 - a) * 1000) / 10
}

/** The id of a gradient definition (created on first use) for an SVG element of `box` (its bounding box). */
function svgGradientRef(doc: Document, g: GradientFill, alpha: number, box?: { x: number; y: number; width: number; height: number }): string {
  const transparency = alphaToTransparency(alpha)
  const user = box && (box.width < 1 || box.height < 1)
  const geo = user ? { ...g, kind: 'linear' as const, angle: box!.height < 1 ? 90 : 180 } : g
  const id = gradientId(geo, transparency) + (user ? `-u${Math.round(box!.x)}_${Math.round(box!.y)}_${Math.round(box!.width)}_${Math.round(box!.height)}` : '')
  if (doc.getElementById(id)) return id
  const defs = sharedDefs(doc)
  const el = doc.createElementNS(SVG_NS, geo.kind === 'radial' ? 'radialGradient' : 'linearGradient')
  el.id = id
  if (geo.kind === 'radial') {
    el.setAttribute('cx', '0.5')
    el.setAttribute('cy', '0.5')
    el.setAttribute('r', '0.5')
  } else {
    const { x1, y1, x2, y2 } = svgGradientGeometry(geo)
    if (user) {
      const w = Math.max(1, box!.width)
      const h = Math.max(1, box!.height)
      el.setAttribute('gradientUnits', 'userSpaceOnUse')
      el.setAttribute('x1', String(box!.x + x1 * w))
      el.setAttribute('y1', String(box!.y + y1 * h))
      el.setAttribute('x2', String(box!.x + x2 * w))
      el.setAttribute('y2', String(box!.y + y2 * h))
    } else {
      el.setAttribute('x1', String(x1))
      el.setAttribute('y1', String(y1))
      el.setAttribute('x2', String(x2))
      el.setAttribute('y2', String(y2))
    }
  }
  for (const s of g.stops) {
    const stop = doc.createElementNS(SVG_NS, 'stop')
    const c = parseCssColor(s.color)!
    stop.setAttribute('offset', String(s.offset))
    stop.setAttribute('stop-color', c.hex)
    stop.setAttribute('stop-opacity', String(Math.round(c.a * alpha * 1000) / 1000))
    el.appendChild(stop)
  }
  defs.appendChild(el)
  return id
}

interface Applied {
  /** SVG attributes / style properties we replaced: name → original value */
  svg?: Record<string, { value: string; style: boolean }>
  /** HTML style properties we set: name → original value */
  html?: Record<string, string>
  /** the source colors we matched, to notice when the visual changes them */
  bg?: string
  text?: string
}

/** One visual's pass. `apply` scans a subtree; `restore` undoes everything (map changed or unmount). */
export class GradientPainter {
  private applied = new Map<Element, Applied>()
  private observer?: MutationObserver

  constructor(
    private readonly root: HTMLElement,
    private readonly map: PaintMap
  ) {}

  start(): void {
    if (!this.map.size) return
    this.scan(this.root)
    if (typeof MutationObserver === 'undefined') return
    this.observer = new MutationObserver((records) => {
      const targets = new Set<Element>()
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach((n) => n instanceof Element && targets.add(n))
        else if (r.target instanceof Element) targets.add(r.target)
      }
      for (const t of targets) if (t.isConnected) this.scan(t)
      // our own writes are mutations too: drop them so they don't loop
      this.observer?.takeRecords()
    })
    this.observer.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: ['fill', 'stroke', 'style'] })
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = undefined
    for (const [el, a] of this.applied) this.undo(el, a)
    this.applied.clear()
  }

  private scan(top: Element): void {
    this.visit(top)
    for (const el of top.querySelectorAll('*')) this.visit(el)
  }

  private visit(el: Element): void {
    if (el instanceof SVGElement) this.visitSvg(el)
    else if (el instanceof HTMLElement) this.visitHtml(el)
  }

  private visitSvg(el: SVGElement): void {
    if (el.closest('linearGradient, radialGradient, mask, clipPath, pattern, filter')) return
    let a = this.applied.get(el)
    for (const name of ['fill', 'stroke'] as const) {
      const styleValue = el.style.getPropertyValue(name)
      const value = styleValue || el.getAttribute(name)
      if (!value || value.startsWith('url(')) continue
      const c = parseCssColor(value)
      const g = c && this.map.get(c.hex)
      const prev = a?.svg?.[name]
      if (!g) {
        // the visual replaced our url with a color of its own: forget it
        if (prev) delete a!.svg![name]
        continue
      }
      let box: { x: number; y: number; width: number; height: number } | undefined
      try {
        box = (el as SVGGraphicsElement).getBBox?.()
      } catch {
        box = undefined
      }
      const ref = `url(#${svgGradientRef(el.ownerDocument, g, c!.a, box)})`
      a ??= {}
      a.svg ??= {}
      a.svg[name] = { value, style: !!styleValue }
      if (styleValue) el.style.setProperty(name, ref)
      else el.setAttribute(name, ref)
      this.applied.set(el, a)
    }
  }

  private visitHtml(el: HTMLElement): void {
    const st = el.style
    const a = this.applied.get(el)
    const bg = parseCssColor(st.backgroundColor)
    const text = parseCssColor(st.color)
    const bgHit = bg && this.map.has(bg.hex) ? bg.hex : undefined
    const textHit = text && this.map.has(text.hex) ? text.hex : undefined
    if (a && a.bg === bgHit && a.text === textHit) return
    if (a) this.undo(el, a)
    if (!bgHit && !textHit) {
      this.applied.delete(el)
      return
    }
    const orig: Record<string, string> = {}
    const set = (prop: string, value: string) => {
      if (!(prop in orig)) orig[prop] = st.getPropertyValue(prop)
      st.setProperty(prop, value)
    }
    const image = st.getPropertyValue('background-image')
    const own = image && image !== 'none' ? image : ''
    const layers: string[] = []
    const clips: string[] = []
    if (textHit) {
      const g = this.map.get(textHit)!
      layers.push(gradientCss(g, alphaToTransparency(text!.a)))
      clips.push('text')
      set('-webkit-text-fill-color', 'transparent')
    }
    if (own) {
      layers.push(own)
      clips.push('border-box')
    }
    if (bgHit) {
      layers.push(gradientCss(this.map.get(bgHit)!, alphaToTransparency(bg!.a)))
      clips.push('border-box')
    } else if (textHit) {
      // the element's own background color stays visible under the gradient text
      layers.push('none')
      clips.push('border-box')
    }
    set('background-image', layers.join(', '))
    set('background-clip', clips.join(', '))
    set('-webkit-background-clip', clips.join(', '))
    this.applied.set(el, { html: orig, bg: bgHit, text: textHit })
  }

  private undo(el: Element, a: Applied): void {
    if (a.svg && el instanceof SVGElement)
      for (const [name, o] of Object.entries(a.svg)) {
        const cur = o.style ? el.style.getPropertyValue(name) : el.getAttribute(name)
        if (!cur?.startsWith('url(#lumen-gf-')) continue
        if (o.style) el.style.setProperty(name, o.value)
        else el.setAttribute(name, o.value)
      }
    if (a.html && el instanceof HTMLElement) for (const [prop, v] of Object.entries(a.html)) (v ? el.style.setProperty(prop, v) : el.style.removeProperty(prop))
  }
}

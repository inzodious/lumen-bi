/**
 * The picture copy saved for Power BI is the icon component's own output, standing alone: an SVG document with
 * `xmlns`, no external references, resolved colours, prefixed (unique) ids. On the canvas the same component draws
 * with per-instance id prefixes, so the same Fluent Color icon twice on a page does not share gradient ids.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import { BAKE_SIZE } from '@core/icons/bake'
import { loadIconSet, type LoadedIconSet } from './registry'
import { PICTURE_ID_PREFIX, renderIconPicture } from './picture'
import { IconGlyph, iconSvgElement } from './IconGlyph'

const theme = resolveTheme()
let lucide: LoadedIconSet
let fluent: LoadedIconSet
beforeAll(async () => {
  lucide = await loadIconSet('lucide')
  fluent = await loadIconSet('fluent-color')
})

/** Checks that make an SVG string a standalone document. */
function expectStandalone(svg: string) {
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="256" height="256" viewBox="0 0 256 256"/)
  // no external references: no http(s)/file/data URLs other than the SVG namespace, no <image>, <use>, <script>, <foreignObject>
  expect(svg.replace(/xmlns="http:\/\/www.w3.org\/2000\/svg"/g, '')).not.toMatch(/https?:|file:|data:/)
  expect(svg).not.toMatch(/<(image|use|script|foreignObject|style)\b/)
  // every local reference points at an id defined in the same document
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  expect(new Set(ids).size).toBe(ids.length)
  for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(m[1])
  for (const m of svg.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(m[1])
  return ids
}

describe('picture copy from the component', () => {
  it('Lucide: the react-icons component, colour resolved through the theme, stroke width passed through', () => {
    const svg = renderIconPicture({ set: 'lucide', name: 'chart-column', color: 'theme:2', strokeWidth: 1.5 }, theme)!
    expectStandalone(svg)
    // the nested root is react-icons' own <svg> (Lucide attributes), drawn in the resolved colour
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('stroke-linecap="round"')
    expect(svg).toContain('stroke-width="1.5"')
    expect(svg).toContain('style="color:#118DFF"')
    expect(svg).toContain('stroke="currentColor"')
    // it is exactly what the component renders, nested at the padded box
    const ChartColumn = lucide.components.get('chart-column')!
    const lu = renderToStaticMarkup(<ChartColumn x={0} y={0} size={BAKE_SIZE} color="#118DFF" strokeWidth={1.5} aria-hidden="true" />)
    expect(svg).toContain(lu)
  })

  it('Lucide: the default colour is the theme foreground; padding shrinks the nested box', () => {
    const svg = renderIconPicture({ set: 'lucide', name: 'users', padding: 25 }, theme)!
    expectStandalone(svg)
    expect(svg).toContain(`style="color:${theme.foreground.toUpperCase()}"`)
    expect(svg).toContain('x="64" y="64"')
    expect(svg).toContain('height="128" width="128"')
    expect(svg).toContain('stroke-width="2"')
  })

  it('Fluent Color: the component with its own gradients, ids prefixed, sized through font-size', () => {
    const svg = renderIconPicture({ set: 'fluent-color', name: 'data-pie' }, theme)!
    const ids = expectStandalone(svg)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(id.startsWith(PICTURE_ID_PREFIX)).toBe(true)
    expect(svg).toContain('viewBox="0 0 20 20"')
    expect(svg).toContain('font-size="256"')
    expect(svg).toMatch(/<linearGradient id="lumen-ic_fluent_data_pie_20_color__a"/)
  })

  it('every Fluent Color icon stands alone, and every shape has its own fill (no currentColor: same look on dark backgrounds)', () => {
    for (const name of fluent.names) {
      const svg = renderIconPicture({ set: 'fluent-color', name }, theme)!
      expectStandalone(svg)
      const shapes = svg.replace(/<(defs|clipPath|mask)\b[\s\S]*?<\/\1>/g, '')
      for (const m of shapes.matchAll(/<(path|circle|rect|ellipse|polygon)\b([^>]*)>/g)) expect(m[2], `${name}: ${m[0].slice(0, 60)}`).toMatch(/\sfill="(?!currentColor)/)
    }
  })

  it('unknown icon: null; deterministic output (same picture, same fingerprint)', () => {
    expect(renderIconPicture({ set: 'lucide', name: 'no-such-icon' }, theme)).toBeNull()
    const a = renderIconPicture({ set: 'fluent-color', name: 'trophy' }, theme)
    expect(renderIconPicture({ set: 'fluent-color', name: 'trophy' }, theme)).toBe(a)
  })
})

describe('the same component on the canvas', () => {
  it('two copies of the same Fluent Color icon (and two different ones) on a page have no id in common', () => {
    const html = renderToStaticMarkup(
      <div>
        <IconGlyph icon={{ set: 'fluent-color', name: 'data-pie' }} theme={theme} />
        <IconGlyph icon={{ set: 'fluent-color', name: 'data-pie' }} theme={theme} />
        <IconGlyph icon={{ set: 'fluent-color', name: 'trophy' }} theme={theme} />
      </div>
    )
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(4)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(m[1])
  })

  it('accessible name when titled, decorative otherwise; image fit through preserveAspectRatio', () => {
    const el = iconSvgElement(lucide, { set: 'lucide', name: 'target' }, theme, { idPrefix: 'x-', title: 'Target', preserveAspectRatio: 'none' })!
    const html = renderToStaticMarkup(el)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Target"')
    expect(html).toContain('<title>Target</title>')
    expect(html).toContain('preserveAspectRatio="none"')
    expect(renderToStaticMarkup(iconSvgElement(lucide, { set: 'lucide', name: 'target' }, theme, { idPrefix: 'x-' })!)).toContain('aria-hidden="true"')
  })
})

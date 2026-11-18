/**
 * Bar / column data labels and axis text defaults:
 *  - a stacked chart drawing one bar series labels like a clustered chart (Auto: outside end, inside end on a bar
 *    that leaves no room); with a legend field the segments keep inside-center labels;
 *  - the selector-less `dataPoint.fill` colours a one-series chart even when a per-measure fill is stored;
 *  - category-axis labels follow a report theme's `label` text-class size (`lightLabel`), value-axis labels keep 9pt
 *    (`smallLightLabel`).
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveTheme, type ResolvedTheme } from '@core/report/theme'
import { createMemoryEngine } from '../../common/memoryEngine'
import { createMockHost } from '../../common/mockHost'
import { labelDerivedClass } from '../../common/fmtProps'
import { col, msr, props, visualJson } from '../../gallery/registry'
import { getVisual } from '../../registry'
import { barLabelPositionDefault } from './CartesianChart'
import '../index'

const T = 'Orders'
const BANDS = ['Short', 'Medium', 'Long', 'Very long']
const COUNTS = [1000, 300, 120, 40]

function engine() {
  const fact = BANDS.flatMap((Band, i) => [
    { Band, Kind: 'A', Count: COUNTS[i] * 0.6 },
    { Band, Kind: 'B', Count: COUNTS[i] * 0.4 }
  ])
  return createMemoryEngine({
    factTable: T,
    fact,
    measures: [{ table: T, name: 'Count', formatString: '0', fn: (rows) => (rows.length ? rows.reduce((a, x) => a + (x.Count as number), 0) : null) }]
  })
}

function render(type: string, objects: Record<string, any>, opts: { legend?: boolean; theme?: ResolvedTheme; width?: number } = {}): string {
  const roles: Record<string, any[]> = { Category: [col(T, 'Band')], Y: [msr(T, 'Count')] }
  if (opts.legend) roles.Series = [col(T, 'Kind')]
  const json = visualJson('v', type, roles, { objects })
  const Comp = getVisual(type)!.component
  const ctx = createMockHost({ engine: engine(), theme: opts.theme })
  return renderToStaticMarkup(<Comp visual={{ name: 'v', json }} pageName="p" width={opts.width ?? 400} height={300} ctx={ctx} />)
}

interface Bar {
  x: number
  y: number
  w: number
  h: number
  fill: string
}
const bars = (html: string): Bar[] =>
  [...html.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"[^>]*cursor:pointer/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
    fill: m[5]
  }))
const labels = (html: string): Array<{ x: number; y: number; text: string }> =>
  [...html.matchAll(/<g pointer-events="none"[^>]*>(?:<rect[^>]*>(?:<\/rect>)?)?<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text><\/g>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }))

describe('bar label position', () => {
  it('default position: Auto for clustered and single-series stacked, inside center otherwise', () => {
    expect(barLabelPositionDefault('clustered')).toBe('Auto')
    expect(barLabelPositionDefault('stacked', 1)).toBe('Auto')
    expect(barLabelPositionDefault('stacked', 2)).toBe('InsideCenter')
    expect(barLabelPositionDefault('percent', 1)).toBe('InsideCenter')
  })

  it('single-series stacked bar chart: labels outside the bar end, inside the end of the bar that leaves no room', () => {
    const html = render('barChart', { labels: [props({ show: true })] })
    const bs = bars(html)
    const ls = labels(html)
    expect(bs.length).toBe(4)
    expect(ls.length).toBe(4)
    const longest = bs.reduce((a, b) => (b.w > a.w ? b : a))
    for (const l of ls) {
      const bar = bs.find((b) => l.y > b.y && l.y < b.y + b.h)!
      expect(bar).toBeDefined()
      const end = bar.x + bar.w
      if (bar === longest) expect(l.x).toBeLessThan(end)
      else expect(l.x).toBeGreaterThan(end)
    }
  })

  it('stacked bar chart with a legend field keeps inside-center labels', () => {
    const html = render('barChart', { labels: [props({ show: true })] }, { legend: true })
    const bs = bars(html)
    const ls = labels(html)
    expect(ls.length).toBeGreaterThan(0)
    for (const l of ls) expect(bs.some((b) => Math.abs(b.x + b.w / 2 - l.x) < 1)).toBe(true)
  })

  it('an explicit Inside center is kept on a single-series stacked chart', () => {
    const html = render('barChart', { labels: [props({ show: true, labelPosition: 'InsideCenter' })] })
    const bs = bars(html)
    for (const l of labels(html)) expect(bs.some((b) => Math.abs(b.x + b.w / 2 - l.x) < 1)).toBe(true)
  })
})

describe('one-series bar colour', () => {
  const meta = `${T}.Count`
  it('a selector-less fill wins over a per-measure fill', () => {
    const html = render('barChart', {
      dataPoint: [
        { properties: { fill: { solid: { color: { expr: { Literal: { Value: "'#0000AA'" } } } } } }, selector: { metadata: meta } },
        { properties: { fill: { solid: { color: { expr: { Literal: { Value: "'#DDAA00'" } } } } } } }
      ]
    })
    const bs = bars(html)
    expect(bs.length).toBe(4)
    for (const b of bs) expect(b.fill.toUpperCase()).toBe('#DDAA00')
  })

  it('the legacy defaultColor still yields to a per-measure fill', () => {
    const html = render('barChart', {
      dataPoint: [
        { properties: { fill: { solid: { color: { expr: { Literal: { Value: "'#0000AA'" } } } } } }, selector: { metadata: meta } },
        { properties: { defaultColor: { solid: { color: { expr: { Literal: { Value: "'#DDAA00'" } } } } } } }
      ]
    })
    for (const b of bars(html)) expect(b.fill.toUpperCase()).toBe('#0000AA')
  })
})

describe('axis label text classes', () => {
  it('base theme: 9pt Segoe UI on both axes', () => {
    const t = resolveTheme()
    expect(labelDerivedClass(t, 'lightLabel')).toMatchObject({ size: 9, family: 'Segoe UI', color: '#605E5C' })
    expect(labelDerivedClass(t, 'smallLightLabel')).toMatchObject({ size: 9, family: 'Segoe UI', color: '#605E5C' })
  })

  it('a theme label size moves the category axis (lightLabel); the value axis keeps 9pt (smallLightLabel)', () => {
    const t = resolveTheme(undefined, { textClasses: { label: { fontSize: 12, fontFace: 'Verdana', color: '#123456' } } })
    expect(labelDerivedClass(t, 'lightLabel')).toEqual({ size: 12, family: 'Verdana', color: '#605E5C' })
    expect(labelDerivedClass(t, 'smallLightLabel')).toEqual({ size: 9, family: 'Verdana', color: '#605E5C' })
  })

  it('a theme that defines the derived class wins', () => {
    const t = resolveTheme(undefined, { textClasses: { label: { fontSize: 12 }, lightLabel: { fontSize: 11, color: '#333333' }, smallLightLabel: { fontSize: 8 } } })
    expect(labelDerivedClass(t, 'lightLabel')).toMatchObject({ size: 11, color: '#333333' })
    expect(labelDerivedClass(t, 'smallLightLabel')).toMatchObject({ size: 8 })
  })

  it('the chart draws category labels at the theme label size; a stored axis size wins', () => {
    const theme = resolveTheme(undefined, { textClasses: { label: { fontSize: 12 } } })
    const fontSizeOf = (html: string, text: string) => {
      const m = html.match(new RegExp(`<text[^>]*font-size="([\\d.]+)"[^>]*><title>${text}</title>`))
      return m ? Number(m[1]) : NaN
    }
    const html = render('clusteredBarChart', {}, { theme })
    expect(fontSizeOf(html, 'Medium')).toBeCloseTo(16, 0)
    const stored = render('clusteredBarChart', { categoryAxis: [props({ fontSize: 9 })] }, { theme })
    expect(fontSizeOf(stored, 'Medium')).toBeCloseTo(12, 0)
  })
})

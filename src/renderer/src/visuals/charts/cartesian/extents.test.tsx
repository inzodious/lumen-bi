/**
 * Value-axis extents of bar / column charts: the bars must use the plot the way Power BI does (no gap from
 * floating-point noise, no room reserved for data labels, total labels next to the longest stack, an explicit
 * start keeps the automatic end on the data, 100% stacks start below zero when there are negative values).
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryEngine } from '../../common/memoryEngine'
import { createMockHost } from '../../common/mockHost'
import { computeValueAxis, snapFloat } from '../../common/scale'
import { col, msr, props, visualJson } from '../../gallery/registry'
import { getVisual } from '../../registry'
import '../index'

const T = 'Survey'
const QUESTIONS = ['Access', 'Quality', 'Speed', 'Value']
// names sort in this order, so the series stack in this order
const RATINGS = ['1 Poor', '2 Fair', '3 Good', '4 Very good', '5 Excellent']
/** five shares whose binary sum (in this order) is 1.0000000000000002 */
const SHARES = [0.3, 0.25, 0.15, 0.2, 0.1]

function engine(valueOf: (q: number, r: number) => number) {
  const fact = QUESTIONS.flatMap((Question, q) => RATINGS.map((Rating, r) => ({ Question, Rating, Share: valueOf(q, r) })))
  return createMemoryEngine({
    factTable: T,
    fact,
    measures: [{ table: T, name: 'Share', formatString: '0%', fn: (rows) => (rows.length ? rows.reduce((a, x) => a + (x.Share as number), 0) : null) }]
  })
}

interface Box {
  x: number
  y: number
  w: number
  h: number
  fill: string
}

const W = 600
const H = 300

function bars(type: string, eng: ReturnType<typeof engine>, wells: Record<string, any[]>, objects: Record<string, any> = {}): { rects: Box[]; html: string; colors: string[] } {
  const json = visualJson('v', type, wells, { objects })
  const def = getVisual(type)!
  const ctx = createMockHost({ engine: eng })
  const Comp = def.component
  const html = renderToStaticMarkup(<Comp visual={{ name: 'v', json }} pageName="p" width={W} height={H} ctx={ctx} />)
  const rects: Box[] = []
  for (const m of html.matchAll(/<rect\b([^>]*)>/g)) {
    const a = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1])?.[1]
    const fill = a('fill') ?? ''
    if (!/^#[0-9a-f]{6}$/i.test(fill)) continue
    rects.push({ x: Number(a('x')), y: Number(a('y')), w: Number(a('width')), h: Number(a('height')), fill: fill.toUpperCase() })
  }
  const colors = ctx.theme.dataColors.map((c) => c.toUpperCase())
  // data bars only: filled with a theme data color, with a real size
  return { rects: rects.filter((r) => colors.includes(r.fill) && r.w > 0 && r.h > 0), html, colors }
}

const share = msr(T, 'Share')
const question = col(T, 'Question')
const rating = col(T, 'Rating')
const right = (rs: Box[]) => Math.max(...rs.map((r) => r.x + r.w))
const top = (rs: Box[]) => Math.min(...rs.map((r) => r.y))

describe('value axis range', () => {
  it('ignores floating-point noise: a stack summing to 1.0000000000000002 ends at 1', () => {
    expect(SHARES.reduce((a, b) => a + b, 0)).toBeGreaterThan(1)
    expect(snapFloat(SHARES.reduce((a, b) => a + b, 0))).toBe(1)
    expect(computeValueAxis({ dataMin: 0, dataMax: 1.0000000000000002, includeZero: true, length: 450, tickSpacing: 90 }).domain).toEqual([0, 1])
    expect(computeValueAxis({ dataMin: -0.30000000000000004, dataMax: 0, includeZero: true, length: 450, tickSpacing: 90 }).domain[0]).toBeCloseTo(-0.3, 12)
  })
  it('an explicit start (or end) keeps the automatic end on the data instead of rounding it out', () => {
    expect(computeValueAxis({ dataMin: 0, dataMax: 863, includeZero: true, start: 0, length: 400 }).domain).toEqual([0, 863])
    expect(computeValueAxis({ dataMin: 12, dataMax: 863, includeZero: false, end: 1000, length: 400 }).domain).toEqual([12, 1000])
    // fully automatic: rounded out to a nice step
    expect(computeValueAxis({ dataMin: 0, dataMax: 863, includeZero: true, length: 400 }).domain[1]).toBeGreaterThan(863)
  })
  it('nice: false keeps the data range as it is', () => {
    expect(computeValueAxis({ dataMin: -3, dataMax: 2025, includeZero: true, length: 400, nice: false }).domain).toEqual([-3, 2025])
  })
})

describe('bar chart extents', () => {
  it('stacked bars of shares that total 100% run to the end of the plot', () => {
    const { rects } = bars('barChart', engine((_, r) => SHARES[r]), { Category: [question], Series: [rating], Y: [share] }, { labels: [props({ show: true })], valueAxis: [props({ show: false })] })
    expect(rects.length).toBe(QUESTIONS.length * RATINGS.length)
    // only the small right margin is left (it was ~1/6 of the plot when the range was rounded up to 120%)
    expect(W - right(rects)).toBeLessThan(16)
  })
  it('clustered bars get no room reserved for their data labels', () => {
    // longest bar = 0.5, a nice bound: the bar must reach the plot end with data labels on
    const { rects } = bars('clusteredBarChart', engine((q, r) => (r === 0 ? [0.5, 0.31, 0.22, 0.14][q] : 0)), { Category: [question], Y: [share] }, { labels: [props({ show: true })], valueAxis: [props({ show: false })] })
    expect(W - right(rects)).toBeLessThan(16)
  })
  it('stacked bars with total labels: the longest stack and its total label fill the plot', () => {
    // totals 0.83, 0.52, 0.31, 0.2 → a rounded-out range (1.0) would leave 17% of the plot empty
    const totals = [0.83, 0.52, 0.31, 0.2]
    const { rects, html } = bars('barChart', engine((q, r) => totals[q] / RATINGS.length), { Category: [question], Series: [rating], Y: [share] }, { totals: [props({ show: true })], valueAxis: [props({ show: false })] })
    const gap = W - right(rects)
    expect(gap).toBeGreaterThan(20) // room for "83%"
    expect(gap).toBeLessThan(60)
    expect(html).toContain('>83%<')
  })
  it('an explicit value-axis start keeps the longest bar at the plot end', () => {
    const { rects } = bars('clusteredBarChart', engine((q, r) => (r === 0 ? [0.863, 0.31, 0.22, 0.14][q] : 0)), { Category: [question], Y: [share] }, { valueAxis: [props({ show: false, start: 0 })] })
    expect(W - right(rects)).toBeLessThan(16)
  })
  it('stacked columns with total labels leave one label line above the tallest stack', () => {
    const totals = [0.83, 0.52, 0.31, 0.2]
    const { rects } = bars('columnChart', engine((q, r) => totals[q] / RATINGS.length), { Category: [question], Series: [rating], Y: [share] }, { totals: [props({ show: true })], legend: [props({ show: false })] })
    expect(top(rects)).toBeGreaterThan(14)
    expect(top(rects)).toBeLessThan(40)
  })
  it('100% stacked bars show negative values below 0% instead of clipping them', () => {
    // one rating is negative in every question
    const { rects, colors } = bars('hundredPercentStackedBarChart', engine((_, r) => (r === 0 ? -0.1 : SHARES[r])), { Category: [question], Series: [rating], Y: [share] })
    const negative = rects.filter((r) => r.fill === colors[0])
    const positive = rects.filter((r) => r.fill !== colors[0])
    expect(negative.length).toBe(QUESTIONS.length)
    // the negative segments sit left of the positive ones, inside the plot (right of the category labels)
    expect(right(negative)).toBeLessThanOrEqual(Math.min(...positive.map((r) => r.x)) + 0.5)
    expect(Math.min(...negative.map((r) => r.x))).toBeGreaterThan(30)
    // the axis still ends at 100%: positives are 87.5% of |values| here, so they stop short of the plot end
    expect(W - right(positive)).toBeGreaterThan(40)
  })
})

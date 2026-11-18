import { describe, expect, it } from 'vitest'
import { highDensitySample } from '../../common/sampling'
import { alignSecondaryAxis, alignZeroAxes, computeValueAxis, niceStep } from '../../common/scale'
import { detectAnomalies, sensitivityToK } from './anomaly'
import { spreadLabels } from './seriesLabels'
import { errorBounds, errorTooltip, type ErrorBarSpec } from './errorBars'
import { clampWindow } from './ZoomSlider'
import { gridSize } from './SmallMultiples'
import { composeLabel, labelParts, splitLabel, sliceAngles } from '../pie/pieLayout'

describe('high-density sampling', () => {
  it('keeps everything under the budget', () => {
    expect(highDensitySample(10, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], 3500)).toHaveLength(10)
  })
  it('keeps peaks, troughs and both ends within the budget', () => {
    const n = 20000
    const vals = Array.from({ length: n }, (_, i) => Math.sin(i / 50))
    vals[12345] = 100
    vals[777] = -100
    const keep = highDensitySample(n, [vals], 3500)
    expect(keep.length).toBeLessThanOrEqual(3500)
    expect(keep).toContain(0)
    expect(keep).toContain(n - 1)
    expect(keep).toContain(12345)
    expect(keep).toContain(777)
    expect([...keep].sort((a, b) => a - b)).toEqual(keep)
  })
  it('keeps the extremes of every series', () => {
    const n = 9000
    const a = Array.from({ length: n }, () => 0)
    const b = Array.from({ length: n }, () => 0)
    a[100] = 5
    b[8000] = -5
    const keep = highDensitySample(n, [a, b], 1000)
    expect(keep).toContain(100)
    expect(keep).toContain(8000)
  })
})

describe('value axis', () => {
  it('nice steps', () => {
    expect(niceStep(0.3)).toBe(0.5)
    expect(niceStep(2.2)).toBe(2.5)
    expect(niceStep(70)).toBe(100)
  })
  it('short axes avoid a big overshoot (645K → not 1.0M)', () => {
    const m = computeValueAxis({ dataMin: 0, dataMax: 645000, includeZero: true, length: 100, tickSpacing: 50 })
    expect(m.domain[1]).toBeLessThan(1000000)
    expect(m.domain[1]).toBeGreaterThanOrEqual(645000)
  })
  it('secondary axis has the same number of intervals and aligns zero', () => {
    const p = computeValueAxis({ dataMin: -200, dataMax: 800, includeZero: true, length: 250 })
    const s = alignSecondaryAxis(p, { dataMin: -0.05, dataMax: 0.4, includeZero: false })
    expect(s.ticks.length).toBe(p.ticks.length)
    const zp = p.ticks.indexOf(0)
    expect(Math.abs(s.ticks[zp])).toBeLessThan(1e-9)
    expect(s.ticks[s.ticks.length - 1]).toBeGreaterThanOrEqual(0.4)
    expect(s.ticks[0]).toBeLessThanOrEqual(-0.05)
  })
  it('align zeros: the axis with less room below zero is extended so both zeros are at the same height', () => {
    const p = computeValueAxis({ dataMin: 0, dataMax: 60, includeZero: true, length: 250 })
    const s = computeValueAxis({ dataMin: -0.3, dataMax: 0.1, includeZero: true, length: 250 })
    const [a, b] = alignZeroAxes(p, s)
    const frac = (d: [number, number]) => -d[0] / (d[1] - d[0])
    expect(frac(a.domain)).toBeCloseTo(frac(b.domain), 9)
    expect(b.domain).toEqual(s.domain)
    expect(a.domain[1]).toBe(p.domain[1])
    expect(a.ticks).toContain(0)
    expect(a.ticks[1] - a.ticks[0]).toBeCloseTo(p.step, 9)
  })
  it('secondary axis for a positive line series covers the data', () => {
    const p = computeValueAxis({ dataMin: 0, dataMax: 500000, includeZero: true, length: 200 })
    const s = alignSecondaryAxis(p, { dataMin: 0.405, dataMax: 0.4175, includeZero: false })
    expect(s.ticks.length).toBe(p.ticks.length)
    expect(s.ticks[0]).toBeLessThanOrEqual(0.405)
    expect(s.ticks[s.ticks.length - 1]).toBeGreaterThanOrEqual(0.4175)
  })
})

describe('anomaly detection', () => {
  it('needs 12 points', () => {
    expect(detectAnomalies([1, 2, 3])).toBeNull()
  })
  it('flags an obvious spike and not the smooth part', () => {
    const vals = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5)
    vals[20] = 300
    const r = detectAnomalies(vals)!
    expect(r.anomalies).toEqual([20])
    expect(r.high[20]!).toBeLessThan(300)
    expect(r.low[5]!).toBeLessThan(vals[5] as number)
  })
  it('higher sensitivity = narrower band', () => {
    expect(sensitivityToK(90)).toBeLessThan(sensitivityToK(50))
  })
})

describe('series labels', () => {
  it('spreads overlapping labels inside the plot', () => {
    const ys = spreadLabels([50, 52, 51], [12, 12, 12], 0, 200)
    const sorted = [...ys].sort((a, b) => a - b)
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(12 - 1e-9)
    expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(12 - 1e-9)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(6)
  })
  it('stays inside the bottom edge', () => {
    const ys = spreadLabels([199, 199], [10, 10], 0, 200)
    expect(Math.max(...ys)).toBeLessThanOrEqual(195)
  })
})

describe('error bars', () => {
  const spec = { relative: false, percent: false, tooltipShow: true, tooltipFormat: 'absolute' } as ErrorBarSpec
  it('absolute bounds', () => expect(errorBounds(spec, 10, 12, 7)).toEqual([7, 12]))
  it('relative bounds', () => expect(errorBounds({ ...spec, relative: true }, 10, 2, 3)).toEqual([7, 12]))
  it('relative percentage bounds', () => expect(errorBounds({ ...spec, relative: true, percent: true }, 200, 10, 5)).toEqual([190, 220]))
  it('tooltip formats', () => {
    const f = (v: number) => String(v)
    expect(errorTooltip(spec, 10, 7, 12, f)).toBe('Upper: 12, Lower: 7')
    expect(errorTooltip({ ...spec, tooltipFormat: 'range' }, 10, 7, 12, f)).toBe('7 – 12')
    expect(errorTooltip({ ...spec, tooltipFormat: 'relativeNumeric' }, 10, 7, 12, f)).toBe('+2 / -3')
  })
})

describe('zoom slider', () => {
  it('clamps the window and keeps a minimum span', () => {
    expect(clampWindow(-0.2, 0.5)).toEqual([0, 0.5])
    const [a, b] = clampWindow(0.5, 0.5)
    expect(b - a).toBeCloseTo(0.02)
  })
})

describe('small multiples grid', () => {
  it('custom layout', () => expect(gridSize(5, 600, 400, { rows: 2, cols: 2 })).toEqual({ rows: 2, cols: 2 }))
  it('auto grid uses several columns on a wide visual', () => {
    const g = gridSize(6, 900, 300)
    expect(g.cols).toBeGreaterThanOrEqual(3)
    expect(g.rows).toBeLessThanOrEqual(3)
  })
})

describe('pie labels', () => {
  it('label contents values written by Desktop', () => {
    expect(labelParts('Data')).toEqual({ category: false, value: true, percent: false })
    expect(labelParts('Both')).toEqual({ category: true, value: true, percent: false })
    expect(labelParts('Category, data value, percent of total')).toEqual({ category: true, value: true, percent: true })
  })
  it('composes like PBI', () => {
    expect(composeLabel({ value: '$6.39M', percent: '28.97%' })).toBe('$6.39M (28.97%)')
    expect(composeLabel({ category: 'Lindseys', value: '$6M' })).toBe('Lindseys ($6M)')
    expect(composeLabel({ category: 'A', value: '1', percent: '2%' })).toBe('A 1 (2%)')
    expect(splitLabel('$6.39M (28.97%)')).toEqual(['$6.39M', '(28.97%)'])
  })
  it('rotation shifts the first slice', () => {
    const a = sliceAngles([1, 1], 90)
    expect(a[0].start).toBeCloseTo(Math.PI / 2)
  })
})

import { describe, expect, it } from 'vitest'
import {
  BUBBLE_MAX_AREA,
  BUBBLE_MIN_AREA,
  DEFAULT_MARKER_RADIUS,
  axisTitleWithUnits,
  bubbleScale,
  collectFrames,
  initialFrame,
  isStrokeShape,
  markerPath,
  markerRadius,
  nextFrame,
  normalizeShape,
  placeLabels,
  ratioSlope,
  sizeMultiplier,
  statValue,
  symmetryPolygons,
  trailOf,
  trendSegment
} from '../scatterModel'

const area = (r: number) => Math.PI * r * r

describe('bubble sizes', () => {
  it('maps size to area (magnitude): 0 → min area, max → max area on a 300×300 plot', () => {
    const f = bubbleScale([0, 50, 100], { plotW: 300, plotH: 300, bubbleSize: 0, rangeType: 'magnitude' })
    expect(area(f(0))).toBeCloseTo(BUBBLE_MIN_AREA, 6)
    expect(area(f(100))).toBeCloseTo(BUBBLE_MAX_AREA, 6)
    expect(area(f(50))).toBeCloseTo((BUBBLE_MIN_AREA + BUBBLE_MAX_AREA) / 2, 6)
  })
  it('auto = magnitude for non-negative sizes, data range otherwise', () => {
    const auto = bubbleScale([10, 20], { plotW: 300, plotH: 300, bubbleSize: 0 })
    const mag = bubbleScale([10, 20], { plotW: 300, plotH: 300, bubbleSize: 0, rangeType: 'magnitude' })
    expect(auto(10)).toBeCloseTo(mag(10))
    const dr = bubbleScale([10, 20], { plotW: 300, plotH: 300, bubbleSize: 0, rangeType: 'dataRange' })
    expect(area(dr(10))).toBeCloseTo(BUBBLE_MIN_AREA)
    const neg = bubbleScale([-10, 10], { plotW: 300, plotH: 300, bubbleSize: 0 })
    expect(area(neg(-10))).toBeCloseTo(BUBBLE_MIN_AREA)
    expect(area(neg(10))).toBeCloseTo(BUBBLE_MAX_AREA)
  })
  it('scales with the plot area and the size multiplier', () => {
    const big = bubbleScale([1, 2], { plotW: 600, plotH: 900, bubbleSize: 0 })
    expect(area(big(2))).toBeCloseTo(BUBBLE_MAX_AREA * 4)
    const smaller = bubbleScale([1, 2], { plotW: 300, plotH: 300, bubbleSize: -50 })
    expect(smaller(2)).toBeCloseTo(Math.sqrt(BUBBLE_MAX_AREA / Math.PI) * 0.5)
    expect(sizeMultiplier(-10)).toBeCloseTo(0.9)
    expect(sizeMultiplier(-500)).toBe(0.15)
  })
  it('null sizes and no data get the default marker radius', () => {
    const f = bubbleScale([null], { plotW: 300, plotH: 300, bubbleSize: 0 })
    expect(f(null)).toBe(DEFAULT_MARKER_RADIUS)
    expect(markerRadius(-10)).toBeCloseTo(DEFAULT_MARKER_RADIUS * 0.9)
  })
})

describe('play axis frames', () => {
  it('collects distinct frames in order', () => {
    expect(collectFrames(['2023', '2023', '2024', '2023', '2025'])).toEqual(['2023', '2024', '2025'])
  })
  it('starts at the saved frame or the last one', () => {
    expect(initialFrame(5, undefined)).toBe(4)
    expect(initialFrame(5, 2)).toBe(2)
    expect(initialFrame(5, 9)).toBe(4)
    expect(initialFrame(0, 1)).toBe(-1)
  })
  it('advances and stops at the end', () => {
    expect(nextFrame(-1, 3)).toBe(0)
    expect(nextFrame(1, 3)).toBe(2)
    expect(nextFrame(2, 3)).toBe(-1)
  })
  it('builds trails up to the current frame in frame order', () => {
    const pts = [
      { frameIndex: 2, x: 3, y: 3 },
      { frameIndex: 0, x: 1, y: 1 },
      { frameIndex: 1, x: 2, y: 2 },
      { frameIndex: 3, x: 4, y: 4 }
    ]
    expect(trailOf(pts, 2).map((t) => t.frame)).toEqual([0, 1, 2])
  })
})

describe('scatter analytics', () => {
  it('statistics', () => {
    const v = [4, 1, 3, 2, NaN]
    expect(statValue('min', v)).toBe(1)
    expect(statValue('max', v)).toBe(4)
    expect(statValue('average', v)).toBe(2.5)
    expect(statValue('median', v)).toBe(2.5)
    expect(statValue('percentile', [1, 2, 3, 4, 5], 75)).toBe(4)
    expect(statValue('average', [])).toBeNaN()
  })
  it('ratio line slope = Σy / Σx', () => {
    expect(ratioSlope([{ x: 0.5, y: 1 }, { x: 1, y: 2 }, { x: 1.5, y: 3 }])).toBeCloseTo(2)
    expect(ratioSlope([{ x: 0, y: 3 }])).toBeNull()
  })
  it('symmetry shading splits the plot along y = x', () => {
    const { upper, lower } = symmetryPolygons([0, 10], [0, 10], 10)
    const shoelace = (p: Array<[number, number]>) => Math.abs(p.reduce((a, [x, y], i) => a + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2
    expect(shoelace(upper)).toBeCloseTo(50)
    expect(shoelace(lower)).toBeCloseTo(50)
    // diagonal fully above the plot: all lower
    const off = symmetryPolygons([100, 200], [0, 10], 8)
    expect(shoelace(off.upper)).toBeCloseTo(0)
    expect(shoelace(off.lower)).toBeCloseTo(1000)
  })
  it('trend segment is the least-squares fit across the x range', () => {
    const s = trendSegment(
      [
        { x: 0, y: 1 },
        { x: 1, y: 3 },
        { x: 2, y: 5 }
      ],
      [0, 10]
    )!
    expect(s.slope).toBeCloseTo(2)
    expect(s.intercept).toBeCloseTo(1)
    expect(s.y1).toBeCloseTo(21)
    expect(trendSegment([{ x: 1, y: 1 }])).toBeNull()
    expect(trendSegment([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toBeNull()
  })
})

describe('markers and labels', () => {
  it('marker shapes', () => {
    expect(normalizeShape('diamond')).toBe('diamond')
    expect(normalizeShape('bogus')).toBe('circle')
    expect(isStrokeShape('x')).toBe(true)
    expect(isStrokeShape('square')).toBe(false)
    expect(markerPath('square', 10)).toMatch(/^M-8\.86,-8\.86H8\.86/)
    expect(markerPath('circle', 5)).toContain('A5,5')
  })
  it('places labels without overlaps and inside bounds', () => {
    const reqs = Array.from({ length: 6 }, (_, i) => ({ x: 50 + i * 4, y: 50, r: 3, width: 40, height: 12 }))
    const placed = placeLabels(reqs, { x: 0, y: 0, w: 200, h: 200 })
    expect(placed.length).toBeGreaterThan(1)
    expect(placed.length).toBeLessThan(6)
    const boxes = placed.map((p) => ({ x0: p.x - 20, x1: p.x + 20, y0: p.y - 6, y1: p.y + 6 }))
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxes[i].x0 < boxes[j].x1 && boxes[i].x1 > boxes[j].x0 && boxes[i].y0 < boxes[j].y1 && boxes[i].y1 > boxes[j].y0).toBe(false)
    expect(placeLabels([{ x: 5, y: 5, r: 3, width: 300, height: 12 }], { x: 0, y: 0, w: 100, h: 100 })).toEqual([])
  })
  it('axis titles with units', () => {
    expect(axisTitleWithUnits('Sales', 'showBoth', 1e6)).toBe('Sales (Millions)')
    expect(axisTitleWithUnits('Sales', 'showUnitOnly', 1e3)).toBe('Thousands')
    expect(axisTitleWithUnits('Sales', 'showBoth', 1)).toBe('Sales')
    expect(axisTitleWithUnits('Sales', undefined, 1e9)).toBe('Sales')
  })
})

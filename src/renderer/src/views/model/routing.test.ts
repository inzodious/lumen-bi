import { describe, expect, it } from 'vitest'
import { anchorPoint, autoEndToward, autoEnds, buildRoute, edgeDecor, insertWaypoint, moveWaypoint, nearestAnchor, nearestOnRoute, pointAtLength, removeWaypoint, resolveEnds, translateRoute, segmentMidpoints, spreadAlongSide, routeAfterArrange, type End, type Pt } from './routing'

const A = { x: 0, y: 0, width: 200, height: 300 }
const B = { x: 400, y: 100, width: 200, height: 300 }

/** Parse `M x,y C c1 c2 p …` into cubic segments. */
function cubics(d: string): Array<{ p0: Pt; c1: Pt; c2: Pt; p3: Pt }> {
  const nums = (s: string): Pt[] => (s.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []).map((t) => ({ x: Number(t.split(',')[0]), y: Number(t.split(',')[1]) }))
  const [head, ...rest] = d.split(' C')
  let p0 = nums(head)[0]
  return rest.map((seg) => {
    const [c1, c2, p3] = nums(seg)
    const out = { p0, c1, c2, p3 }
    p0 = p3
    return out
  })
}
const dir = (a: Pt, b: Pt): Pt => {
  const l = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}

describe('line ends', () => {
  it('cards side by side connect facing edges at the joined rows', () => {
    const { from, to } = autoEnds(A, 100, B, 250)
    expect(from).toMatchObject({ point: { x: 200, y: 100 }, side: 'right', normal: { x: 1, y: 0 }, manual: false })
    expect(to).toMatchObject({ point: { x: 400, y: 250 }, side: 'left', normal: { x: -1, y: 0 } })
    // swapped
    const r = autoEnds(B, 250, A, 100)
    expect(r.from.side).toBe('left')
    expect(r.to.side).toBe('right')
  })

  it('rows are clamped into the card; collapsed cards (no row) use the middle', () => {
    const { from, to } = autoEnds(A, 9999, B, null)
    expect(from.point.y).toBe(288)
    expect(to.point.y).toBe(250)
  })

  it('stacked cards connect bottom/top; overlapping cards join centres', () => {
    const below = { x: 50, y: 400, width: 200, height: 100 }
    const s = autoEnds(A, 50, below, 420)
    expect(s.from).toMatchObject({ side: 'bottom', point: { x: 125, y: 300 } })
    expect(s.to).toMatchObject({ side: 'top', point: { x: 125, y: 400 } })
    const over = autoEnds(A, 50, { x: 100, y: 100, width: 200, height: 300 }, 150)
    expect(over.from.side).toBe('center')
    expect(over.from.point).toEqual({ x: 100, y: 150 })
  })

  it('an automatic end faces the point the line heads to', () => {
    expect(autoEndToward(A, 120, { x: 500, y: 0 })).toMatchObject({ side: 'right', point: { x: 200, y: 120 } })
    expect(autoEndToward(A, 120, { x: -50, y: 900 })).toMatchObject({ side: 'left', point: { x: 0, y: 120 } })
    expect(autoEndToward(A, 120, { x: 150, y: -80 })).toMatchObject({ side: 'top', point: { x: 150, y: 0 } })
    expect(autoEndToward(A, 120, { x: 5, y: 500 })).toMatchObject({ side: 'bottom', point: { x: 10, y: 300 } })
  })

  it('manual anchors: point on the side, kept off the corners', () => {
    expect(anchorPoint(A, { side: 'right', t: 0.5 })).toEqual({ x: 200, y: 150 })
    expect(anchorPoint(A, { side: 'top', t: 0.25 })).toEqual({ x: 50, y: 0 })
    expect(anchorPoint(A, { side: 'left', t: 0 })).toEqual({ x: 0, y: 10 })
    expect(anchorPoint(A, { side: 'bottom', t: 1 })).toEqual({ x: 190, y: 300 })
  })

  it('nearestAnchor projects a point onto the perimeter (outside and inside the card)', () => {
    expect(nearestAnchor(A, { x: 260, y: 75 })).toEqual({ side: 'right', t: 0.25 })
    expect(nearestAnchor(A, { x: 100, y: -40 })).toEqual({ side: 'top', t: 0.5 })
    expect(nearestAnchor(A, { x: 20, y: 150 })).toEqual({ side: 'left', t: 0.5 })
    expect(nearestAnchor(A, { x: 100, y: 290 })).toEqual({ side: 'bottom', t: 0.5 })
    // beyond a corner: the nearer side, clamped
    expect(nearestAnchor(A, { x: 300, y: 400 }).t).toBe(1)
  })

  it('resolveEnds: manual ends win; automatic ends aim at the first / last waypoint', () => {
    const plain = resolveEnds(A, 100, B, 250, undefined)
    expect(plain).toEqual(autoEnds(A, 100, B, 250))
    const viaTop = resolveEnds(A, 100, B, 250, { waypoints: [{ x: 100, y: -100 }, { x: 500, y: -100 }] })
    expect(viaTop.from.side).toBe('top')
    expect(viaTop.to.side).toBe('top')
    expect(viaTop.to.point).toEqual({ x: 500, y: 100 })
    const manual = resolveEnds(A, 100, B, 250, { from: { side: 'bottom', t: 0.5 } })
    expect(manual.from).toMatchObject({ side: 'bottom', manual: true, point: { x: 100, y: 300 } })
    expect(manual.to.side).toBe('left')
    expect(manual.to.manual).toBe(false)
  })
})

describe('line paths', () => {
  const ends = autoEnds(A, 100, B, 250)

  it('straight: a polyline through the waypoints (unchanged shape without any)', () => {
    expect(buildRoute(ends.from, ends.to, [], 'straight').d).toBe('M200,100 L400,250')
    const g = buildRoute(ends.from, ends.to, [{ x: 300, y: 50 }], 'straight')
    expect(g.d).toBe('M200,100 L300,50 L400,250')
    expect(g.samples.map((s) => s.seg)).toEqual([0, 0, 1])
    expect(g.length).toBeCloseTo(Math.hypot(100, 50) + Math.hypot(100, 200))
  })

  it('curved: leaves and enters the cards perpendicular to their edges', () => {
    const g = buildRoute(ends.from, ends.to, [], 'curved')
    const [c] = cubics(g.d)
    expect(c.p0).toEqual({ x: 200, y: 100 })
    expect(c.p3).toEqual({ x: 400, y: 250 })
    // first handle straight out of the right edge, last handle straight into the left edge
    expect(c.c1.y).toBe(100)
    expect(c.c1.x).toBeGreaterThan(200)
    expect(c.c2.y).toBe(250)
    expect(c.c2.x).toBeLessThan(400)
    const start = pointAtLength(g, 1)
    expect(Math.abs(start.angle)).toBeLessThan(8)
    const end = pointAtLength(g, g.length - 1)
    expect(Math.abs(end.angle)).toBeLessThan(8)
  })

  it('curved: passes through every waypoint with one shared tangent (no kink)', () => {
    const wps = [
      { x: 280, y: -40 },
      { x: 330, y: 380 },
      { x: 360, y: 120 }
    ]
    const g = buildRoute(ends.from, ends.to, wps, 'curved')
    const segs = cubics(g.d)
    expect(segs).toHaveLength(4)
    wps.forEach((w, i) => {
      expect(segs[i].p3).toEqual(w)
      const arriving = dir(segs[i].c2, segs[i].p3)
      const leaving = dir(segs[i + 1].p0, segs[i + 1].c1)
      expect(arriving.x).toBeCloseTo(leaving.x, 1)
      expect(arriving.y).toBeCloseTo(leaving.y, 1)
      // the sampled line really goes through the waypoint
      expect(nearestOnRoute(g, w).dist).toBeLessThan(0.01)
    })
    // samples are tagged with the stretch they belong to, in order
    const segIds = g.samples.map((s) => s.seg)
    expect([...new Set(segIds)]).toEqual([0, 1, 2, 3])
    expect(segIds).toEqual([...segIds].sort((a, b) => a - b))
  })

  it('orthogonal: only horizontal/vertical legs, through the waypoints, rounded corners', () => {
    const plain = buildRoute(ends.from, ends.to, [], 'orthogonal')
    const axisAligned = (pts: Pt[]): boolean => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.01 || Math.abs(p.y - pts[i - 1].y) < 0.01)
    expect(axisAligned(plain.samples)).toBe(true)
    // Z-shape through the middle between the two cards
    expect(plain.samples.map((s) => [s.x, s.y])).toEqual([
      [200, 100],
      [300, 100],
      [300, 250],
      [400, 250]
    ])
    expect(plain.d).toContain('Q300,100')
    const w = { x: 250, y: 400 }
    const via = buildRoute(ends.from, ends.to, [w], 'orthogonal')
    expect(axisAligned(via.samples)).toBe(true)
    expect(nearestOnRoute(via, w).dist).toBeLessThan(0.01)
    expect(via.samples[0]).toMatchObject({ x: 200, y: 100 })
    expect(via.samples[via.samples.length - 1]).toMatchObject({ x: 400, y: 250 })
  })

  it('orthogonal: never doubles back over itself to reach a waypoint', () => {
    const reversals = (pts: Pt[]): number => {
      let n = 0
      for (let i = 2; i < pts.length; i++) {
        const a = { x: pts[i - 1].x - pts[i - 2].x, y: pts[i - 1].y - pts[i - 2].y }
        const b = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y }
        if (a.x * b.x + a.y * b.y < -0.001) n++
      }
      return n
    }
    // waypoints below, above, between and behind the cards, alone and in pairs
    const spots = [
      { x: 250, y: 400 },
      { x: 300, y: -80 },
      { x: 300, y: 175 },
      { x: 320, y: 600 },
      { x: 260, y: 240 }
    ]
    for (const w of spots) {
      const g = buildRoute(ends.from, ends.to, [w], 'orthogonal')
      expect(reversals(g.samples), JSON.stringify(w)).toBe(0)
      expect(nearestOnRoute(g, w).dist).toBeLessThan(0.01)
    }
    for (const a of spots)
      for (const b of spots) {
        if (a === b) continue
        const g = buildRoute(ends.from, ends.to, [a, b], 'orthogonal')
        expect(nearestOnRoute(g, a).dist).toBeLessThan(0.01)
        expect(nearestOnRoute(g, b).dist).toBeLessThan(0.01)
        // the line always runs straight out of / into the cards
        expect(g.samples[1].y).toBe(100)
        expect(g.samples[g.samples.length - 2].y).toBe(250)
      }
    // a waypoint below both ends makes a U through it: down, across at the waypoint's height, up into the card
    const u = buildRoute(ends.from, ends.to, [{ x: 250, y: 400 }], 'orthogonal')
    expect(u.samples.map((s) => [s.x, s.y])).toEqual([
      [200, 100],
      [250, 100],
      [250, 400],
      [382, 400],
      [382, 250],
      [400, 250]
    ])
  })

  it('orthogonal: same-side and back-to-back ends still make clean right-angled routes', () => {
    const right = (r: typeof A, y: number): End => ({ point: { x: r.x + r.width, y }, normal: { x: 1, y: 0 }, side: 'right', manual: true })
    const left = (r: typeof A, y: number): End => ({ point: { x: r.x, y }, normal: { x: -1, y: 0 }, side: 'left', manual: true })
    const u = buildRoute(right(A, 100), right(B, 250), [], 'orthogonal')
    expect(Math.max(...u.samples.map((s) => s.x))).toBe(618) // around the further card
    const s = buildRoute(left(A, 100), right(B, 250), [], 'orthogonal')
    expect(s.samples.every((p, i) => i === 0 || p.x === s.samples[i - 1].x || p.y === s.samples[i - 1].y)).toBe(true)
  })

  it('overlapping cards fall back to a straight line in every style', () => {
    const over = autoEnds(A, 50, { x: 100, y: 100, width: 200, height: 300 }, 150)
    for (const style of ['curved', 'orthogonal', 'straight'] as const) {
      const g = buildRoute(over.from, over.to, [], style)
      expect(g.d).toBe('M100,150 L200,250')
      expect(g.style).toBe(style)
    }
  })
})

describe('hit-testing and markers', () => {
  const ends = autoEnds(A, 100, B, 250)

  it('nearestOnRoute tells which stretch is under the cursor (= where a new waypoint goes)', () => {
    const g = buildRoute(ends.from, ends.to, [{ x: 300, y: 50 }], 'straight')
    const first = nearestOnRoute(g, { x: 250, y: 80 })
    expect(first.seg).toBe(0)
    expect(first.dist).toBeLessThan(5)
    const second = nearestOnRoute(g, { x: 352, y: 150 })
    expect(second.seg).toBe(1)
    expect(second.len).toBeGreaterThan(first.len)
    // on a curve the hit follows the curve, not the chord
    const c = buildRoute(ends.from, ends.to, [], 'curved')
    const mid = pointAtLength(c, c.length / 2)
    expect(nearestOnRoute(c, mid).dist).toBeLessThan(0.01)
    expect(nearestOnRoute(c, { x: 210, y: 100 }).dist).toBeLessThan(1)
    expect(nearestOnRoute(c, { x: 250, y: 137.5 }).dist).toBeGreaterThan(8) // the chord's point is off the S-curve
  })

  it('insert / move / remove a waypoint', () => {
    let r = insertWaypoint(undefined, 0, { x: 1, y: 2 })
    expect(r.waypoints).toEqual([{ x: 1, y: 2 }])
    r = insertWaypoint(r, 1, { x: 5, y: 6 })
    r = insertWaypoint(r, 1, { x: 3, y: 4 })
    expect(r.waypoints).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }])
    r = insertWaypoint(r, 99, { x: 7, y: 8 })
    expect(r.waypoints).toHaveLength(4)
    r = moveWaypoint(r, 1, { x: 30, y: 40 })
    expect(r.waypoints![1]).toEqual({ x: 30, y: 40 })
    expect(moveWaypoint(r, 9, { x: 0, y: 0 })).toBe(r)
    r = removeWaypoint(r, 0)
    expect(r.waypoints![0]).toEqual({ x: 30, y: 40 })
    const one = removeWaypoint({ style: 'curved', waypoints: [{ x: 1, y: 1 }] }, 0)
    expect(one).toEqual({ style: 'curved' })
  })

  it('translateRoute moves the waypoints and keeps the anchors', () => {
    const r = translateRoute({ waypoints: [{ x: 1, y: 2 }], from: { side: 'top', t: 0.3 } }, 10, -5)
    expect(r).toEqual({ waypoints: [{ x: 11, y: -3 }], from: { side: 'top', t: 0.3 } })
    const none = { style: 'curved' as const }
    expect(translateRoute(none, 5, 5)).toBe(none)
  })

  it('markers follow the direction of the line at its ends', () => {
    // horizontal start, vertical end
    const from: End = { point: { x: 0, y: 0 }, normal: { x: 1, y: 0 }, side: 'right', manual: false }
    const to: End = { point: { x: 200, y: 200 }, normal: { x: 0, y: -1 }, side: 'top', manual: false }
    for (const style of ['curved', 'orthogonal'] as const) {
      const g = buildRoute(from, to, [], style)
      const d = edgeDecor(g)
      // near the start the line runs along +x: the marker sits beside it (offset in y), not on it
      expect(Math.abs(d.l1.y)).toBeGreaterThan(6)
      expect(d.l1.x).toBeGreaterThan(0)
      // near the end the line runs along +y: the marker is offset in x
      expect(Math.abs(d.l2.x - 200)).toBeGreaterThan(6)
      expect(d.l2.y).toBeLessThan(200)
    }
    const s = edgeDecor(buildRoute(from, to, [], 'straight'))
    expect(s.mid).toMatchObject({ x: 100, y: 100 })
    expect(s.mid.angle).toBeCloseTo(45)
  })

  it('the direction arrow sits on a straight stretch of an orthogonal line, never on a corner', () => {
    const ends2 = autoEnds(A, 100, B, 250)
    const g = buildRoute(ends2.from, ends2.to, [], 'orthogonal')
    const d = edgeDecor(g)
    // middle of the vertical leg at x = 300
    expect(d.mid.x).toBe(300)
    expect(d.mid.y).toBe(175)
    expect(Math.abs(d.mid.angle)).toBe(90)
  })
})

describe('pinch point handles and shared ends', () => {
  const ends = (a = A, b = B) => resolveEnds(a, null, b, null, undefined)
  it('offers a "+" handle in the middle of every stretch, on the line', () => {
    for (const style of ['curved', 'orthogonal', 'straight'] as const) {
      const e = ends()
      const g = buildRoute(e.from, e.to, [{ x: 300, y: 600 }], style)
      const mids = segmentMidpoints(g)
      expect(mids.map((m) => m.seg)).toEqual([0, 1])
      for (const m of mids) expect(nearestOnRoute(g, m).dist).toBeLessThan(1)
      // inserting at a handle keeps the existing pinch point and puts the new one before / after it
      expect(insertWaypoint({ waypoints: [{ x: 300, y: 600 }] }, mids[0].seg, mids[0]).waypoints![1]).toEqual({ x: 300, y: 600 })
      expect(insertWaypoint({ waypoints: [{ x: 300, y: 600 }] }, mids[1].seg, mids[1]).waypoints![0]).toEqual({ x: 300, y: 600 })
    }
  })
  it('skips stretches too short to hold a handle', () => {
    const e = resolveEnds({ x: 0, y: 0, width: 100, height: 40 }, null, { x: 110, y: 0, width: 100, height: 40 }, null, undefined)
    expect(segmentMidpoints(buildRoute(e.from, e.to, [], 'straight'))).toEqual([])
  })
  it('spreads lines sharing one side of a chip, ordered by where they go (no crossing at the start)', () => {
    const chip = { x: 0, y: 0, width: 220, height: 40 }
    const pts = spreadAlongSide(chip, 'right', [{ x: 600, y: 500 }, { x: 600, y: -300 }, { x: 600, y: 20 }])
    expect(pts.every((p) => p.x === 220)).toBe(true)
    expect(pts[1].y).toBeLessThan(pts[2].y)
    expect(pts[2].y).toBeLessThan(pts[0].y)
    expect(new Set(pts.map((p) => p.y)).size).toBe(3)
    expect(pts[1].y).toBeGreaterThanOrEqual(0)
    expect(pts[0].y).toBeLessThanOrEqual(40)
    expect(spreadAlongSide(chip, 'bottom', [{ x: 5, y: 900 }])[0]).toEqual({ x: 110, y: 40 })
  })
  it('clears pinch points and manual ends after an arrange, keeps the style', () => {
    expect(routeAfterArrange({ style: 'straight', waypoints: [{ x: 1, y: 2 }], from: { side: 'top', t: 0.5 } })).toEqual({ style: 'straight' })
    expect(routeAfterArrange({ waypoints: [{ x: 1, y: 2 }] })).toBeUndefined()
    expect(routeAfterArrange(undefined)).toBeUndefined()
  })
})

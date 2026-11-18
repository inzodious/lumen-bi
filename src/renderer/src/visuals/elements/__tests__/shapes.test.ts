import { SHAPE_KINDS, normalizeShapeKind, roundedButtonKind, shapePath } from '../shapes'

function coords(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
}

describe('shape geometry', () => {
  it('produces a closed path within the box for every kind', () => {
    for (const k of SHAPE_KINDS) {
      const d = shapePath(k, 0, 0, 200, 100, { radius: 12 })
      expect(d.length).toBeGreaterThan(5)
      if (k !== 'line') expect(d.trim().endsWith('Z')).toBe(true)
      // arc commands contain flags; check only that coordinates stay in a sane range
      for (const n of coords(d)) expect(n).toBeLessThanOrEqual(200.01)
    }
  })

  it('rounded rectangle uses arcs with the radius, clamped to half the size', () => {
    expect(shapePath('rectangleRounded', 0, 0, 100, 50, { radius: 10 })).toContain('A10 10')
    expect(shapePath('rectangleRounded', 0, 0, 100, 20, { radius: 40 })).toContain('A10 10')
  })

  it('normalizes aliases and unknown kinds', () => {
    expect(normalizeShapeKind('rectangleRounded')).toBe('rectangleRounded')
    expect(normalizeShapeKind('Ellipse')).toBe('oval')
    expect(normalizeShapeKind('arrow_right')).toBe('arrow')
    expect(normalizeShapeKind('tabroundtopcorners')).toBe('tabRoundTopCorners')
    expect(normalizeShapeKind('nonsense')).toBe('rectangle')
  })
})

describe('button / navigator rounded corners', () => {
  it('a rectangle with a corner radius is drawn rounded; other shapes and radius 0 are unchanged', () => {
    expect(roundedButtonKind('rectangle', 10)).toBe('rectangleRounded')
    expect(roundedButtonKind('rectangle', 0)).toBe('rectangle')
    expect(roundedButtonKind('oval', 10)).toBe('oval')
    expect(roundedButtonKind('rectangleRounded', 4)).toBe('rectangleRounded')
    // the rounded path has arcs / curves at the corners
    expect(shapePath(roundedButtonKind('rectangle', 10), 0, 0, 200, 30, { radius: 10 })).toMatch(/[AQC]/)
  })
})

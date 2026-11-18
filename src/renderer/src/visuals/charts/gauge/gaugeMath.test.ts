import { describe, expect, it } from 'vitest'
import { gaugeAngle, gaugeFraction, gaugeRange } from './gaugeMath'
import { distanceText, kpiDirection, kpiDistance, kpiStatus, signedPercent } from './kpiMath'

describe('gauge range', () => {
  it('PBI default: min 0, max = 2 × value', () => {
    expect(gaugeRange({ value: 50 })).toEqual({ min: 0, max: 100, target: null, defaultMax: true })
  })
  it('fields win over format-pane axis values', () => {
    const r = gaugeRange({ value: 50, minField: 10, maxField: 80, targetField: 60, axisMin: 0, axisMax: 1000, axisTarget: 5 })
    expect(r).toEqual({ min: 10, max: 80, target: 60, defaultMax: false })
    expect(gaugeRange({ value: 50, axisMin: 20, axisMax: 70, axisTarget: 65 })).toEqual({ min: 20, max: 70, target: 65, defaultMax: false })
  })
  it('extends the default max to the target', () => {
    expect(gaugeRange({ value: 50, targetField: 140 }).max).toBe(140)
    expect(gaugeRange({ value: 50, targetField: 70 }).max).toBe(100)
  })
  it('negative and zero values', () => {
    expect(gaugeRange({ value: -20 })).toMatchObject({ min: -40, max: 0 })
    expect(gaugeRange({ value: 0 })).toMatchObject({ min: 0, max: 1 })
    // inverted explicit bounds are repaired
    const bad = gaugeRange({ value: 5, axisMin: 10, axisMax: 10 })
    expect(bad.max).toBeGreaterThan(bad.min)
  })
  it('fraction and angle are clamped to the arc', () => {
    expect(gaugeFraction(150, 0, 100)).toBe(1)
    expect(gaugeFraction(-5, 0, 100)).toBe(0)
    expect(gaugeAngle(50, 0, 100)).toBeCloseTo(0)
    expect(gaugeAngle(0, 0, 100)).toBeCloseTo(-Math.PI / 2)
  })
})

describe('KPI status and distance', () => {
  it('direction resolution', () => {
    expect(kpiDirection('Low is good', 'Positive')).toBe('low')
    expect(kpiDirection(undefined, 'Negative')).toBe('low')
    expect(kpiDirection(undefined, undefined)).toBe('high')
  })
  it('one goal: good when the goal is met', () => {
    expect(kpiStatus(100, [90], 'high')).toBe('good')
    expect(kpiStatus(90, [90], 'high')).toBe('good')
    expect(kpiStatus(80, [90], 'high')).toBe('bad')
    expect(kpiStatus(80, [90], 'low')).toBe('good')
    expect(kpiStatus(95, [90], 'low')).toBe('bad')
  })
  it('two goals: neutral between them', () => {
    expect(kpiStatus(100, [80, 120], 'high')).toBe('neutral')
    expect(kpiStatus(130, [120, 80], 'high')).toBe('good')
    expect(kpiStatus(70, [80, 120], 'high')).toBe('bad')
    expect(kpiStatus(70, [80, 120], 'low')).toBe('good')
    expect(kpiStatus(130, [80, 120], 'low')).toBe('bad')
  })
  it('missing goal or value → no status', () => {
    expect(kpiStatus(100, [], 'high')).toBe('none')
    expect(kpiStatus(100, [null], 'high')).toBe('none')
    expect(kpiStatus(null, [5], 'high')).toBe('none')
  })
  it('distance texts', () => {
    expect(kpiDistance(110, 100)).toEqual({ abs: 10, pct: 0.1 })
    expect(kpiDistance(-50, -100).pct).toBeCloseTo(0.5)
    expect(kpiDistance(5, 0).pct).toBeNull()
    expect(signedPercent(0.1234)).toBe('+12.34%')
    expect(signedPercent(-0.031, 1)).toBe('-3.1%')
    expect(distanceText(undefined, '+1.00%', '+10')).toBe('+1.00%')
    expect(distanceText('Value', '+1.00%', '+10')).toBe('+10')
    expect(distanceText('Value, percent', '+1.00%', '+10')).toBe('+10, +1.00%')
  })
})

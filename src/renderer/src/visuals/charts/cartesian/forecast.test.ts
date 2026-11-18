import { describe, expect, it } from 'vitest'
import { acf, axisStepper, detectSeasonality, etsForecast, fillGaps, forecastSeries, horizonPoints, invNorm, nelderMead, readForecastSpecs } from './forecast'
import { resolveTheme } from '@core/report/theme'

/** deterministic pseudo-random noise */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

const seasonalSeries = (n: number, period = 12, noise = 2) => {
  const r = rng(7)
  return Array.from({ length: n }, (_, t) => 100 + 2 * t + 15 * Math.sin((2 * Math.PI * t) / period) + noise * r())
}

describe('statistics helpers', () => {
  it('invNorm matches the standard normal quantiles', () => {
    expect(invNorm(0.975)).toBeCloseTo(1.959964, 5)
    expect(invNorm(0.5)).toBeCloseTo(0, 8)
    expect(invNorm(0.995)).toBeCloseTo(2.575829, 5)
    expect(invNorm(0.875)).toBeCloseTo(1.150349, 5)
    expect(invNorm(0.01)).toBeCloseTo(-2.326348, 5)
  })
  it('acf of a periodic series peaks at its period', () => {
    const y = Array.from({ length: 48 }, (_, t) => Math.sin((2 * Math.PI * t) / 6))
    expect(acf(y, 6)).toBeGreaterThan(0.8)
    expect(acf(y, 3)).toBeLessThan(-0.8)
  })
  it('nelderMead minimises a quadratic', () => {
    const x = nelderMead((v) => (v[0] - 3) ** 2 + (v[1] + 1) ** 2, [0, 0])
    expect(x[0]).toBeCloseTo(3, 3)
    expect(x[1]).toBeCloseTo(-1, 3)
  })
  it('fillGaps interpolates interior nulls and trims the ends', () => {
    expect(fillGaps([null, 1, null, 3, null])).toEqual({ y: [1, 2, 3], first: 1, last: 3 })
    expect(fillGaps([null, null])).toBeNull()
  })
})

describe('seasonality detection', () => {
  it('finds a 12-point season in trending data', () => expect(detectSeasonality(seasonalSeries(60))).toBe(12))
  it('finds a 7-point (weekly) season', () => expect(detectSeasonality(seasonalSeries(70, 7))).toBe(7))
  it('returns 0 for a pure trend / white noise', () => {
    const r = rng(3)
    expect(detectSeasonality(Array.from({ length: 50 }, (_, t) => 10 + t + r()))).toBe(0)
    expect(detectSeasonality(Array.from({ length: 50 }, () => r()))).toBe(0)
  })
  it('respects the maximum period', () => expect(detectSeasonality(seasonalSeries(60), 6)).toBe(0))
})

describe('ETS forecast', () => {
  it('ETS(AAA) continues trend and season on seasonal data', () => {
    const y = seasonalSeries(60)
    const f = etsForecast(y, { horizon: 12, confidence: 0.95 })!
    expect(f.period).toBe(12)
    expect(f.damped).toBe(false)
    // compare with the true continuation (noise-free)
    for (let h = 0; h < 12; h++) {
      const t = 60 + h
      const truth = 100 + 2 * t + 15 * Math.sin((2 * Math.PI * t) / 12)
      expect(Math.abs(f.mean[h] - truth)).toBeLessThan(6)
      expect(f.lower[h]).toBeLessThan(f.mean[h])
      expect(f.upper[h]).toBeGreaterThan(f.mean[h])
    }
    // admissible parameters
    expect(f.params.alpha).toBeGreaterThan(0)
    expect(f.params.beta).toBeLessThanOrEqual(f.params.alpha)
    expect(f.params.gamma).toBeLessThanOrEqual(1 - f.params.alpha)
  })
  it('uses a damped trend without seasonality', () => {
    const r = rng(11)
    const y = Array.from({ length: 30 }, (_, t) => 50 + 3 * t + r())
    const f = etsForecast(y, { horizon: 10, confidence: 0.95 })!
    expect(f.period).toBe(0)
    expect(f.damped).toBe(true)
    expect(f.params.phi).toBeGreaterThanOrEqual(0.8)
    expect(f.params.phi).toBeLessThanOrEqual(0.98)
    // increasing, but slower than the linear trend (damping)
    expect(f.mean[0]).toBeGreaterThan(y[29])
    expect(f.mean[9]).toBeGreaterThan(f.mean[0])
    expect(f.mean[9]).toBeLessThanOrEqual(50 + 3 * 39 + 1)
  })
  it('prediction intervals widen with the horizon and with the confidence level', () => {
    const y = seasonalSeries(48, 12, 6)
    const f95 = etsForecast(y, { horizon: 8, confidence: 0.95 })!
    const f75 = etsForecast(y, { horizon: 8, confidence: 0.75 })!
    const w = (f: typeof f95, h: number) => f.upper[h] - f.lower[h]
    expect(w(f95, 7)).toBeGreaterThanOrEqual(w(f95, 0))
    expect(w(f95, 3)).toBeGreaterThan(w(f75, 3))
    // the width ratio is the ratio of z values
    expect(w(f95, 0) / w(f75, 0)).toBeCloseTo(invNorm(0.975) / invNorm(0.875), 4)
  })
  it('honours a manual season', () => {
    const f = etsForecast(seasonalSeries(60), { horizon: 4, confidence: 0.9, seasonality: 6 })!
    expect(f.period).toBe(6)
  })
  it('drops seasonality when there are fewer than two cycles', () => {
    const f = etsForecast(seasonalSeries(20), { horizon: 4, confidence: 0.9, seasonality: 12 })!
    expect(f.period).toBe(0)
  })
  it('returns null on too little data', () => expect(etsForecast([1, 2], { horizon: 3, confidence: 0.95 })).toBeNull())
})

describe('axis stepping and units', () => {
  const d = (s: string) => Date.parse(s + 'T00:00:00Z')
  it('steps monthly date axes by calendar months', () => {
    const xs = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01'].map(d)
    const step = axisStepper(xs, true)
    expect(new Date(step(xs[3], 1)).toISOString().slice(0, 10)).toBe('2024-05-01')
    expect(new Date(step(xs[3], 10)).toISOString().slice(0, 10)).toBe('2025-02-01')
  })
  it('month-end dates stay at month end', () => {
    const xs = ['2024-01-31', '2024-02-29', '2024-03-31'].map(d)
    const step = axisStepper(xs, true)
    expect(new Date(step(xs[2], 1)).toISOString().slice(0, 10)).toBe('2024-04-30')
  })
  it('steps numeric axes by the median gap', () => {
    const step = axisStepper([2018, 2019, 2020, 2021], false)
    expect(step(2021, 2)).toBe(2023)
  })
  it('converts time units to points (3 months on a daily axis ≈ 91 days)', () => {
    const xs = Array.from({ length: 10 }, (_, i) => d('2024-01-01') + i * 86400000)
    const step = axisStepper(xs, true)
    expect(horizonPoints(xs[9], 3, 2, step, true)).toBe(91)
    expect(horizonPoints(xs[9], 12, 7, step, true)).toBe(12)
  })
})

describe('PBIR forecast object', () => {
  const theme = resolveTheme()
  const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
  const objects = {
    forecast: [
      {
        properties: {
          show: lit('true'),
          displayName: lit("'Sales Forecast'"),
          transform: {
            algorithm: 'Forecast',
            parameters: [
              { Literal: { Value: '2D' }, Name: 'Unit' },
              { Literal: { Value: '3D' }, Name: 'ForecastLength' },
              { Literal: { Value: '1D' }, Name: 'IgnoreLast' },
              { Literal: { Value: '0.9D' }, Name: 'ConfidenceLevel' },
              { Literal: { Value: '12D' }, Name: 'MaxSeasonality' }
            ]
          },
          style: lit("'dashed'"),
          width: lit('3D'),
          bandAreaTransparency: lit('60D')
        },
        selector: { metadata: 'Sales.Total Sales', id: '1' }
      },
      { properties: { show: lit('false') } }
    ]
  }
  it('reads parameters and formatting', () => {
    const [s, ...rest] = readForecastSpecs(objects, theme)
    expect(rest).toHaveLength(0)
    expect(s).toMatchObject({ metadata: 'Sales.Total Sales', displayName: 'Sales Forecast', unit: 2, length: 3, ignoreLast: 1, confidence: 0.9, seasonality: 12, style: 'dashed', width: 3 })
    expect(s.bandArea.show).toBe(true)
    expect(s.bandArea.opacity).toBeCloseTo(0.4)
  })
  it('defaults: 10 points, 95 %, automatic seasonality', () => {
    const [s] = readForecastSpecs({ forecast: [{ properties: { show: lit('true') } }] }, theme)
    expect(s).toMatchObject({ unit: 7, length: 10, ignoreLast: 0, confidence: 0.95, seasonality: undefined })
  })
  it('forecastSeries continues a monthly date axis and honours "ignore last"', () => {
    const xs = Array.from({ length: 36 }, (_, i) => Date.UTC(2021, i, 1))
    const ys = seasonalSeries(36)
    const [spec] = readForecastSpecs({ forecast: [{ properties: { show: lit('true'), transform: { parameters: [{ Name: 'ForecastLength', Literal: { Value: '6D' } }, { Name: 'IgnoreLast', Literal: { Value: '2D' } }] } } }] }, theme)
    const f = forecastSeries(xs, ys, spec, true)!
    expect(f.anchor.x).toBe(xs[33])
    // 2 ignored points + 6 beyond the last actual point
    expect(f.points).toHaveLength(8)
    expect(f.points[0].x).toBe(xs[34])
    expect(new Date(f.points[7].x).toISOString().slice(0, 10)).toBe('2024-06-01')
  })
})

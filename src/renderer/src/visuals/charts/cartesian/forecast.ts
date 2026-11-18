/**
 * Analytics pane ▸ Forecast for line charts.
 *
 * PBIR shape (as written by Power BI Desktop; see e.g. the line charts with forecasts in Microsoft's
 * public BCApps PBIR reports):
 *
 *   objects.forecast: [{
 *     properties: {
 *       show, displayName, lineColor, style, width, dashArray, dashCap, strokeTransparency,
 *       interpolation, interpolationSmooth, interpolationSmoothParam, interpolationStep, matchSeriesInterpolation,
 *       bandAreaShow, bandAreaColor, bandAreaMatchColor, bandAreaTransparency,
 *       bandLineShow, bandLineColor, bandLineMatchColor, bandLinePattern, bandLineWidth, bandLineTransparency, bandLineDashArray, bandLineDashCap,
 *       transform: { algorithm: 'Forecast', parameters: [
 *         { Name: 'Unit', Literal: { Value: '7D' } },            // 7 = Points, 2 = Months (see FORECAST_UNITS)
 *         { Name: 'ForecastLength', Literal: { Value: '10D' } },
 *         { Name: 'IgnoreLast', Literal: { Value: '0D' } },
 *         { Name: 'ConfidenceLevel', Literal: { Value: '0.95D' } },
 *         { Name: 'MaxSeasonality', Literal: { Value: '12D' } } ] } },
 *     selector: { metadata: '<measure queryRef>', id: '1' } }]
 *
 * The formatting keys come from Microsoft's report-theme JSON schema (visual-lineChart.forecast). The
 * `transform` parameter names are taken from real files; the meaning of the `Unit` enum values other
 * than 7 (Points: used with numeric/year axes and with the default settings) and 2 (Months: daily date
 * axes forecasting "3") is not documented — the remaining values follow the order of PBI's Units list
 * and are an educated guess. `MaxSeasonality` is what PBI writes for the Seasonality box: a value ≥ 2
 * is used as the seasonal period (in points); 0/absent means "detect automatically".
 *
 * Algorithm. Power BI documents its forecast as exponential smoothing with automatic seasonality
 * detection: ETS(AAA) (additive Holt-Winters) when the series is seasonal, otherwise a damped-trend
 * model, with prediction intervals at the chosen confidence level. We implement exactly that model
 * family (Hyndman et al., "Forecasting with Exponential Smoothing", 2008):
 *   - seasonality: autocorrelation of the linearly detrended series; the strongest local ACF peak
 *     above a significance threshold, with at least two full cycles of data;
 *   - parameters: maximum likelihood (= minimum one-step SSE for additive errors) by Nelder-Mead over
 *     the admissible region (0<α<1, 0<β<α, 0<γ<1−α, 0.8≤φ≤0.98);
 *   - intervals: ŷ ± z·σ·√(1 + Σ c_j²), c_j = α + β·φ_j + γ·[j mod m = 0] (class-1 ETS variance).
 * APPROXIMATION: PBI's exact initialisation and optimiser are not published, so numbers can differ
 * slightly from Power BI's (the shape — trend, seasonality, band width — matches).
 */
import { decodeValue } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'

// ------------------------------------------------------------------------------------------------
// statistics helpers
// ------------------------------------------------------------------------------------------------

/** Inverse of the standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function invNorm(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  let q: number
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** Sample autocorrelation at lag k. */
export function acf(y: number[], k: number): number {
  const n = y.length
  if (k >= n) return 0
  const m = y.reduce((a, b) => a + b, 0) / n
  let den = 0
  for (const v of y) den += (v - m) ** 2
  if (!den) return 0
  let num = 0
  for (let t = k; t < n; t++) num += (y[t] - m) * (y[t - k] - m)
  return num / den
}

function detrend(y: number[]): number[] {
  const n = y.length
  const mx = (n - 1) / 2
  const my = y.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (y[i] - my)
    den += (i - mx) ** 2
  }
  const b = den ? num / den : 0
  return y.map((v, i) => v - (my + b * (i - mx)))
}

/**
 * Automatic seasonality: the period (in points) with the strongest autocorrelation peak of the
 * detrended series, or 0 when the series isn't seasonal. Requires two full cycles of data.
 */
export function detectSeasonality(y: number[], maxPeriod?: number): number {
  const n = y.length
  const hi = Math.min(Math.floor(n / 2), maxPeriod && maxPeriod >= 2 ? Math.floor(maxPeriod) : Infinity, 400)
  if (hi < 2) return 0
  const r = detrend(y)
  const ac: number[] = [1]
  for (let k = 1; k <= hi + 1; k++) ac.push(acf(r, k))
  // significance: ~2 standard errors of a white-noise ACF, and at least a moderate correlation
  const thr = Math.max(0.3, 2 / Math.sqrt(n))
  let best = 0
  let bestV = thr
  for (let k = 2; k <= hi; k++) {
    const v = ac[k]
    if (v > bestV && v >= ac[k - 1] && v >= (ac[k + 1] ?? -Infinity)) {
      best = k
      bestV = v
    }
  }
  if (!best) return 0
  // a multiple of the true period also peaks: prefer the smallest divisor that peaks almost as high
  for (let k = 2; k < best; k++) if (best % k === 0 && ac[k] >= 0.85 * bestV && ac[k] >= ac[k - 1] && ac[k] >= ac[k + 1]) return k
  return best
}

// ------------------------------------------------------------------------------------------------
// ETS models
// ------------------------------------------------------------------------------------------------

interface EtsParams {
  alpha: number
  beta: number
  gamma: number
  phi: number
}

interface EtsState {
  level: number
  trend: number
  /** seasonal states, season[(t) mod m] for the next time index t */
  season: number[]
}

function initialState(y: number[], m: number): EtsState {
  if (m >= 2 && y.length >= 2 * m) {
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    const c1 = mean(y.slice(0, m))
    const c2 = mean(y.slice(m, 2 * m))
    const trend = (c2 - c1) / m
    // level at time 0 (before the first observation)
    const level = c1 - trend * ((m + 1) / 2)
    const season = y.slice(0, m).map((v, i) => v - (level + trend * (i + 1)))
    const sm = mean(season)
    return { level, trend, season: season.map((s) => s - sm) }
  }
  const k = Math.min(y.length, 10)
  const head = y.slice(0, k)
  const xs = head.map((_, i) => i + 1)
  const mx = xs.reduce((a, b) => a + b, 0) / k
  const my = head.reduce((a, b) => a + b, 0) / k
  let num = 0
  let den = 0
  for (let i = 0; i < k; i++) {
    num += (xs[i] - mx) * (head[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const trend = den ? num / den : 0
  return { level: my - trend * mx, trend, season: [] }
}

/** Run the model over y; returns the one-step SSE, fitted values and the final state. */
function runEts(y: number[], m: number, p: EtsParams, init: EtsState, trend: boolean): { sse: number; fitted: number[]; state: EtsState } {
  let l = init.level
  let b = trend ? init.trend : 0
  const s = init.season.slice()
  const fitted: number[] = []
  let sse = 0
  for (let t = 0; t < y.length; t++) {
    const si = m >= 2 ? t % m : -1
    const seas = si >= 0 ? s[si] : 0
    const yhat = l + p.phi * b + seas
    const e = y[t] - yhat
    fitted.push(yhat)
    sse += e * e
    const ln = l + p.phi * b + p.alpha * e
    b = trend ? p.phi * b + p.beta * e : 0
    l = ln
    if (si >= 0) s[si] = seas + p.gamma * e
  }
  // rotate seasonal states so season[0] belongs to time index y.length
  const season = m >= 2 ? s.map((_, i) => s[(y.length + i) % m]) : []
  return { sse, fitted, state: { level: l, trend: b, season } }
}

/** Nelder-Mead minimisation (small dimension). */
export function nelderMead(f: (x: number[]) => number, x0: number[], step = 0.5, iters = 400): number[] {
  const n = x0.length
  let pts: Array<{ x: number[]; v: number }> = [{ x: x0, v: f(x0) }]
  for (let i = 0; i < n; i++) {
    const x = x0.slice()
    x[i] += step
    pts.push({ x, v: f(x) })
  }
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a.v - b.v)
    if (Math.abs(pts[n].v - pts[0].v) <= 1e-10 * (Math.abs(pts[0].v) + 1e-12)) break
    const c = new Array(n).fill(0)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i].x[j] / n
    const worst = pts[n]
    const at = (t: number) => c.map((cj, j) => cj + t * (worst.x[j] - cj))
    const xr = at(-1)
    const vr = f(xr)
    if (vr < pts[0].v) {
      const xe = at(-2)
      const ve = f(xe)
      pts[n] = ve < vr ? { x: xe, v: ve } : { x: xr, v: vr }
    } else if (vr < pts[n - 1].v) pts[n] = { x: xr, v: vr }
    else {
      const xc = at(vr < worst.v ? -0.5 : 0.5)
      const vc = f(xc)
      if (vc < Math.min(vr, worst.v)) pts[n] = { x: xc, v: vc }
      else {
        const best = pts[0].x
        pts = pts.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => best[j] + 0.5 * (v - best[j])), v: 0 })).map((p, i) => (i === 0 ? p : { x: p.x, v: f(p.x) }))
      }
    }
  }
  pts.sort((a, b) => a.v - b.v)
  return pts[0].x
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x))

export interface ForecastOptions {
  /** number of points to forecast after the last (used) observation */
  horizon: number
  /** 0.75 … 0.99 */
  confidence: number
  /** manual seasonal period in points (≥ 2); otherwise detected */
  seasonality?: number
  /** upper bound for automatic detection */
  maxSeasonality?: number
}

export interface ForecastResult {
  mean: number[]
  lower: number[]
  upper: number[]
  /** seasonal period used (0 = none) */
  period: number
  damped: boolean
  params: EtsParams
  sigma: number
  fitted: number[]
}

/**
 * Exponential smoothing forecast: ETS(A,A,A) when seasonal, ETS(A,Ad,N) otherwise. `y` must be evenly
 * spaced and gap-free (see `fillGaps`). Returns null with fewer than 3 observations.
 */
export function etsForecast(y: number[], opts: ForecastOptions): ForecastResult | null {
  const n = y.length
  const H = Math.max(0, Math.floor(opts.horizon))
  if (n < 3 || !y.every(Number.isFinite)) return null
  let m = opts.seasonality && opts.seasonality >= 2 ? Math.floor(opts.seasonality) : detectSeasonality(y, opts.maxSeasonality)
  if (m >= 2 && n < 2 * m) m = 0
  const seasonal = m >= 2
  const damped = !seasonal
  const useTrend = n >= 4
  const init = initialState(y, seasonal ? m : 0)
  const scale = Math.max(1e-9, Math.sqrt(y.reduce((a, v) => a + v * v, 0) / n))
  // unconstrained → admissible parameters
  const decode = (x: number[]): EtsParams => {
    const alpha = 0.0001 + 0.9998 * logistic(x[0])
    const beta = useTrend ? alpha * logistic(x[1]) : 0
    const gamma = seasonal ? (1 - alpha) * logistic(x[2]) : 0
    const phi = damped && useTrend ? 0.8 + 0.18 * logistic(x[3]) : 1
    return { alpha, beta, gamma, phi }
  }
  const obj = (x: number[]) => {
    const r = runEts(y, seasonal ? m : 0, decode(x), init, useTrend)
    return Number.isFinite(r.sse) ? r.sse / (scale * scale) : 1e300
  }
  let bestX: number[] = []
  let bestV = Infinity
  // a few starting points (the SSE surface has local minima)
  for (const a0 of [-1, 0.5, 2]) {
    const x = nelderMead(obj, [a0, -1.5, -1.5, 1])
    const v = obj(x)
    if (v < bestV) (bestV = v), (bestX = x)
  }
  const params = decode(bestX)
  const run = runEts(y, seasonal ? m : 0, params, init, useTrend)
  const k = 1 + (useTrend ? 1 : 0) + (seasonal ? 1 : 0) + (damped && useTrend ? 1 : 0) + 2 + (seasonal ? m - 1 : 0)
  const sigma = Math.sqrt(run.sse / Math.max(1, n - Math.min(k, n - 1)))
  const z = invNorm(0.5 + Math.max(0.5, Math.min(0.999, opts.confidence)) / 2)
  const { level, trend, season } = run.state
  const mean: number[] = []
  const lower: number[] = []
  const upper: number[] = []
  let phiSum = 0
  let varSum = 1
  for (let h = 1; h <= H; h++) {
    phiSum += params.phi ** h
    const f = level + (useTrend ? phiSum * trend : 0) + (seasonal ? season[(h - 1) % m] : 0)
    if (h > 1) {
      const j = h - 1
      let phiJ = 0
      for (let i = 1; i <= j; i++) phiJ += params.phi ** i
      const c = params.alpha + params.beta * phiJ + (seasonal && j % m === 0 ? params.gamma : 0)
      varSum += c * c
    }
    const half = z * sigma * Math.sqrt(varSum)
    mean.push(f)
    lower.push(f - half)
    upper.push(f + half)
  }
  return { mean, lower, upper, period: seasonal ? m : 0, damped: damped && useTrend, params, sigma, fitted: run.fitted }
}

/** Linear interpolation of interior gaps; leading/trailing nulls are dropped. */
export function fillGaps(values: Array<number | null>): { y: number[]; first: number; last: number } | null {
  let first = -1
  let last = -1
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) {
      if (first < 0) first = i
      last = i
    }
  })
  if (first < 0) return null
  const y: number[] = []
  let prevI = first
  for (let i = first; i <= last; i++) {
    const v = values[i]
    if (v !== null && Number.isFinite(v)) {
      y.push(v)
      prevI = i
    } else {
      let nextI = i + 1
      while (nextI <= last && (values[nextI] === null || !Number.isFinite(values[nextI] as number))) nextI++
      const a = values[prevI] as number
      const b = values[nextI] as number
      y.push(a + ((b - a) * (i - prevI)) / (nextI - prevI))
    }
  }
  return { y, first, last }
}

// ------------------------------------------------------------------------------------------------
// X axis stepping (forecast points continue the axis at the data's own spacing)
// ------------------------------------------------------------------------------------------------

const DAY = 86400000

/** PBI forecast units (transform parameter `Unit`). Only 2 (Months) and 7 (Points) are confirmed from real files. */
export const FORECAST_UNITS: Record<number, 'years' | 'quarters' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'points'> = {
  0: 'years',
  1: 'quarters',
  2: 'months',
  3: 'weeks',
  4: 'days',
  5: 'hours',
  6: 'minutes',
  7: 'points'
}

function addMonths(t: number, k: number): number {
  const d = new Date(t)
  const day = d.getUTCDate()
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()))
  const dim = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
  r.setUTCDate(Math.min(day, dim))
  return r.getTime()
}

/**
 * Step function continuing an evenly spaced axis. Date axes whose points sit on the same day of
 * month (monthly / quarterly / yearly grains) step by calendar months; otherwise by the median gap.
 */
export function axisStepper(xs: number[], isDate: boolean): (x: number, k: number) => number {
  const gaps = xs
    .slice(1)
    .map((x, i) => x - xs[i])
    .filter((g) => g > 0)
    .sort((a, b) => a - b)
  const med = gaps.length ? gaps[gaps.length >> 1] : 1
  if (isDate && med >= 27 * DAY) {
    const ds = xs.map((x) => new Date(x))
    const sameDay = ds.every((d) => d.getUTCDate() === ds[0].getUTCDate() || d.getUTCDate() >= 28)
    if (sameDay) {
      const months = Math.max(1, Math.round(med / (30.4375 * DAY)))
      return (x, k) => addMonths(x, months * k)
    }
  }
  return (x, k) => x + med * k
}

/** Number of points covering `length` units after `lastX`. */
export function horizonPoints(lastX: number, length: number, unit: number, step: (x: number, k: number) => number, isDate: boolean): number {
  const kind = FORECAST_UNITS[unit] ?? 'points'
  if (kind === 'points' || !isDate) return Math.max(0, Math.round(length))
  let end: number
  switch (kind) {
    case 'years':
      end = addMonths(lastX, 12 * length)
      break
    case 'quarters':
      end = addMonths(lastX, 3 * length)
      break
    case 'months':
      end = addMonths(lastX, length)
      break
    case 'weeks':
      end = lastX + 7 * DAY * length
      break
    case 'days':
      end = lastX + DAY * length
      break
    case 'hours':
      end = lastX + 3600000 * length
      break
    default:
      end = lastX + 60000 * length
  }
  let k = 0
  while (k < 5000 && step(lastX, k + 1) <= end + 1) k++
  return k
}

// ------------------------------------------------------------------------------------------------
// PBIR reading
// ------------------------------------------------------------------------------------------------

export interface ForecastSpec {
  metadata?: string
  displayName: string
  unit: number
  length: number
  ignoreLast: number
  confidence: number
  seasonality?: number
  lineColor?: string
  style: string
  dashArray?: string
  width: number
  opacity: number
  interpolation: string
  bandArea: { show: boolean; color?: string; opacity: number }
  bandLine: { show: boolean; color?: string; style: string; dashArray?: string; width: number; opacity: number }
}

function literalNumber(v: unknown): number | undefined {
  if (v && typeof v === 'object' && 'Literal' in (v as any)) v = (v as any).Literal?.Value
  if (v && typeof v === 'object' && 'Value' in (v as any)) v = (v as any).Value
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return undefined
  const n = Number(v.replace(/[DLM]$/i, ''))
  return Number.isFinite(n) ? n : undefined
}

/** Read objects.forecast entries (only shown ones). */
export function readForecastSpecs(objects: any, theme: ResolvedTheme): ForecastSpec[] {
  const out: ForecastSpec[] = []
  for (const e of (objects?.forecast ?? []) as any[]) {
    const p = e?.properties ?? {}
    const dv = (k: string) => decodeValue(p[k], theme)
    if (dv('show') !== true) continue
    const params: Record<string, number | undefined> = {}
    for (const q of (p.transform?.parameters ?? []) as any[]) if (q?.Name) params[q.Name] = literalNumber(q.Literal ?? q.Value)
    const num = (k: string, d: number) => {
      const v = dv(k)
      return typeof v === 'number' && Number.isFinite(v) ? v : d
    }
    const str = (k: string) => (typeof dv(k) === 'string' ? (dv(k) as string) : undefined)
    const conf = params.ConfidenceLevel ?? 0.95
    const season = params.MaxSeasonality ?? params.Seasonality
    out.push({
      metadata: e.selector?.metadata,
      displayName: str('displayName') || 'Forecast',
      unit: params.Unit ?? 7,
      length: Math.max(0, params.ForecastLength ?? 10),
      ignoreLast: Math.max(0, Math.floor(params.IgnoreLast ?? 0)),
      confidence: conf > 1 ? conf / 100 : conf,
      seasonality: season !== undefined && season >= 2 ? season : undefined,
      lineColor: str('lineColor'),
      style: str('style') ?? 'solid',
      dashArray: str('dashArray'),
      width: num('width', 2),
      opacity: 1 - num('strokeTransparency', 0) / 100,
      interpolation: str('interpolation') ?? 'linear',
      bandArea: { show: dv('bandAreaShow') !== false, color: dv('bandAreaMatchColor') === false ? str('bandAreaColor') : undefined, opacity: 1 - num('bandAreaTransparency', 80) / 100 },
      bandLine: {
        show: dv('bandLineShow') === true,
        color: dv('bandLineMatchColor') === false ? str('bandLineColor') : undefined,
        style: str('bandLinePattern') ?? 'dashed',
        dashArray: str('bandLineDashArray'),
        width: num('bandLineWidth', 1),
        opacity: 1 - num('bandLineTransparency', 0) / 100
      }
    })
  }
  return out
}

/** PBI's default forecast line color (a neutral gray, like the other analytics lines). */
export const FORECAST_DEFAULT_COLOR = '#605E5C'

export interface SeriesForecast {
  spec: ForecastSpec
  /** forecast points continue the axis: [x, mean, lower, upper] */
  points: Array<{ x: number; mean: number; lower: number; upper: number }>
  /** last observation used (the forecast line starts there) */
  anchor: { x: number; y: number }
  result: ForecastResult
}

/**
 * Forecast one series on a continuous axis. `xs[i]` is the numeric axis value of category i (null
 * when unknown); values are aligned with xs.
 */
export function forecastSeries(xs: Array<number | null>, values: Array<number | null>, spec: ForecastSpec, isDate: boolean): SeriesForecast | null {
  const pairs = xs.map((x, i) => [x, values[i]] as const).filter((p): p is readonly [number, number | null] => p[0] !== null).sort((a, b) => a[0] - b[0])
  const filled = fillGaps(pairs.map((p) => p[1]))
  if (!filled) return null
  const axis = pairs.slice(filled.first, filled.last + 1).map((p) => p[0])
  const keep = filled.y.length - spec.ignoreLast
  if (keep < 3) return null
  const y = filled.y.slice(0, keep)
  const usedXs = axis.slice(0, keep)
  const step = axisStepper(axis, isDate)
  const lastAll = axis[axis.length - 1]
  // the forecast covers the ignored points and then `length` units beyond the last actual point
  const beyond = horizonPoints(lastAll, spec.length, spec.unit, step, isDate)
  const horizon = spec.ignoreLast + beyond
  if (horizon <= 0) return null
  const res = etsForecast(y, { horizon, confidence: spec.confidence, seasonality: spec.seasonality })
  if (!res) return null
  const x0 = usedXs[usedXs.length - 1]
  const points = res.mean.map((mean, h) => ({ x: step(x0, h + 1), mean, lower: res.lower[h], upper: res.upper[h] }))
  return { spec, points, anchor: { x: x0, y: y[y.length - 1] }, result: res }
}

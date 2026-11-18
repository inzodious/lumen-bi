/**
 * Anomaly detection for line charts (Analytics pane ▸ Find anomalies), basic version.
 *
 * APPROXIMATION: Power BI uses Azure's Spectral Residual + CNN model. We use a robust
 * statistical stand-in that behaves similarly on typical business series: the expected value is a
 * centred rolling median, the expected range is expected ± k·σ̂ where σ̂ = 1.4826·MAD of the
 * residuals, and k = 1.5 + 5·(1 − sensitivity) shrinks as the sensitivity grows (PBI default sensitivity 70 % → 3σ̂). Like PBI, at
 * least 12 points are required. The tooltip of the visual says the detection is approximate.
 */

export interface AnomalyResult {
  expected: Array<number | null>
  low: Array<number | null>
  high: Array<number | null>
  /** indices of anomalous points */
  anomalies: number[]
}

export const MIN_ANOMALY_POINTS = 12

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Band half-width multiplier for a sensitivity in 0..100 (higher = more anomalies). */
export function sensitivityToK(sensitivity: number): number {
  const s = Math.max(0, Math.min(100, sensitivity))
  return 1.5 + ((100 - s) / 100) * 5
}

export function detectAnomalies(values: Array<number | null>, sensitivity = 70): AnomalyResult | null {
  const idx: number[] = []
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) idx.push(i)
  })
  if (idx.length < MIN_ANOMALY_POINTS) return null
  const ys = idx.map((i) => values[i] as number)
  const n = ys.length
  const half = Math.max(2, Math.min(7, Math.floor(n / 10)))
  // odd reflection at the ends (y[-k] = 2·y[0] − y[k]) keeps the local trend for edge windows
  const at = (j: number) => (j < 0 ? 2 * ys[0] - ys[Math.min(n - 1, -j)] : j >= n ? 2 * ys[n - 1] - ys[Math.max(0, 2 * (n - 1) - j)] : ys[j])
  const exp = ys.map((_, i) => {
    const w: number[] = []
    for (let j = i - half; j <= i + half; j++) w.push(at(j))
    return median(w)
  })
  const resid = ys.map((y, i) => y - exp[i])
  const mad = median(resid.map((r) => Math.abs(r - median(resid))))
  let sigma = 1.4826 * mad
  if (!(sigma > 0)) {
    // flat series: fall back to the standard deviation (or a tiny epsilon)
    const m = resid.reduce((a, b) => a + b, 0) / n
    sigma = Math.sqrt(resid.reduce((a, r) => a + (r - m) ** 2, 0) / n) || Math.max(1e-9, Math.abs(median(ys)) * 1e-6)
  }
  const k = sensitivityToK(sensitivity)
  const expected: Array<number | null> = values.map(() => null)
  const low: Array<number | null> = values.map(() => null)
  const high: Array<number | null> = values.map(() => null)
  const anomalies: number[] = []
  idx.forEach((ci, j) => {
    expected[ci] = exp[j]
    low[ci] = exp[j] - k * sigma
    high[ci] = exp[j] + k * sigma
    if (ys[j] < (low[ci] as number) || ys[j] > (high[ci] as number)) anomalies.push(ci)
  })
  return { expected, low, high, anomalies }
}

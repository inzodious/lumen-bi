/**
 * Deneb (declarative Vega / Vega-Lite custom visual) — spec parsing, dataset assembly and the
 * Power BI theme → Vega config mapping. Pure (no vega import) so it is unit-testable.
 *
 * PBIR: objects.vega[0].properties = { provider: 'vegaLite'|'vega', jsonSpec, jsonConfig, enableTooltips,
 *   enableSelection, enableHighlight, renderMode: 'svg'|'canvas', ... }. Data comes from the `dataset`
 * role; Deneb names each field by its display name (special characters escaped) and adds
 * `<measure>__formatted` (formatted text), `__row__` (row index), `__selected__` and `__identity__`.
 */
import { decodeLiteral } from '@core/report/literal'
import type { ResolvedTheme } from '@core/report/theme'
import { shadeColor } from '@core/report/theme'

export type DenebProvider = 'vegaLite' | 'vega'

export interface DenebSettings {
  provider: DenebProvider
  spec?: Record<string, any>
  config: Record<string, any>
  specError?: string
  enableTooltips: boolean
  renderMode: 'svg' | 'canvas'
}

function lit(raw: any): any {
  return raw?.expr?.Literal ? decodeLiteral(raw.expr.Literal.Value) : undefined
}

/** JSON with tolerance for the comments Deneb's editor allows (// and /* *\/) and trailing commas. */
export function parseLooseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    // strip comments outside strings, then trailing commas
    let out = ''
    let inStr = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inStr) {
        out += c
        if (c === '\\') out += text[++i] ?? ''
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        out += c
      } else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++
        out += '\n'
      } else if (c === '/' && text[i + 1] === '*') {
        i += 2
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
        i++
      } else out += c
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  }
}

export function readDenebSettings(visualJson: any): DenebSettings {
  const props: Record<string, any> = Object.assign({}, ...((visualJson?.visual?.objects?.vega ?? []) as any[]).map((e) => e.properties ?? {}))
  const provider: DenebProvider = String(lit(props.provider) ?? 'vegaLite').toLowerCase() === 'vega' ? 'vega' : 'vegaLite'
  let spec: Record<string, any> | undefined
  let specError: string | undefined
  const specText = lit(props.jsonSpec)
  if (typeof specText === 'string' && specText.trim()) {
    try {
      spec = parseLooseJson(specText)
    } catch (e) {
      specError = `Specification JSON is invalid: ${e instanceof Error ? e.message : String(e)}`
    }
  } else specError = 'No specification has been provided (open the Deneb editor in Power BI to create one).'
  let config: Record<string, any> = {}
  const cfgText = lit(props.jsonConfig)
  if (typeof cfgText === 'string' && cfgText.trim()) {
    try {
      config = parseLooseJson(cfgText) ?? {}
    } catch {
      config = {}
    }
  }
  return {
    provider,
    spec,
    config,
    specError,
    enableTooltips: lit(props.enableTooltips) !== false,
    renderMode: String(lit(props.renderMode) ?? 'svg') === 'canvas' ? 'canvas' : 'svg'
  }
}

/** Deneb field-name encoding: characters that break Vega field access are replaced with `_`. */
export function denebFieldName(name: string): string {
  return name.replace(/[[\]\\."']/g, '_')
}

export interface DenebColumn {
  name: string
  isMeasure: boolean
}

/** Rows → Deneb dataset objects. `formatted(rowIndex, colIndex)` supplies the formatted text for measures. */
export function buildDenebDataset(columns: DenebColumn[], rows: unknown[][], formatted: (r: number, c: number) => string): Record<string, unknown>[] {
  const names = columns.map((c) => denebFieldName(c.name))
  return rows.map((row, r) => {
    const o: Record<string, unknown> = {}
    columns.forEach((c, i) => {
      o[names[i]] = row[i] ?? null
      if (c.isMeasure) o[`${names[i]}__formatted`] = formatted(r, i)
    })
    o.__row__ = r
    o.__selected__ = 'neutral'
    o.__identity__ = { row: r }
    return o
  })
}

/** Inject the dataset into the spec under the name `dataset` (Vega-Lite `datasets`, Vega `data[]`). */
export function attachDataset(spec: Record<string, any>, provider: DenebProvider, values: Record<string, unknown>[]): Record<string, any> {
  const s = structuredClone(spec)
  if (provider === 'vegaLite') {
    s.datasets = { ...(s.datasets ?? {}), dataset: values }
    if (!s.data && !s.layer && !s.hconcat && !s.vconcat && !s.concat && !s.repeat && !s.facet) s.data = { name: 'dataset' }
  } else {
    const data: any[] = Array.isArray(s.data) ? s.data : []
    const hit = data.find((d) => d?.name === 'dataset')
    if (hit) hit.values = values
    else data.unshift({ name: 'dataset', values })
    s.data = data
  }
  return s
}

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function deepMerge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  return out
}

/** Deneb's Power BI base config: theme palette as the category range, Segoe UI, PBI neutral text colors. */
export function pbiVegaConfig(theme: ResolvedTheme): Record<string, any> {
  const font = 'Segoe UI, Selawik, Open Sans, Noto Sans, sans-serif'
  const label = theme.foregroundNeutralSecondary ?? '#605E5C'
  const grid = '#E1DFDD'
  const colors = theme.dataColors
  return {
    autosize: { type: 'fit', contains: 'padding' },
    background: null,
    font,
    view: { stroke: null },
    range: {
      category: colors,
      ordinal: { scheme: 'blues' },
      ramp: [shadeColor(colors[0], 0.8), colors[0]],
      diverging: [theme.bad ?? '#D64554', '#F3F2F1', theme.good ?? '#1AAB40']
    },
    arc: { fill: colors[0] },
    area: { fill: colors[0], line: true, opacity: 0.6 },
    bar: { fill: colors[0] },
    line: { stroke: colors[0], strokeWidth: 3, strokeCap: 'round', strokeJoin: 'round' },
    point: { fill: colors[0], filled: true, size: 75 },
    rect: { fill: colors[0] },
    text: { font, fontSize: 12, fill: label },
    axis: {
      domain: false,
      grid: false,
      labelColor: label,
      labelFont: font,
      labelFontSize: 12,
      tickColor: grid,
      titleColor: label,
      titleFont: font,
      titleFontSize: 14,
      titleFontWeight: 'normal',
      gridColor: grid,
      gridDash: [1, 5]
    },
    axisQuantitative: { grid: true, tickCount: 3 },
    legend: { labelColor: label, labelFont: font, labelFontSize: 12, titleColor: label, titleFont: font, titleFontWeight: 'normal', symbolType: 'circle', symbolSize: 75 },
    header: { labelColor: label, labelFont: font, titleColor: label, titleFont: font },
    title: { color: theme.foreground, font, fontSize: 14, fontWeight: 'normal', anchor: 'start' }
  }
}

/** Deneb `pbiColor(index | name, shade)` → hex. */
export function pbiColor(theme: ResolvedTheme, ref: unknown, shade = 0): string {
  let base: string
  if (typeof ref === 'number') base = theme.dataColors[((Math.floor(ref) % theme.dataColors.length) + theme.dataColors.length) % theme.dataColors.length]
  else {
    const key = String(ref ?? '').toLowerCase()
    const named: Record<string, string | undefined> = {
      min: theme.minimum,
      middle: theme.center,
      max: theme.maximum,
      bad: theme.bad,
      neutral: theme.neutral,
      good: theme.good,
      foreground: theme.foreground,
      background: theme.background
    }
    base = named[key] ?? theme.dataColors[0]
  }
  return shade ? shadeColor(base, Math.max(-1, Math.min(1, Number(shade)))) : base
}

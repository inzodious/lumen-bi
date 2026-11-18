import { useEffect, useMemo, useRef, useState } from 'react'
import type { VisualHostContext, VisualProps } from '../contract'
import type { ResolvedTheme } from '@core/report/theme'
import { attachDataset, buildDenebDataset, deepMerge, pbiColor, pbiVegaConfig, readDenebSettings } from './denebModel'
import { cellFormat, runFieldQuery } from './fieldQuery'

/** Theme/formatter used by the global Deneb expression functions (vega registers them process-wide). */
const active: { theme?: ResolvedTheme; format?: VisualHostContext['format'] } = {}
let functionsRegistered: Promise<void> | undefined

function registerFunctions(): Promise<void> {
  functionsRegistered ??= import('vega').then((vega) => {
    vega.expressionFunction('pbiColor', (ref: unknown, shade?: number) => (active.theme ? pbiColor(active.theme, ref, shade ?? 0) : '#118DFF'))
    vega.expressionFunction('pbiFormat', (value: unknown, format?: string) => {
      if (value === null || value === undefined) return ''
      const f = active.format
      if (!f) return String(value)
      const v = value instanceof Date ? value : typeof value === 'number' ? value : String(value)
      return f(v, typeof format === 'string' && format ? format : undefined)
    })
    vega.expressionFunction('pbiFormatAutoUnit', (value: unknown, format?: string) => {
      if (typeof value !== 'number') return String(value ?? '')
      const a = Math.abs(value)
      const [d, s] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'bn'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, '']
      const body = active.format ? active.format(value / d, format || '#,0.##') : String(value / d)
      return body + s
    })
  })
  return functionsRegistered
}

export function DenebVisual({ visual, width, height, ctx }: VisualProps) {
  const settings = useMemo(() => readDenebSettings(visual.json), [visual.json])
  const data = useMemo(() => {
    try {
      const q = runFieldQuery(visual.json, ctx, ['dataset'], { limit: 10000 })
      const cols = q.fields.map((f) => ({ name: f.label, isMeasure: f.kind === 'value' }))
      const rows = q.result.rows.map((row) => q.fields.map((f) => row[f.index] ?? null))
      const values = buildDenebDataset(cols, rows, (r, c) => {
        const v = rows[r][c]
        return v === null ? '' : ctx.format(v, cellFormat(q, r, q.fields[c]))
      })
      return { values, error: undefined as string | undefined }
    } catch (e) {
      return { values: [], error: e instanceof Error ? e.message : String(e) }
    }
  }, [visual.json, ctx])

  const host = useRef<HTMLDivElement>(null)
  const [renderError, setRenderError] = useState<string>()

  useEffect(() => {
    const el = host.current
    if (!el || !settings.spec || data.error) return
    let disposed = false
    let finalize: (() => void) | undefined
    active.theme = ctx.theme
    active.format = ctx.format
    const spec = attachDataset(settings.spec, settings.provider, data.values)
    const config = deepMerge(pbiVegaConfig(ctx.theme), settings.config)
    setRenderError(undefined)
    Promise.all([registerFunctions(), import('vega-embed')])
      .then(async ([, mod]) => {
        if (disposed) return
        const embed = mod.default
        const res = await embed(el, spec as any, {
          mode: settings.provider === 'vega' ? 'vega' : 'vega-lite',
          actions: false,
          renderer: settings.renderMode,
          config: config as any,
          tooltip: settings.enableTooltips ? undefined : false,
          width: Math.max(0, width),
          height: Math.max(0, height),
          logLevel: 0
        } as any)
        if (disposed) res.finalize()
        else finalize = () => res.finalize()
      })
      .catch((e: unknown) => {
        if (!disposed) setRenderError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      disposed = true
      finalize?.()
      el.innerHTML = ''
    }
  }, [settings, data, width, height, ctx.theme, ctx.format])

  const message = settings.specError ?? data.error ?? renderError
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      <div ref={host} style={{ width, height }} />
      {message && (
        <div style={{ position: 'absolute', inset: 0, padding: 10, fontSize: 12, color: '#605E5C', background: 'rgba(255,255,255,0.92)', overflow: 'auto' }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: '#252423' }}>Deneb</div>
          {message}
        </div>
      )}
    </div>
  )
}

import { attachDataset, buildDenebDataset, deepMerge, denebFieldName, parseLooseJson, pbiColor, pbiVegaConfig, readDenebSettings } from '../denebModel'
import { resolveTheme } from '@core/report/theme'

const L = (v: string) => ({ expr: { Literal: { Value: `'${v.replace(/'/g, "''")}'` } } })

describe('Deneb', () => {
  it('reads provider, spec and config from objects.vega', () => {
    const s = readDenebSettings({
      visual: {
        objects: {
          vega: [{ properties: { provider: L('vegaLite'), jsonSpec: L('{ "mark": "bar", // comment\n "data": {"name": "dataset"}, }'), jsonConfig: L('{"font": "Segoe UI"}'), renderMode: L('svg') } }]
        }
      }
    })
    expect(s.provider).toBe('vegaLite')
    expect(s.spec).toEqual({ mark: 'bar', data: { name: 'dataset' } })
    expect(s.config).toEqual({ font: 'Segoe UI' })
    expect(s.specError).toBeUndefined()
    expect(readDenebSettings({ visual: {} }).specError).toBeTruthy()
  })

  it('builds the dataset with display names, __formatted and __row__', () => {
    const rows = buildDenebDataset(
      [
        { name: 'Region', isMeasure: false },
        { name: 'Total Sales', isMeasure: true },
        { name: 'Sales.Amt [x]', isMeasure: true }
      ],
      [['Europe', 1234.5, 1]],
      (r, c) => `f${r}${c}`
    )
    expect(rows[0]).toMatchObject({ Region: 'Europe', 'Total Sales': 1234.5, 'Total Sales__formatted': 'f01', 'Sales_Amt _x_': 1, __row__: 0 })
    expect(denebFieldName('a.b')).toBe('a_b')
  })

  it('attaches the dataset to vega-lite and vega specs without mutating the source', () => {
    const vl = { data: { name: 'dataset' }, mark: 'bar' }
    const out = attachDataset(vl, 'vegaLite', [{ a: 1 }])
    expect(out.datasets.dataset).toEqual([{ a: 1 }])
    expect((vl as any).datasets).toBeUndefined()
    const vg = attachDataset({ data: [{ name: 'other', values: [] }] }, 'vega', [{ a: 2 }])
    expect(vg.data[0]).toEqual({ name: 'dataset', values: [{ a: 2 }] })
    const vg2 = attachDataset({ data: [{ name: 'dataset', transform: [] }] }, 'vega', [{ a: 3 }])
    expect(vg2.data).toEqual([{ name: 'dataset', transform: [], values: [{ a: 3 }] }])
  })

  it('maps the PBI theme into a vega config, user config wins', () => {
    const theme = resolveTheme()
    const cfg = deepMerge(pbiVegaConfig(theme), { axis: { labelFontSize: 14 } })
    expect(cfg.range.category[0]).toBe(theme.dataColors[0])
    expect(cfg.axis.labelFontSize).toBe(14)
    expect(cfg.axis.labelColor).toBeTruthy()
    expect(pbiColor(theme, 1)).toBe(theme.dataColors[1])
    expect(pbiColor(theme, 'bad')).toBe(theme.bad)
    expect(pbiColor(theme, 0, 0.5)).not.toBe(theme.dataColors[0])
  })

  it('parses JSON with block comments and strings containing //', () => {
    expect(parseLooseJson('{"u": "http://x" /* c */, "b": [1,2,],}')).toEqual({ u: 'http://x', b: [1, 2] })
  })
})

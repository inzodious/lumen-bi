import { beforeEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import '../../visuals'
import { getVisual } from '../../visuals/registry'
import { REPORT_TEMPLATES, projectFromTemplate } from '@core/templates'
import { SAMPLE_DATA_FILE } from '@core/sample/dataset'
import { reportSampleDataOn, visualSampleSpec } from '@core/sample/spec'
import { useApp } from '../../state/store'
import { useInteraction } from '../../state/interaction'
import { sampleContext, sampleDrawFor, sampleHints, sampleStatus } from '../sampleData'
import { setSampleData, setVisualSampleData } from '../sampleActions'
import { buildVisualMenu } from '../Overlays'
import type { VisualHostContext } from '../../visuals/contract'

function readTemplate(id: string): Record<string, Uint8Array> {
  const root = join(__dirname, '../../../../core/templates', id)
  const out: Record<string, Uint8Array> = {}
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else out[relative(root, p).split('\\').join('/')] = new Uint8Array(readFileSync(p))
    }
  }
  walk(root)
  return out
}

const ON = { annotations: [{ name: 'Lumen_SampleData', value: 'on' }] }
const title = (text: string) => ({ title: [{ properties: { show: { expr: { Literal: { Value: 'true' } } }, text: { expr: { Literal: { Value: `'${text.replace(/'/g, "''")}'` } } } } }] })
const empty = (visualType: string, extra: any = {}) => ({ name: 'v1', visual: { visualType, ...extra } })

describe('which visuals draw sample data', () => {
  const column = getVisual('clusteredColumnChart')

  it('an empty chart draws the generic sample, chosen from its title', () => {
    const d = sampleDrawFor(empty('clusteredColumnChart', { visualContainerObjects: title('Profit by country') }), column, ON, undefined)
    expect(d?.source).toBe('generic')
    expect(Object.keys(d!.json.visual.query.queryState)).toEqual(['Category', 'Y'])
    expect(d!.json.visual.query.queryState.Category.projections[0].queryRef).toBe('Sales.Country')
    expect(sampleHints(empty('x', { visualContainerObjects: title("Region's sales") }))).toBe("Region's sales")
  })

  it('nothing when the report has sample data off, the visual has fields, takes no data, or had its sample cleared', () => {
    expect(sampleDrawFor(empty('clusteredColumnChart'), column, {}, undefined)).toBeNull()
    const withField = empty('clusteredColumnChart', { query: { queryState: { Y: { projections: [{ field: { Measure: { Expression: { SourceRef: { Entity: '_measures_kpi' } }, Property: 'kpi_blank' } }, queryRef: '_measures_kpi.kpi_blank' }] } } } })
    expect(sampleDrawFor(withField, column, ON, undefined)).toBeNull()
    expect(sampleStatus(withField, column, ON)).toBeNull()
    expect(sampleDrawFor(empty('textbox'), getVisual('textbox'), ON, undefined)).toBeNull()
    expect(sampleDrawFor(empty('shape'), getVisual('shape'), ON, undefined)).toBeNull()
    const cleared = { ...empty('clusteredColumnChart'), annotations: [{ name: 'Lumen_SampleData', value: '{"off":true}' }] }
    expect(sampleStatus(cleared, column, ON)).toBe('off')
    expect(sampleDrawFor(cleared, column, ON, undefined)).toBeNull()
  })

  it('a stored sample whose fields are not in the sample dataset falls back to the generic one', () => {
    const spec = { query: { queryState: { Category: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: 'Gone' } }, Property: 'X' } }, queryRef: 'Gone.X' }] } } } }
    const v = { ...empty('donutChart'), annotations: [{ name: 'Lumen_SampleData', value: JSON.stringify(spec) }] }
    expect(sampleDrawFor(v, getVisual('donutChart'), ON, undefined)?.source).toBe('generic')
  })

  it('the sample context: its own engine, no filters, no selection, no writes', () => {
    const d = sampleDrawFor(empty('lineChart'), getVisual('lineChart'), ON, undefined)!
    let wrote = 0
    const host = { filters: [{}], selection: [{}], select: () => wrote++, updateVisual: () => wrote++, setSlicerFilter: () => wrote++, drill: { level: 0, path: [] } } as unknown as VisualHostContext
    const ctx = sampleContext(host, d.engine)
    expect(ctx.filters).toEqual([])
    expect(ctx.selection).toEqual([])
    ctx.select([])
    ctx.updateVisual(() => {})
    ctx.setSlicerFilter(undefined)
    expect(wrote).toBe(0)
    expect(ctx.engine.describeField(d.json.visual.query.queryState.Y.projections[0].field)?.displayName).toBe('Sales')
  })
})

describe('templates draw their designed sample', () => {
  for (const tpl of REPORT_TEMPLATES.filter((t) => t.id !== 'first-edition')) {
    it(tpl.name, () => {
      const p = projectFromTemplate(tpl, readTemplate(tpl.id))
      const text = p.model.sidecarFiles?.[SAMPLE_DATA_FILE]
      expect(text).toBeDefined()
      let report = 0
      for (const pg of p.report!.pages)
        for (const v of pg.visuals) {
          const def = getVisual(v.json.visual?.visualType)
          const d = sampleDrawFor(v.json, def, p.report!.report, text)
          if (visualSampleSpec(v.json)?.query) {
            expect(d?.source, `${tpl.name} ${v.name}`).toBe('report')
            report++
          } else if (d) expect(d.source).toBe('generic')
        }
      expect(report).toBeGreaterThan(4)
    })
  }
})

describe('sample data commands', () => {
  beforeEach(() => {
    const tpl = REPORT_TEMPLATES.find((t) => t.id === 'doodle')!
    useApp.getState().setProject(projectFromTemplate(tpl, readTemplate(tpl.id)))
    useInteraction.getState().reset()
  })

  const firstSample = () => {
    const pg = useApp.getState().project!.report!.pages[0]
    return { page: pg.name, v: pg.visuals.find((x) => visualSampleSpec(x.json)?.query)! }
  }

  it('View ▸ Sample data turns the report switch off and back on, undoably', () => {
    setSampleData(false)
    expect(reportSampleDataOn(useApp.getState().project!.report!.report)).toBe(false)
    useApp.getState().undo()
    expect(reportSampleDataOn(useApp.getState().project!.report!.report)).toBe(true)
  })

  it('the context menu clears one visual’s sample and shows it again', () => {
    const { page, v } = firstSample()
    const def = getVisual(v.json.visual.visualType)
    const menu = () => buildVisualMenu({ page, visual: v.name, req: { x: 0, y: 0 } }, null, { editing: true, title: 'T' }).map((i) => i.label)
    expect(menu()).toContain('Clear sample data')
    setVisualSampleData(page, v.name, false)
    const after = useApp.getState().project!.report!.pages[0].visuals.find((x) => x.name === v.name)!
    expect(sampleStatus(after.json, def, useApp.getState().project!.report!.report)).toBe('off')
    expect(visualSampleSpec(after.json)?.query).toBeDefined()
    expect(menu()).toContain('Show sample data')
    setVisualSampleData(page, v.name, true)
    expect(menu()).toContain('Clear sample data')
    expect(buildVisualMenu({ page, visual: v.name, req: { x: 0, y: 0 } }, null, { editing: false, title: 'T' }).map((i) => i.label)).not.toContain('Clear sample data')
  })
})

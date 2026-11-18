import { describe, expect, it } from 'vitest'
import { applyFormat, copyFormat } from '../formatPainter'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })

function visual(type: string, objects?: any, container?: any): any {
  return { name: 'v', position: { x: 0, y: 0, width: 100, height: 100 }, visual: { visualType: type, query: {}, ...(objects ? { objects } : {}), ...(container ? { visualContainerObjects: container } : {}) } }
}

describe('format painter', () => {
  const src = visual(
    'clusteredColumnChart',
    {
      legend: [{ properties: { show: lit('false') } }],
      dataPoint: [{ properties: { fill: { solid: { color: lit("'#FF0000'") } } }, selector: { metadata: 'Sum(Sales.Amount)' } }],
      categoryAxis: [{ properties: { fontSize: lit('12D') } }]
    },
    {
      title: [{ properties: { text: lit("'Source title'"), fontColor: { solid: { color: lit("'#123456'") } }, show: lit('true') } }],
      background: [{ properties: { color: { solid: { color: lit("'#EEEEEE'") } } } }],
      border: [{ properties: { show: lit('true') } }]
    }
  )

  it('same type copies all objects and keeps the target title text', () => {
    const t = visual('clusteredColumnChart', { legend: [{ properties: { show: lit('true') } }] }, { title: [{ properties: { text: lit("'Mine'") } }] })
    expect(applyFormat(t, copyFormat(src)!)).toBe(true)
    expect(t.visual.objects).toEqual(src.visual.objects)
    expect(t.visual.objects).not.toBe(src.visual.objects)
    expect(t.visual.visualContainerObjects.title[0].properties.text).toEqual(lit("'Mine'"))
    expect(t.visual.visualContainerObjects.title[0].properties.fontColor).toEqual(src.visual.visualContainerObjects.title[0].properties.fontColor)
    expect(t.visual.visualContainerObjects.background).toEqual(src.visual.visualContainerObjects.background)
  })

  it('target without its own title text gets none (content is not formatting)', () => {
    const t = visual('clusteredColumnChart')
    applyFormat(t, copyFormat(src)!)
    expect(t.visual.visualContainerObjects.title[0].properties.text).toBeUndefined()
    expect(t.visual.visualContainerObjects.title[0].properties.show).toEqual(lit('true'))
  })

  it('different chart types: shared chart objects only, series selectors dropped', () => {
    const t = visual('lineChart', { lineStyles: [{ properties: { strokeWidth: lit('3D') } }] })
    applyFormat(t, copyFormat(src)!)
    expect(t.visual.objects.legend).toEqual(src.visual.objects.legend)
    expect(t.visual.objects.categoryAxis).toEqual(src.visual.objects.categoryAxis)
    expect(t.visual.objects.dataPoint).toBeUndefined()
    expect(t.visual.objects.lineStyles).toBeDefined()
    expect(t.visual.visualContainerObjects.border).toEqual(src.visual.visualContainerObjects.border)
  })

  it('non-chart target gets container formatting only', () => {
    const t = visual('tableEx', { grid: [{ properties: { gridVertical: lit('true') } }] })
    applyFormat(t, copyFormat(src)!)
    expect(Object.keys(t.visual.objects)).toEqual(['grid'])
    expect(t.visual.visualContainerObjects.background).toBeDefined()
  })

  it('keeps the target button action (visualLink)', () => {
    const btn = visual('actionButton', undefined, { visualLink: [{ properties: { show: lit('true'), type: lit("'PageNavigation'"), navigationSection: lit("'p2'") } }] })
    const source = visual('actionButton', undefined, { visualLink: [{ properties: { show: lit('true'), type: lit("'Back'") } }], background: [{ properties: { show: lit('true') } }] })
    applyFormat(btn, copyFormat(source)!)
    expect(btn.visual.visualContainerObjects.visualLink[0].properties.type).toEqual(lit("'PageNavigation'"))
    expect(btn.visual.visualContainerObjects.visualLink[0].properties.navigationSection).toEqual(lit("'p2'"))
    expect(btn.visual.visualContainerObjects.background).toBeDefined()
  })
})

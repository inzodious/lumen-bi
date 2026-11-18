import { readAction, runAction, actionEnabled, resolvePageName, drillthroughState } from '../actions'
import { columnExpr } from '@core/report/sq'
import type { ReportInfo, VisualActions } from '../../contract'

const L = (v: string) => ({ expr: { Literal: { Value: v } } })
const report: ReportInfo = {
  pages: [
    { name: 'abc123', displayName: 'Overview', hidden: false },
    { name: 'def456', displayName: 'Detail', hidden: true }
  ],
  activePage: 'abc123',
  bookmarks: [{ name: 'Bookmark1', displayName: 'Top regions' }],
  resolveImage: () => undefined
}
function recorder() {
  const log: string[] = []
  const a: VisualActions = {
    navigatePage: (p) => log.push('nav:' + p),
    applyBookmark: (b) => log.push('bm:' + b),
    back: () => log.push('back'),
    drillthrough: (p, id) => log.push('dt:' + p + (id.fields.length ? ':' + id.fields.map((f) => f.value).join(',') : '')),
    openUrl: (u) => log.push('url:' + u),
    clearAllSlicers: () => log.push('clear')
  }
  return { log, a }
}
const vj = (props: Record<string, any>) => ({ visual: { visualType: 'actionButton', visualContainerObjects: { visualLink: [{ properties: props }] } } })

describe('button actions', () => {
  it('reads corpus ClearAllSlicers action', () => {
    const spec = readAction(vj({ show: L('true'), type: L("'ClearAllSlicers'"), tooltipPlaceholderText: L("'Clear all slicers'") }))
    expect(spec).toMatchObject({ type: 'ClearAllSlicers', tooltip: 'Clear all slicers' })
    const { log, a } = recorder()
    runAction(spec!, undefined, a, report)
    expect(log).toEqual(['clear'])
  })

  it('page navigation by page name or display name; disabled when the page is missing', () => {
    const spec = readAction(vj({ show: L('true'), type: L("'PageNavigation'"), navigationSection: L("'def456'") }))!
    expect(spec.target).toBe('def456')
    const { log, a } = recorder()
    runAction(spec, spec.target, a, report)
    runAction(spec, 'Overview', a, report)
    expect(log).toEqual(['nav:def456', 'nav:abc123'])
    expect(actionEnabled(spec, 'Nope', report)).toBe(false)
    expect(resolvePageName('detail', report)).toBe('def456')
  })

  it('keeps measure-bound destinations as expressions', () => {
    const m = { Measure: { Expression: { SourceRef: { Entity: '_m' } }, Property: 'Dest' } }
    const spec = readAction(vj({ show: L('true'), type: L("'WebUrl'"), webUrl: { expr: m } }))!
    expect(spec.targetExpr).toEqual(m)
    const { log, a } = recorder()
    runAction(spec, 'https://x.y', a, report)
    expect(log).toEqual(['url:https://x.y'])
  })

  it('bookmark, back, and off', () => {
    const { log, a } = recorder()
    runAction(readAction(vj({ show: L('true'), type: L("'Bookmark'"), bookmark: L("'Top regions'") }))!, 'Top regions', a, report)
    runAction(readAction(vj({ type: L("'Back'") }))!, undefined, a, report)
    expect(log).toEqual(['bm:Bookmark1', 'back'])
    expect(readAction(vj({ show: L('false'), type: L("'Back'") }))).toBeUndefined()
    expect(readAction({ visual: {} })).toBeUndefined()
  })

  it('drill-through buttons need a selected data point carrying the destination fields', () => {
    const product = columnExpr('Product', 'Name')
    const r: ReportInfo = { ...report, pages: [...report.pages, { name: 'dt1', displayName: 'Product details', hidden: true, isDrillthrough: true, drillthroughFields: [product, columnExpr('Product', 'Color')] }] }
    const sel = { fields: [{ expr: product, value: 'Road-150' }] }
    expect(drillthroughState('dt1', r, undefined)).toEqual({ enabled: false, tooltip: 'To drill through to Product details, select a data point from Name and Color' })
    expect(drillthroughState('dt1', r, [{ fields: [{ expr: columnExpr('Geo', 'Region'), value: 'EU' }] }]).enabled).toBe(false)
    expect(drillthroughState('dt1', r, [sel, sel])).toEqual({ enabled: false, tooltip: 'Select a single data point to drill through' })
    const ok = drillthroughState('Product details', r, [sel])
    expect(ok).toEqual({ enabled: true, identity: sel, tooltip: 'Click to drill through to Product details' })
    const { log, a } = recorder()
    runAction(readAction(vj({ show: L('true'), type: L("'Drillthrough'"), drillthroughSection: L("'dt1'") }))!, 'dt1', a, r, ok.identity)
    expect(log).toEqual(['dt:dt1:Road-150'])
    // hosts without drillthroughFields: legacy (enabled when the page exists)
    expect(drillthroughState('def456', report, undefined).enabled).toBe(true)
    expect(drillthroughState('missing', report, undefined).enabled).toBe(false)
  })

  it('reads disabledTooltip', () => {
    expect(readAction(vj({ type: L("'Drillthrough'"), disabledTooltip: L("'Pick a product first'") }))?.disabledTooltip).toBe('Pick a product first')
  })
})

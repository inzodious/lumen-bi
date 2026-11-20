import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveTheme } from '@core/report/theme'
import { recordFallbacks } from '@core/report/props'
import { cloneDeep } from '@core/clone'
import { identityKey, identitiesToFilter, inFilter } from '@core/report/sq'
import { STARTER_TEMPLATES, applyTemplate } from '@core/codevisual/templates'
import { CODE_VISUAL_TYPE } from '@core/codevisual/model'
import { createMockHost, createMockState } from '../common/mockHost'
import { createSampleEngine, S, proj } from '../common/sampleData'
import { getVisual } from '../registry'
import { galleryEntries } from './gallery'
import { drillLevelExprs, queryCodeData, readCodeFormat, themeInfo } from './codeModel'
import { renderCodeTemplate, rowAttrs } from './CodeVisual'
import { drillInto, drillUp, expandNextLevel, nextLevel } from './drillOps'
import { resourceNames } from './resources'
import { parameterCard } from './index'
import './index'

const theme = resolveTheme()
const engine = createSampleEngine()
const barlist = galleryEntries[0].visualJson
const env = { format: (v: unknown, f?: string) => engine.format(v as never, f), resource: () => undefined }

describe('code visual: registration and format', () => {
  it('is registered with Rows / Values / Tooltips, drill and highlight', () => {
    const def = getVisual(CODE_VISUAL_TYPE)!
    expect(def.roles.map((r) => [r.name, r.displayName, r.kind])).toEqual([
      ['Category', 'Rows', 'grouping'],
      ['Y', 'Values', 'measure'],
      ['Tooltips', 'Tooltips', 'measure']
    ])
    expect(def.supportsDrill && def.supportsHighlight).toBe(true)
  })

  it('reports the format defaults and builds the Parameters card from the code', () => {
    const seen: Record<string, unknown> = {}
    recordFallbacks((o, p, v) => (seen[`${o}.${p}`] = v), () => getVisual(CODE_VISUAL_TYPE)!.formatDefaults!(barlist, theme))
    expect(seen).toMatchObject({ 'lumenCodeFormat.overflow': 'hidden', 'lumenCodeFormat.rowLimit': 1000, 'lumenCodeFormat.rowTooltips': true, 'lumenCodeFormat.defaultSort': 'value' })
    const card = parameterCard(barlist)!
    expect(card.object).toBe('lumenParams')
    expect(card.properties.map((p) => [p.name, p.type])).toEqual([
      ['title', 'text'],
      ['accent', 'color']
    ])
    expect(getVisual(CODE_VISUAL_TYPE)!.formatCardsFor!(barlist).map((c) => c.object)).toEqual(['lumenCodeFormat', 'lumenParams'])
  })

  it('reads parameter values from the Format pane and the theme', () => {
    const j = cloneDeep(barlist)
    j.visual.objects.lumenParams = [{ properties: { title: { expr: { Literal: { Value: "'Revenue'" } } }, accent: { solid: { color: { expr: { Literal: { Value: "'#E66C37'" } } } } } } }]
    expect(readCodeFormat(j, theme).params).toEqual({ title: 'Revenue', accent: '#E66C37' })
    expect(readCodeFormat(j, theme).paramTypes).toEqual({ title: 'text', accent: 'color' })
    // an automatic (empty) colour is left out so the CSS fallback applies
    expect(readCodeFormat(barlist, theme).params).toEqual({ title: '' })
  })
})

describe('code visual: data', () => {
  it('queries the top level of the hierarchy, sorted by the first value, with totals and identities', () => {
    const ctx = createMockHost({ engine, theme })
    const q = queryCodeData(barlist, ctx, readCodeFormat(barlist, theme))
    const d = q.data
    expect(d.columns.map((c) => [c.name, c.css, c.js, c.role])).toEqual([
      ['Category', 'category', 'category', 'rows'],
      ['Total Sales', 'total-sales', 'totalSales', 'values']
    ])
    const vals = d.rows.map((r) => r.cells['Total Sales'].value as number)
    expect(vals).toEqual([...vals].sort((a, b) => b - a))
    expect(d.rows.map((r) => r.cells.Category.value).sort()).toEqual(['Accessories', 'Bikes', 'Clothing'])
    expect(d.totals['Total Sales'].value).toBeCloseTo(vals.reduce((a, b) => a + b, 0), 6)
    expect(d.rows[0].cells['Total Sales'].formatted).toMatch(/^\$[\d,]+$/)
    expect(d.rows.every((r) => r.canDrill)).toBe(true)
    expect(d.drill).toMatchObject({ level: 0, levelName: 'Category', canDrillDown: true, canDrillUp: false, breadcrumb: '' })
    const id = q.identities.get(d.rows[0].key)!
    expect(identityKey(id)).toBe(d.rows[0].key)
    expect(q.tooltip(d.rows[0].key).map((t) => t.label)).toEqual(['Category', 'Total Sales'])
    expect(q.table.columns).toEqual(['Category', 'Total Sales'])
  })

  it('follows the drill state: next level filtered by the path, breadcrumb, drill up', () => {
    const levels = drillLevelExprs(barlist, createMockHost({ engine, theme }))
    const ctx0 = createMockHost({ engine, theme })
    const top = queryCodeData(barlist, ctx0, readCodeFormat(barlist, theme))
    const bikes = top.data.rows.find((r) => r.cells.Category.value === 'Bikes')!
    const drilled = drillInto(ctx0.drill, levels, top.identities.get(bikes.key)!)!
    expect(drilled).toMatchObject({ level: 1 })
    // the host turns the drill path into filters; emulate with the identity's In filter
    const ctx1 = createMockHost({ engine, theme, state: createMockState({ drill: drilled }), filters: [identitiesToFilter(drilled.path)!] })
    const d1 = queryCodeData(barlist, ctx1, readCodeFormat(barlist, theme)).data
    expect(d1.rows.map((r) => r.cells.Subcategory.value).sort()).toEqual(['Mountain', 'Road'])
    expect(d1.drill).toMatchObject({ level: 1, levelName: 'Subcategory', breadcrumb: 'Bikes', canDrillUp: true })
    expect(drillUp(drilled)).toMatchObject({ level: 0, path: [] })
    expect(nextLevel({ level: 0, path: [] }, 3)).toMatchObject({ level: 1 })
    expect(nextLevel({ level: 2, path: [] }, 3)).toBeUndefined()
    expect(expandNextLevel({ level: 0, path: [] }, 3)).toMatchObject({ expandedLevel: 1 })
  })

  it('expanded levels: parents before children with depth and parent keys', () => {
    const ctx = createMockHost({ engine, theme, state: createMockState({ drill: { level: 0, path: [], expandedLevel: 1 } }) })
    const d = queryCodeData(barlist, ctx, readCodeFormat(barlist, theme)).data
    const bikes = d.rows.findIndex((r) => r.depth === 0 && r.cells.Category.value === 'Bikes')
    expect(bikes).toBeGreaterThanOrEqual(0)
    const kids = d.rows.filter((r) => r.parentKeys[0] === d.rows[bikes].key)
    expect(kids.map((k) => k.cells.Subcategory.value).sort()).toEqual(['Mountain', 'Road'])
    expect(kids.every((k) => k.depth === 1 && d.rows.indexOf(k) > bikes)).toBe(true)
  })

  it('marks the selection and cross-highlight values', () => {
    const ctx0 = createMockHost({ engine, theme })
    const top = queryCodeData(barlist, ctx0, readCodeFormat(barlist, theme))
    const sel = top.identities.get(top.data.rows[1].key)!
    const ctx = createMockHost({ engine, theme, state: createMockState({ selection: [sel] }) })
    const d = queryCodeData(barlist, ctx, readCodeFormat(barlist, theme)).data
    expect(d.hasSelection).toBe(true)
    expect(d.rows.map((r) => r.selected)).toEqual([false, true, false])
    const hctx = { ...createMockHost({ engine, theme }), highlightFilters: [inFilter('Sales', 'Region', ['Europe'])] }
    const h = queryCodeData(barlist, hctx, readCodeFormat(barlist, theme)).data
    expect(h.hasHighlight).toBe(true)
    for (const r of h.rows) {
      const c = r.cells['Total Sales']
      expect(typeof c.highlight).toBe('number')
      expect(c.highlight as number).toBeLessThanOrEqual(c.value as number)
      expect(r.highlighted).toBe(true)
    }
  })

  it('cuts at the row limit with a notice flag', () => {
    const j = cloneDeep(barlist)
    j.visual.query.queryState.Category.projections = [proj(S.col('Product'), 'Sales.Product')]
    j.visual.objects.lumenCodeFormat = [{ properties: { rowLimit: { expr: { Literal: { Value: '3L' } } } } }]
    const d = queryCodeData(j, createMockHost({ engine, theme }), readCodeFormat(j, theme)).data
    expect(d.rows).toHaveLength(3)
    expect(d.truncated).toBe(true)
  })

  it('a visual with measures only has one total row and totals', () => {
    const j = cloneDeep(galleryEntries[1].visualJson)
    delete j.visual.query.queryState.Category
    const d = queryCodeData(j, createMockHost({ engine, theme }), readCodeFormat(j, theme)).data
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0].key).toBe('total')
    expect(d.rows[0].canDrill).toBe(false)
    expect(Object.keys(d.totals)).toEqual(['Total Sales', 'Total Cost'])
  })
})

describe('code visual: templates', () => {
  it('every starter template evaluates against the sample data', () => {
    for (const t of STARTER_TEMPLATES) {
      const j = cloneDeep(barlist)
      j.visual.query.queryState.Y.projections.push(proj(S.m('Total Cost'), '_m.Total Cost'))
      applyTemplate(j, t)
      const d = queryCodeData(j, createMockHost({ engine, theme }), readCodeFormat(j, theme)).data
      const r = renderCodeTemplate(t.html, d, env)
      if (t.html) {
        expect(r.html.length, t.id).toBeGreaterThan(50)
        expect(r.warnings, t.id).toEqual([])
      }
      expect(r.rowStyles).toHaveLength(d.rows.length)
    }
  })

  it('decorates each row element with its index, state and CSS variables', () => {
    const ctx0 = createMockHost({ engine, theme })
    const sel = queryCodeData(barlist, ctx0, readCodeFormat(barlist, theme))
    const ctx = createMockHost({ engine, theme, state: createMockState({ selection: [sel.identities.get(sel.data.rows[0].key)!] }) })
    const d = queryCodeData(barlist, ctx, readCodeFormat(barlist, theme)).data
    const out = renderCodeTemplate('{{#each rows}}<li class="r" data-select>{{category}}</li>{{/each}}', d, env).html
    expect(out).toMatch(/^<li class="r" data-select data-row="0" data-depth="0" data-selected="true" data-can-drill="true" style="--value:[\d.]+;--pct-of-max:1;/)
    expect(out.match(/data-selected="false"/g)).toHaveLength(2)
    expect(rowAttrs(d.rows[1], d)['data-selected']).toBe('false')
  })

  it('finds the registered images the code references', () => {
    expect(resourceNames(`<img src="{{resource "logo.png"}}"> resource('a b.svg') resource ("x")`)).toEqual(['a b.svg', 'logo.png', 'x'])
  })

  it('summarises the theme for the code', () => {
    const t = themeInfo(theme)
    expect(t.colors[0]).toBe(theme.dataColors[0])
    expect(t.text.label.size).toBeGreaterThan(10)
  })

  it('server-renders the host part (the frame is created in an effect)', () => {
    const Comp = getVisual(CODE_VISUAL_TYPE)!.component
    const html = renderToStaticMarkup(<Comp visual={{ name: 'v', json: barlist }} pageName="p" width={400} height={260} ctx={createMockHost({ engine, theme })} />)
    expect(html).toContain('wbi-codevisual')
  })
})

describe('code visual: sanitising and CSS checks', () => {
  it('removes scripts, handlers, javascript: and remote URLs, meta refresh, frames and forms (string pass, no DOM)', async () => {
    const { sanitizeTemplateHtml } = await import('./sanitize')
    const out = sanitizeTemplateHtml(
      `<p onclick="x()">a</p><script>alert(1)</script><img src="http://evil/x.png" onerror="y()"><a href="javascript:alert(1)">l</a>` +
        `<meta http-equiv="refresh" content="0;url=http://evil"><base href="http://evil/"><iframe src="http://evil"></iframe><form action="http://evil"></form>` +
        `<img src="data:image/png;base64,AAAA"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg><div data-select style="--a:1">ok</div>`
    )
    expect(out).not.toMatch(/<script|onclick|onerror|javascript:|http:\/\/evil|<meta|<base|<iframe|<form/i)
    expect(out).toContain('src="data:image/png;base64,AAAA"')
    expect(out).toContain('viewBox="0 0 10 10"')
    expect(out).toContain('cx="5"')
    expect(out).toContain('<div data-select style="--a:1">ok</div>')
  })

  it('reports CSS syntax errors with positions and warns about remote resources', async () => {
    const { checkCss } = await import('@core/codevisual/csscheck')
    expect(checkCss('.a { color: red; }\n.b { color: blue;')).toEqual([{ severity: 'error', message: '{ is never closed', line: 2, column: 4 }])
    expect(checkCss('.a { content: "x }')[0]).toMatchObject({ severity: 'error', message: 'Unclosed string', line: 1, column: 15 })
    expect(checkCss('/* x')[0].message).toBe('Unclosed comment /*')
    expect(checkCss('}')[0].message).toBe('Unexpected }')
    const w = checkCss("@import url('https://x/y.css');\n.a { background: url( http://x/bg.png ) }\n.b { background: url(data:image/png;base64,AA) }")
    expect(w.map((i) => [i.severity, i.line])).toEqual([
      ['warning', 1],
      ['warning', 2]
    ])
    // position: fixed is allowed: the frame clips everything to the visual's box (see the isolation e2e)
    expect(checkCss('.cover { position: fixed; inset: 0; z-index: 99999; }')).toEqual([])
  })
})

describe('code visual: parameters from a theme', () => {
  it('a theme sets a parameter for every code visual (visualStyles of the type)', async () => {
    const { resolveTheme: rt } = await import('@core/report/theme')
    const themed = rt(undefined, { name: 'T', visualStyles: { [CODE_VISUAL_TYPE]: { '*': { lumenParams: [{ title: 'From theme', accent: { solid: { color: '#123456' } } }] } } } } as any)
    expect(readCodeFormat(barlist, themed).params).toEqual({ title: 'From theme', accent: '#123456' })
  })
})

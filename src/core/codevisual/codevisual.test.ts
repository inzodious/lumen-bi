import { describe, expect, it } from 'vitest'
import { cssName, jsName, uniqueNames } from './naming'
import { evaluateTemplate, parseTemplate, TemplateError, decorateFirstElement } from './template'
import { cssColor, cssNumber, cssString, dataVars, fontStack, paramVars, rowStats, rowVars } from './cssvars'
import { MAX_FRAME_MESSAGE_CHARS, PROTOCOL, ReplayGuard, validateFrameEnvelope, validateFrameMessage, validateHostMessage } from './protocol'
import { CODE_VISUAL_TYPE, newCodeVisualJson, readCodeSource, readParamDefs, writeCodeSource, writeParamDefs } from './model'
import { externalizeCode, internalizeCode } from './storage'
import { parseDrill, serializeDrill } from './drill'
import type { CodeData, CodeRow } from './types'

const env = { format: (v: unknown, f?: string) => (typeof v === 'number' ? (f === '0.0' ? v.toFixed(1) : `#${v}`) : String(v)) }

function cell(value: number | string | null, formatted?: string) {
  return { value, formatted: formatted ?? (value === null ? '' : String(value)), type: typeof value === 'number' ? 'number' : value === null ? 'blank' : 'text' } as const
}

function row(i: number, cat: string, sales: number, extra: Partial<CodeRow> = {}): CodeRow {
  return {
    index: i,
    key: `k${i}`,
    label: cat,
    cells: { Category: cell(cat), 'Total Sales': cell(sales, `$${sales}`) },
    selected: false,
    highlighted: null,
    depth: 0,
    parentKeys: [],
    canDrill: false,
    ...extra
  }
}

function data(rows: CodeRow[], extra: Partial<CodeData> = {}): CodeData {
  return {
    columns: [
      { name: 'Category', css: 'category', js: 'category', role: 'rows', kind: 'group', dataType: 'string' },
      { name: 'Total Sales', css: 'total-sales', js: 'totalSales', role: 'values', kind: 'value', dataType: 'double', formatString: '$#,0' }
    ],
    rows,
    totals: { 'Total Sales': cell(rows.reduce((s, r) => s + (r.cells['Total Sales'].value as number), 0), '$total') },
    truncated: false,
    rowLimit: 1000,
    hasHighlight: false,
    hasSelection: false,
    drill: { levels: [{ index: 0, name: 'Category' }], level: 0, levelName: 'Category', fromLevel: 0, path: [], breadcrumb: '', canDrillDown: false, canDrillUp: false, drillMode: false },
    params: {},
    warnings: [],
    ...extra
  }
}

describe('naming', () => {
  it('mangles display names predictably', () => {
    expect(cssName('Total Sales')).toBe('total-sales')
    expect(cssName('Margin %')).toBe('margin-pct')
    expect(cssName('  Sales (YoY) #  ')).toBe('sales-yo-y-num')
    expect(cssName('2024 Target')).toBe('f-2024-target')
    expect(cssName('Café & Bar')).toBe('cafe-and-bar')
    expect(cssName('')).toBe('field')
    expect(jsName('Total Sales')).toBe('totalSales')
    expect(jsName('Margin %')).toBe('marginPct')
    expect(jsName('2024 Target')).toBe('f2024Target')
    expect(cssName('TotalSales')).toBe('total-sales')
  })
  it('numbers collisions and reserved names in order', () => {
    expect(uniqueNames(['Sales', 'sales', 'SALES!', 'Value', 'Index'])).toEqual([
      { css: 'sales', js: 'sales' },
      { css: 'sales-2', js: 'sales2' },
      { css: 'sales-3', js: 'sales3' },
      { css: 'value-2', js: 'value2' },
      { css: 'index-2', js: 'index2' }
    ])
  })
})

describe('template', () => {
  const root = { ...data([row(0, 'Bikes', 300), row(1, 'Clothing', 100)]), 'Total Sales': cell(400, '$400') }
  it('outputs formatted values, raw values and names with spaces', () => {
    expect(evaluateTemplate('<b>{{Total Sales}}</b> {{raw Total Sales}} {{[Total Sales]}} {{totalSales}}', root, env)).toBe('<b>$400</b> 400 $400 $400')
  })
  it('iterates rows with @index / @first / @last and decorates the first element', () => {
    const out = evaluateTemplate('{{#each rows}}<li class="x">{{@index}}:{{Category}}={{Total Sales}}{{#if @last}}!{{/if}}</li>{{/each}}', root, env, {
      rowAttributes: (r, i) => ({ attrs: { 'data-row': String(i) }, style: `--value:${r.cells['Total Sales'].value};` })
    })
    expect(out).toBe('<li class="x" data-row="0" style="--value:300;">0:Bikes=$300</li><li class="x" data-row="1" style="--value:100;">1:Clothing=$100!</li>')
  })
  it('supports else / else if / unless / with and comparisons', () => {
    const t = '{{#each rows}}{{#if [Total Sales] > 200}}big{{else if (gt [Total Sales] 50)}}mid{{else}}small{{/if}};{{/each}}{{#unless hasSelection}}none{{/unless}}{{#with drill}}{{levelName}}{{/with}}'
    expect(evaluateTemplate(t, root, env)).toBe('big;mid;noneCategory')
    expect(evaluateTemplate('{{#each nothing}}x{{else}}empty{{/each}}', root, env)).toBe('empty')
  })
  it('aggregates over rows and formats', () => {
    expect(evaluateTemplate('{{sum rows "Total Sales"}} {{max "Total Sales"}} {{min rows "Total Sales"}} {{avg "Total Sales"}} {{count rows}}', root, env)).toBe('400 300 100 200 2')
    expect(evaluateTemplate('{{format [Total Sales] "0.0"}} {{percent 0.4567 1}} {{number 1234.5 1}} {{round 2.345 2}}', root, env)).toBe('400.0 45.7% 1,234.5 2.35')
    expect(evaluateTemplate('{{format (div [Total Sales] 3) "0.0"}}', root, env)).toBe('133.3')
  })
  it('escapes every value: markup, quotes and braces never become HTML', () => {
    const evil = { ...root, Name: cell('<script>alert(1)</script>"\' onload=x {{Total Sales}}') }
    const out = evaluateTemplate('<div title="{{Name}}">{{Name}}</div><div class={{Name}}></div>', evil, env)
    expect(out).not.toContain('<script')
    expect(out).not.toMatch(/"\s*onload/)
    expect(out).not.toContain('$400')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&quot;&#39; onload&#61;x {{Total Sales}}')
    // the unquoted attribute stays one attribute value (no new attribute can start)
    expect(out.match(/<div class=([^>]*)>/)![1]).not.toMatch(/\s\w+=/)
  })
  it('refuses triple braces and reports errors with line and column', () => {
    expect(() => parseTemplate('a\n  {{{x}}}')).toThrow(/line 2, column 3/)
    expect(() => parseTemplate('{{#each rows}}\n{{/if}}')).toThrow(TemplateError)
    expect(() => parseTemplate('{{#each rows}}')).toThrow(/not closed/)
    expect(() => parseTemplate('{{#loop rows}}{{/loop}}')).toThrow(/Unknown block/)
    // `nosuch` is not a helper → read as one name "nosuch 1 2": missing = empty output plus a warning
    const missing: string[] = []
    expect(evaluateTemplate('ok\n{{nosuch 1 2}}', root, env, { onMissing: (n, l, c) => missing.push(`${n}@${l}:${c}`) })).toBe('ok\n')
    expect(missing).toEqual(['nosuch 1 2@2:3'])
  })
  it('throws for an unknown helper in a subexpression with its position', () => {
    expect(() => evaluateTemplate('x\n {{#if (nosuch 1)}}y{{/if}}', root, env)).toThrow(/Unknown helper "nosuch".*line 2/)
  })
  it('resolves parent and root scopes', () => {
    expect(evaluateTemplate('{{#each rows}}{{Category}}/{{../rowLimit}}/{{@root.drill.levelName}} {{/each}}', root, env)).toBe('Bikes/1000/Category Clothing/1000/Category ')
  })
  it('decorates only a real start tag and merges an existing style', () => {
    expect(decorateFirstElement('  <div style="color:red" data-a=\'1\'>x</div>', { 'data-row': '3' }, '--a:1;')).toBe('  <div style="--a:1;color:red" data-a=\'1\' data-row="3">x</div>')
    expect(decorateFirstElement('text only', { 'data-row': '3' }, '--a:1;')).toBe('text only')
  })
})

describe('css variables', () => {
  it('quotes strings so they cannot break out', () => {
    expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"')
    const s = cssString('x</style><script>;}{')
    expect(s).not.toContain('<')
    expect(s).not.toContain('}')
    expect(s).not.toContain(';')
    expect(cssNumber(6487996)).toBe('6487996')
    expect(cssNumber(0.4671)).toBe('0.4671')
    expect(cssNumber(1e-12)).toBe('0')
    expect(cssNumber(NaN)).toBeNull()
    expect(cssColor('red; background:url(x)')).toBeNull()
    expect(cssColor('#118DFF')).toBe('#118DFF')
    expect(fontStack("'Segoe UI', wf_segoe-ui_normal, sans-serif")).toBe('"Segoe UI", "wf_segoe-ui_normal", sans-serif, "Selawik"')
  })
  it('builds root and row variables', () => {
    const d = data([row(0, 'A', 300, { highlighted: true }), row(1, 'B', -100)], { hasHighlight: true })
    d.rows[0].cells['Total Sales'].highlight = 150
    const v = dataVars(d)
    expect(v['--total-sales']).toBe('200')
    expect(v['--total-sales-text']).toBe('"$total"')
    expect(v['--row-count']).toBe('2')
    expect(v['--has-highlight']).toBe('1')
    const st = rowStats(d)
    const r0 = rowVars(d.rows[0], d, st)
    expect(r0['--value']).toBe('300')
    expect(r0['--pct-of-max']).toBe('1')
    expect(r0['--pct-of-total']).toBe('1.5')
    expect(r0['--highlight-value']).toBe('150')
    expect(r0['--highlight-pct-of-max']).toBe('0.5')
    expect(r0['--category-text']).toBe('"A"')
    expect(rowVars(d.rows[1], d, st)['--pct-of-max']).toBe('-0.333333333')
    expect(paramVars({ accent: '#ff0000', title: 'Hi "x"', size: 3, on: true })).toEqual({ '--param-accent': '#ff0000', '--param-title': '"Hi \\"x\\""', '--param-size': '3', '--param-on': '1' })
  })
})

describe('protocol', () => {
  const env1 = (msg: unknown, n = 1) => ({ p: PROTOCOL, token: 'abc', n, msg })
  it('accepts well-formed messages and copies only known fields', () => {
    expect(validateFrameEnvelope({ p: PROTOCOL, type: 'boot' })).toEqual({ boot: true })
    expect(validateFrameEnvelope(env1({ type: 'select', keys: ['a'], multi: true, extra: 1 }))).toEqual({ boot: false, token: 'abc', n: 1, msg: { type: 'select', keys: ['a'], multi: true } })
    expect(validateFrameMessage({ type: 'tooltip', x: 1, y: 2, items: [{ label: 'a', value: 'b', evil: 'x' }] })).toEqual({ type: 'tooltip', x: 1, y: 2, items: [{ label: 'a', value: 'b' }] })
  })
  it('ignores malformed, oversized and foreign messages', () => {
    expect(validateFrameEnvelope(null)).toBeNull()
    expect(validateFrameEnvelope({ type: 'boot' })).toBeNull()
    expect(validateFrameEnvelope({ p: 'other', type: 'boot' })).toBeNull()
    expect(validateFrameEnvelope({ p: PROTOCOL, type: 'boot', token: 'x' })).toBeNull()
    expect(validateFrameEnvelope(env1({ type: 'select', keys: 'a', multi: true }))).toBeNull()
    expect(validateFrameEnvelope(env1({ type: 'select', keys: [1], multi: false }))).toBeNull()
    expect(validateFrameEnvelope(env1({ type: 'navigate', url: 'http://x' }))).toBeNull()
    expect(validateFrameEnvelope(env1({ type: 'tooltip', x: Infinity, y: 0, key: 'a' }))).toBeNull()
    expect(validateFrameEnvelope({ ...env1({ type: 'clear' }), n: -1 })).toBeNull()
    expect(validateFrameEnvelope(env1({ type: 'select', keys: ['x'.repeat(MAX_FRAME_MESSAGE_CHARS)], multi: false }))).toBeNull()
    expect(validateFrameEnvelope(env1({ type: 'select', keys: Array.from({ length: 6000 }, () => 'k'), multi: false }))).toBeNull()
  })
  it('drops replayed and reordered messages', () => {
    const g = new ReplayGuard()
    expect([g.accept(1), g.accept(1), g.accept(3), g.accept(2), g.accept(4)]).toEqual([true, false, true, false, true])
  })
  it('validates host messages in the frame', () => {
    const ok = { p: PROTOCOL, token: 't', type: 'render', seq: 1, mode: 'html', html: '', css: '', vars: { '--a': '1' }, rowStyles: [], data: { rows: [], columns: [] }, theme: {}, resources: {}, state: {} }
    expect(validateHostMessage(ok)).not.toBeNull()
    expect(validateHostMessage({ ...ok, vars: { 'color;x': '1' } })).toBeNull()
    expect(validateHostMessage({ ...ok, mode: 'eval' })).toBeNull()
    expect(validateHostMessage({ ...ok, p: 'x' })).toBeNull()
    expect(validateHostMessage({ p: PROTOCOL, token: 't', type: 'pointer', kind: 'click', x: 1, y: 1 })).not.toBeNull()
  })
})

describe('model and storage', () => {
  it('writes and reads the code, parameters and type', () => {
    const j = newCodeVisualJson('v1', { html: "<b>{{x}}</b> it's", css: '.a{}', jsx: '' }, [{ name: 'accent', label: 'Accent', type: 'color', default: '#ff0000' }])
    expect(j.visual.visualType).toBe(CODE_VISUAL_TYPE)
    expect(readCodeSource(j)).toEqual({ html: "<b>{{x}}</b> it's", css: '.a{}', jsx: '' })
    expect(readParamDefs(j)).toEqual([{ name: 'accent', label: 'Accent', type: 'color', default: '#ff0000' }])
    writeParamDefs(j, [{ name: 'bad name', label: '', type: 'color', default: '' } as any, { name: 'n', label: 'N', type: 'number', default: 'x' as any }])
    expect(readParamDefs(j)).toEqual([{ name: 'n', label: 'N', type: 'number', default: 0 }])
    writeCodeSource(j, { css: '' })
    expect(j.visual.objects.lumenCode[0].properties.css).toBeUndefined()
  })
  it('externalizes code to files and reads them back', () => {
    const j = newCodeVisualJson('v1', { html: '<p>{{a}}</p>\n', css: '', jsx: 'export default () => null\n' })
    const { json, files } = externalizeCode(j)
    expect(files).toEqual({ 'code.html': '<p>{{a}}</p>\n', 'code.jsx': 'export default () => null\n' })
    expect(json.visual.objects.lumenCode[0].properties.html).toBeUndefined()
    expect(j.visual.objects.lumenCode[0].properties.html).toBeDefined() // the in-memory JSON is untouched
    const extra: Record<string, Uint8Array | string> = {
      'definition/pages/p1/visuals/v1/code.html': new TextEncoder().encode(files['code.html']),
      'definition/pages/p1/visuals/v1/code.jsx': files['code.jsx'],
      'other.txt': 'keep'
    }
    const diags: string[] = []
    const pages = [{ name: 'p1', visuals: [{ name: 'v1', json }] }]
    internalizeCode(pages, extra, diags)
    expect(readCodeSource(json)).toEqual(readCodeSource(j))
    expect(json.visual.objects.lumenCode[0].properties.files).toBeUndefined()
    expect(Object.keys(extra)).toEqual(['other.txt'])
    expect(diags).toEqual([])
  })
  it('reports a missing code file', () => {
    const { json } = externalizeCode(newCodeVisualJson('v1', { html: 'x', css: '', jsx: '' }))
    const diags: string[] = []
    internalizeCode([{ name: 'p', visuals: [{ name: 'v1', json }] }], {}, diags)
    expect(diags).toEqual(['Code visual v1: code.html is missing'])
  })
  it('round-trips the drill state with typed values', () => {
    const expr = { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Category' } }
    const d = { level: 2, expandedLevel: 0, path: [{ fields: [{ expr, value: 'Bikes' }] }, { fields: [{ expr, value: new Date(Date.UTC(2024, 0, 31)) }] }] }
    const back = parseDrill(serializeDrill(d)!)!
    expect(back.level).toBe(2)
    expect(back.path[0].fields[0].value).toBe('Bikes')
    expect((back.path[1].fields[0].value as Date).getTime()).toBe(Date.UTC(2024, 0, 31))
    expect(serializeDrill({ level: 0, path: [] })).toBeUndefined()
    expect(parseDrill('{oops')).toBeUndefined()
  })
})

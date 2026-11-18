import { preSanitize, sanitizeCssText, sanitizeHtml } from '../htmlSanitize'
import { buildSrcDoc, readHtmlContentOptions } from '../htmlContentModel'
import { queryHtmlEntries } from '../HtmlContent'
import { createSampleEngine, proj, S } from '../../common/sampleData'
import { createMockHost } from '../../common/mockHost'

const L = (v: string) => ({ expr: { Literal: { Value: v } } })

describe('HTML Content sanitization', () => {
  it('removes scripts, handlers, javascript: URLs and frames but keeps styles/SVG', () => {
    const html =
      '<div style="color:red;display:flex" onclick="alert(1)"><script>alert(2)</script><style>@keyframes w{0%{opacity:0}}</style>' +
      '<a href="javascript:alert(3)">x</a><a href="https://ok.example">ok</a><iframe src="https://evil"></iframe>' +
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#118DFF"/></svg><img src="x" onerror="alert(4)"></div>'
    const out = preSanitize(html)
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe/i)
    expect(out).toContain('style="color:red;display:flex"')
    expect(out).toContain('@keyframes')
    expect(out).toContain('<svg')
    expect(out).toContain('href="https://ok.example"')
    // in Node DOMPurify is unsupported → falls back to preSanitize
    expect(sanitizeHtml(html)).toBe(out)
  })

  it('handles nested / split script tags', () => {
    expect(preSanitize('<scr<script>ipt>alert(1)</script>')).not.toMatch(/<script/i)
  })

  it('neutralizes dangerous CSS', () => {
    const css = sanitizeCssText('a{background:url(javascript:alert(1));width:expression(1)}</style><script>x</script>')
    expect(css).not.toMatch(/javascript|expression\(|<\/style|<script/i)
  })
})

describe('HTML Content options & document', () => {
  it('reads corpus-shaped contentFormatting and measure-bound stylesheet', () => {
    const m = { Measure: { Expression: { SourceRef: { Entity: '_m' } }, Property: 'CSS' } }
    const o = readHtmlContentOptions({
      visual: {
        objects: {
          contentFormatting: [{ properties: { showRawHtml: L('false'), fontSize: L('13D'), align: L("'left'"), userSelect: L('true') } }],
          stylesheet: [{ properties: { stylesheet: { expr: m } } }]
        }
      }
    })
    expect(o).toMatchObject({ showRawHtml: false, fontSize: 13, align: 'left', userSelect: true, hyperlinks: false })
    expect(o.stylesheetExpr).toEqual(m)
  })

  it('builds a document with base styles, user css and escaped raw mode', () => {
    const o = readHtmlContentOptions({ visual: {} })
    const doc = buildSrcDoc({ entries: ['<b>Hi</b>'], options: o, css: '.x{color:red}' })
    expect(doc).toContain('<div class="htmlViewerEntry" data-row="0"><b>Hi</b></div>')
    expect(doc).toContain('font-size:11pt')
    expect(doc).toContain('<style>.x{color:red}</style>')
    const raw = buildSrcDoc({ entries: ['<b>Hi</b>'], options: { ...o, showRawHtml: true } })
    expect(raw).toContain('&lt;b&gt;Hi&lt;/b&gt;')
    expect(buildSrcDoc({ entries: [], options: o })).toContain('No data available to display')
  })

  it('queries one entry per granularity row', () => {
    const engine = createSampleEngine()
    const vj = {
      visual: {
        visualType: 'htmlContent443BE3AD55E043BF878BED274D3A6865',
        query: {
          queryState: {
            content: { projections: [proj(S.m('Sales Html'), '_m.Sales Html')] },
            sampling: { projections: [proj(S.col('Region'), 'Sales.Region')] }
          }
        }
      }
    }
    const ctx = createMockHost({ engine, visualJson: vj })
    const d = queryHtmlEntries(vj, ctx)
    expect(d.entries).toHaveLength(3)
    expect(d.entries[0]).toContain('Sales to target')
    expect(d.identities[0].fields[0].value).toBe('Asia Pacific')
    const single = queryHtmlEntries({ visual: { query: { queryState: { content: vj.visual.query.queryState.content } } } }, ctx)
    expect(single.entries).toHaveLength(1)
    expect(single.identities[0].fields).toEqual([])
  })
})

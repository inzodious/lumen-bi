import { TEXTBOX_DEFAULTS, buildParagraphs, bulletGlyph, normalizeStyle, paragraphsFromText, paragraphsText, themeTextDefaults } from '../textboxModel'

describe('textbox paragraphs model', () => {
  it('normalizes runs, styles (pt → px), alignment and urls', () => {
    const ps = buildParagraphs([
      {
        horizontalTextAlignment: 'center',
        textRuns: [
          { value: 'Sales ', textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '14pt', color: '#12239E' } },
          { value: 'link', url: 'https://example.com', textStyle: { fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'underline' } }
        ]
      }
    ])
    expect(ps).toHaveLength(1)
    expect(ps[0].align).toBe('center')
    const [a, b] = ps[0].runs
    expect(a.style.fontSize).toBeCloseTo(18.667, 2)
    expect(a.style.fontWeight).toBe(600)
    expect(a.style.fontFamily.startsWith("'Segoe UI'")).toBe(true)
    expect(a.style.color).toBe('#12239E')
    expect(b.url).toBe('https://example.com')
    expect(b.style.fontWeight).toBe(700)
    expect(b.style.fontStyle).toBe('italic')
    expect(b.style.textDecoration).toBe('underline')
    expect(b.style.fontSize).toBeCloseTo(13.333, 2) // default 10pt
  })

  it('ignores malformed textStyle keys (corpus: nested textStyle / value inside textStyle)', () => {
    const ps = buildParagraphs([{ textRuns: [{ value: ' ', textStyle: { value: 'stray', textStyle: { fontSize: '30pt' } } }] }])
    expect(ps[0].runs[0].text).toBe(' ')
    expect(ps[0].runs[0].style.fontSize).toBeCloseTo(13.333, 2)
  })

  it('numbers list paragraphs per indent level and resets after non-list paragraphs', () => {
    const ps = buildParagraphs([
      { textRuns: [{ value: 'a' }], listType: 'number' },
      { textRuns: [{ value: 'a.1' }], listType: 'number', indent: 1 },
      { textRuns: [{ value: 'b' }], listType: 'number' },
      { textRuns: [{ value: 'plain' }] },
      { textRuns: [{ value: 'c' }], listType: 'number' },
      { textRuns: [{ value: 'x' }], listType: 'bullet', indent: 1 }
    ])
    expect(ps.map((p) => p.listIndex)).toEqual([1, 1, 2, undefined, 1, undefined])
    expect(ps[5].listType).toBe('bullet')
    expect(bulletGlyph(1)).toBe('◦')
  })

  it('reads dynamic value bindings from several key spellings', () => {
    const m = { Measure: { Expression: { SourceRef: { Entity: '_m' } }, Property: 'Total Sales' } }
    const ps = buildParagraphs([{ textRuns: [{ value: '', valueExpr: m }, { value: '', expression: { expr: m } }, { value: 'x' }] }])
    expect(ps[0].runs[0].binding).toEqual(m)
    expect(ps[0].runs[1].binding).toEqual(m)
    expect(ps[0].runs[2].binding).toBeUndefined()
  })

  it('round-trips edited text keeping styles', () => {
    const prev = [{ textRuns: [{ value: 'Old', textStyle: { fontSize: '20pt' } }], horizontalTextAlignment: 'right' }]
    const next = paragraphsFromText('New line\nSecond', prev)
    expect(next).toHaveLength(2)
    expect(next[0]).toEqual({ textRuns: [{ value: 'New line', textStyle: { fontSize: '20pt' } }], horizontalTextAlignment: 'right' })
    expect(paragraphsText(buildParagraphs(next))).toBe('New line\nSecond')
  })

  it('handles px font sizes and numeric weights', () => {
    const s = normalizeStyle({ fontSize: '16px', fontWeight: '300' })
    expect(s.fontSize).toBe(16)
    expect(s.fontWeight).toBe(300)
  })
})

describe('unstyled text box runs follow the theme label class', () => {
  it('uses the label class face / size / color, and the built-in defaults without one', () => {
    const theme = { textClasses: { label: { fontFace: 'Segoe UI', fontSize: 12, color: '#123456' } } }
    const d = themeTextDefaults(theme)
    expect(d).toEqual({ fontFamily: 'Segoe UI', fontSize: 12, color: '#123456' })
    const [p] = buildParagraphs([{ textRuns: [{ value: 'Plain' }, { value: 'Styled', textStyle: { fontSize: '9pt', color: '#FF0000' } }] }], d)
    expect(p.runs[0].style.fontSize).toBeCloseTo(16, 5)
    expect(p.runs[0].style.color).toBe('#123456')
    // an explicit run style still wins
    expect(p.runs[1].style.fontSize).toBeCloseTo(12, 5)
    expect(p.runs[1].style.color).toBe('#FF0000')
    expect(themeTextDefaults(undefined)).toEqual(TEXTBOX_DEFAULTS)
    expect(themeTextDefaults({ textClasses: { label: { fontSize: 0 } } })).toEqual(TEXTBOX_DEFAULTS)
  })
})

import { paragraphsFromEdit, readEditor, type EditNode } from '../textboxEdit'

type Attrs = Record<string, string>
const el = (name: string, attrs: Attrs, ...children: EditNode[]): EditNode => ({
  nodeType: 1,
  nodeName: name,
  get textContent() {
    return children.map((c) => c.textContent ?? '').join('')
  },
  childNodes: children,
  getAttribute: (k) => (k in attrs ? attrs[k] : null)
})
const txt = (t: string): EditNode => ({ nodeType: 3, nodeName: '#text', textContent: t, childNodes: [] })
const div = (p: number | null, ...c: EditNode[]) => el('DIV', p === null ? {} : { 'data-p': String(p) }, ...c)
const span = (p: number, r: number, t: string) => el('SPAN', { 'data-p': String(p), 'data-r': String(r) }, txt(t))
const atom = (p: number, r: number, t: string) => el('SPAN', { 'data-p': String(p), 'data-r': String(r), 'data-atomic': '' }, txt(t))
const br = () => el('BR', {})
const root = (...c: EditNode[]) => el('DIV', { contenteditable: 'true' }, ...c)

const H = { fontFamily: 'Segoe UI Semibold', fontSize: '13pt', color: '#171C73' }
const B = { fontFamily: 'Segoe UI Semibold', fontSize: '10pt', color: '#171C73' }
const N = { fontFamily: 'Segoe UI', fontSize: '10pt', color: '#171C73' }
const S = { fontFamily: 'Segoe UI', fontSize: '6pt', color: '#171C73' }
// the shape of the retention report's "How to read the table" text box: heading, spacer, label + definition lines
const source = [
  { textRuns: [{ value: 'How to read the table', textStyle: H }] },
  { textRuns: [{ value: ' ', textStyle: S }] },
  { textRuns: [{ value: 'Customers', textStyle: B }, { value: ': first purchase in the month.', textStyle: N }] },
  { textRuns: [{ value: 'Retained', textStyle: B }, { value: ': bought again.', textStyle: N }] }
]
const editorOf = (ps: any[]) => root(...ps.map((p, pi) => div(pi, ...p.textRuns.map((r: any, ri: number) => span(pi, ri, r.value)))))

describe('text box editor round trip', () => {
  it('writes back the same paragraphs when nothing changed', () => {
    expect(paragraphsFromEdit(readEditor(editorOf(source)), source)).toEqual(source)
  })

  it('deleting the heading and its paragraph break keeps every other paragraph and run style', () => {
    // Chromium after selecting "How to read the table" + the line break and pressing Delete: the spacer's span moved
    // into the heading's (emptied) element
    const dom = root(div(0, span(1, 0, ' ')), div(2, span(2, 0, 'Customers'), span(2, 1, ': first purchase in the month.')), div(3, span(3, 0, 'Retained'), span(3, 1, ': bought again.')))
    const next = paragraphsFromEdit(readEditor(dom), source)
    expect(next).toEqual(source.slice(1))
  })

  it('merging two paragraphs keeps each run its own style', () => {
    const dom = root(div(0, span(0, 0, 'How to read'), span(2, 0, 'Customers'), span(2, 1, ': first purchase in the month.')))
    const [p] = paragraphsFromEdit(readEditor(dom), source)
    expect(p.textRuns).toEqual([
      { value: 'How to read', textStyle: H },
      { value: 'Customers', textStyle: B },
      { value: ': first purchase in the month.', textStyle: N }
    ])
  })

  it('an emptied heading becomes an empty paragraph in the heading style', () => {
    const dom = root(div(0, br()), div(1, span(1, 0, ' ')))
    const next = paragraphsFromEdit(readEditor(dom), source)
    expect(next[0]).toEqual({ textRuns: [{ value: '', textStyle: H }] })
    expect(next).toHaveLength(2)
  })

  it('deleting everything leaves one empty paragraph; text typed into the bare editor takes the first style', () => {
    expect(paragraphsFromEdit(readEditor(root(br())), source)).toEqual([{ textRuns: [{ value: '', textStyle: H }] }])
    expect(paragraphsFromEdit(readEditor(root()), [])).toEqual([{ textRuns: [{ value: '' }] }])
    expect(paragraphsFromEdit(readEditor(root(txt('Hello'))), source)).toEqual([{ textRuns: [{ value: 'Hello', textStyle: H }] }])
  })

  it('text in untagged wrappers stays in the enclosing run; <br> and newlines split paragraphs', () => {
    const dom = root(div(2, span(2, 0, 'Cust'), el('FONT', {}, txt('omers')), br(), txt('next line')), div(3, span(3, 1, 'a\nb')))
    const next = paragraphsFromEdit(readEditor(dom), source)
    expect(next.map((p) => p.textRuns.map((r: any) => r.value))).toEqual([['Customers'], ['next line'], ['a'], ['b']])
    expect(next[0].textRuns[0].textStyle).toEqual(B)
    expect(next[1].textRuns[0].textStyle).toEqual(B)
    expect(next[3].textRuns[0].textStyle).toEqual(N)
  })

  it('a paragraph split by Enter keeps the paragraph settings and run style on both halves', () => {
    const prev = [{ horizontalTextAlignment: 'center', listType: 'bullet', textRuns: [{ value: 'one two', textStyle: N, url: 'https://example.com' }] }]
    const dom = root(div(0, span(0, 0, 'one')), div(0, span(0, 0, ' two')))
    expect(paragraphsFromEdit(readEditor(dom), prev)).toEqual([
      { horizontalTextAlignment: 'center', listType: 'bullet', textRuns: [{ value: 'one', textStyle: N, url: 'https://example.com' }] },
      { horizontalTextAlignment: 'center', listType: 'bullet', textRuns: [{ value: ' two', textStyle: N, url: 'https://example.com' }] }
    ])
  })

  it('dynamic values are written back as their original binding, once, and can be deleted', () => {
    const value = { value: { propertyIdentifier: 'x', selector: { id: 'v1' } }, textStyle: N }
    const prev = [{ textRuns: [{ value: 'Sales are ', textStyle: N }, value] }]
    const kept = root(div(0, span(0, 0, 'Sales are '), atom(0, 1, '$1.2M'), atom(0, 1, ' (+3%)')))
    expect(paragraphsFromEdit(readEditor(kept), prev)).toEqual(prev)
    const gone = root(div(0, span(0, 0, 'Sales are ')))
    expect(paragraphsFromEdit(readEditor(gone), prev)).toEqual([{ textRuns: [{ value: 'Sales are ', textStyle: N }] }])
  })

  it('skips list markers', () => {
    const prev = [{ listType: 'bullet', textRuns: [{ value: 'item' }] }]
    const dom = root(div(0, el('SPAN', { 'data-marker': '' }, txt('•')), span(0, 0, 'item')))
    expect(paragraphsFromEdit(readEditor(dom), prev)).toEqual(prev)
  })
})

/**
 * Text box editing: the editor is a contentEditable box whose DOM is built here, outside React. The browser rewrites
 * that DOM freely while the user types (deleting a whole paragraph removes its element, merging two paragraphs moves
 * spans between them), so React must never reconcile it: when it did, deleting the heading paragraph of a text box
 * left React holding detached nodes, the next render threw, and the visual stayed broken.
 *
 * Every paragraph element carries `data-p` (its source paragraph index) and every run span `data-p`/`data-r` (its
 * source run). Reading the edited DOM back maps each piece of text to the run it came from, so run styles (a bold
 * label followed by regular text), links and paragraph settings survive an edit, and dynamic values (+ Value, smart
 * narrative) stay bound: they are non-editable atoms that are either kept whole or deleted.
 */
import { cloneDeep } from '@core/clone'
import { bulletGlyph, type Paragraph, type TextRun } from './textboxModel'

export interface EditRun {
  text: string
  /** source paragraph index */
  p?: number
  /** source run index within that paragraph */
  r?: number
  /** a dynamic value: written back as the original run */
  atomic?: boolean
}

export interface EditParagraph {
  p?: number
  runs: EditRun[]
}

/** The part of a DOM node the reader needs (lets the reader run on plain objects in tests). */
export interface EditNode {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<EditNode>
  getAttribute?(name: string): string | null
}

const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE'])

function attrNum(n: EditNode, name: string): number | undefined {
  const v = n.getAttribute?.(name)
  if (v === null || v === undefined || v === '') return undefined
  const k = Number(v)
  return Number.isInteger(k) && k >= 0 ? k : undefined
}

function hasAttr(n: EditNode, name: string): boolean {
  const v = n.getAttribute?.(name)
  return v !== null && v !== undefined
}

/** Paragraphs and runs of the edited DOM, each piece of text tagged with the source run it sits in. */
export function readEditor(root: EditNode): EditParagraph[] {
  const out: EditParagraph[] = []
  let cur: EditParagraph | null = null
  let breakPending = false
  const open = (p?: number) => {
    cur = { p, runs: [] }
    out.push(cur)
    breakPending = false
  }
  const push = (run: EditRun, p?: number) => {
    if (!cur || breakPending) open(cur?.p ?? p)
    cur!.runs.push(run)
  }
  const inline = (n: EditNode, p?: number, r?: number) => {
    if (n.nodeType === 3) {
      const parts = (n.textContent ?? '').replace(/\r/g, '').split('\n')
      parts.forEach((t, i) => {
        if (i > 0) open(cur?.p ?? p)
        if (t) push({ text: t, p, r }, p)
        else if (!cur) open(p)
      })
      return
    }
    if (n.nodeType !== 1) return
    if (hasAttr(n, 'data-marker')) return
    const np = attrNum(n, 'data-p') ?? p
    const nr = attrNum(n, 'data-r') ?? (attrNum(n, 'data-p') !== undefined ? undefined : r)
    if (hasAttr(n, 'data-atomic')) {
      push({ text: n.textContent ?? '', p: np, r: nr, atomic: true }, np)
      return
    }
    if (n.nodeName === 'BR') {
      // a <br> ends a line; the trailing placeholder <br> of a paragraph opens nothing
      if (cur) breakPending = true
      else open(np)
      return
    }
    if (BLOCK.has(n.nodeName)) {
      block(n, np)
      return
    }
    for (const c of Array.from(n.childNodes)) inline(c, np, nr)
  }
  const block = (n: EditNode, p?: number) => {
    open(attrNum(n, 'data-p') ?? p)
    for (const c of Array.from(n.childNodes)) inline(c, attrNum(n, 'data-p') ?? p)
    cur = null
    breakPending = false
  }
  for (const c of Array.from(root.childNodes)) {
    if (c.nodeType === 1 && BLOCK.has(c.nodeName)) block(c, attrNum(c, 'data-p'))
    else inline(c, cur ? (cur as EditParagraph).p : undefined)
  }
  return out
}

const clone = <T>(v: T): T => cloneDeep(v)

/**
 * PBIR paragraphs for the edited text. Paragraph settings come from the source paragraph of the first text in it
 * (when a heading is deleted and the next paragraph merges into its element, that paragraph keeps its own settings);
 * text keeps the run it was typed in, with every other key of that run (style, url).
 */
export function paragraphsFromEdit(edited: EditParagraph[], previous: any[]): any[] {
  const prev = Array.isArray(previous) ? previous : []
  const runOf = (p: number | undefined, r: number | undefined): any => {
    const runs = p === undefined ? undefined : prev[p]?.textRuns
    if (!Array.isArray(runs) || !runs.length) return undefined
    return r !== undefined && runs[r] ? runs[r] : runs[0]
  }
  const out: any[] = []
  let lastSrc: number | undefined
  for (const ep of edited) {
    const src = ep.runs.find((r) => r.p !== undefined && (r.text !== '' || r.atomic))?.p ?? ep.p ?? lastSrc ?? (prev.length ? 0 : undefined)
    lastSrc = src
    const base = src !== undefined && prev[src] && typeof prev[src] === 'object' ? prev[src] : {}
    const para: any = {}
    for (const [k, v] of Object.entries(base)) if (k !== 'textRuns') para[k] = clone(v)
    const runs: any[] = []
    let last: { key: string; atomic: boolean } | null = null
    for (const r of ep.runs) {
      const p = r.p ?? src
      const key = `${p}:${r.r ?? 0}`
      if (r.atomic) {
        const raw = r.r !== undefined && p !== undefined ? prev[p]?.textRuns?.[r.r] : undefined
        // one dynamic value may render as several spans (smart-narrative cases): keep it once
        if (raw && !(last?.atomic && last.key === key)) runs.push(clone(raw))
        last = { key, atomic: true }
        continue
      }
      if (r.text === '') continue
      if (last && !last.atomic && last.key === key) {
        runs[runs.length - 1].value += r.text
        continue
      }
      const raw = runOf(p, r.r)
      const run: any = raw && typeof raw === 'object' ? clone(raw) : {}
      for (const k of ['valueExpr', 'expression', 'expr', 'field', 'valueExpression', 'cases', 'defaultCase']) delete run[k]
      run.value = r.text
      runs.push(run)
      last = { key, atomic: false }
    }
    if (!runs.length) {
      const raw = runOf(src, undefined)
      runs.push(raw?.textStyle ? { value: '', textStyle: clone(raw.textStyle) } : { value: '' })
    }
    para.textRuns = runs
    out.push(para)
  }
  return out.length ? out : [{ textRuns: [{ value: '' }] }]
}

function runCss(el: HTMLElement, run: TextRun): void {
  const s = run.style
  el.style.fontFamily = s.fontFamily
  el.style.fontSize = `${s.fontSize}px`
  el.style.fontWeight = String(s.fontWeight)
  el.style.fontStyle = s.fontStyle
  el.style.color = s.color
  const deco = s.textDecoration ?? (run.url ? 'underline' : undefined)
  if (deco) el.style.textDecoration = deco
}

/**
 * Fill the editor with the text box's paragraphs (the same layout as the read view without one-line fitting).
 * `resolveRun` turns one source run into the runs shown for it (dynamic values evaluated).
 */
export function fillEditor(root: HTMLElement, paragraphs: Paragraph[], resolveRun: (run: TextRun) => TextRun[], valueUnderline?: string): EditorStyles {
  const doc = root.ownerDocument
  root.replaceChildren()
  paragraphs.forEach((p, pi) => {
    const first = p.runs[0]?.style
    const sizePx = Math.max(...p.runs.map((r) => r.style.fontSize), first?.fontSize ?? 13.33)
    const indentEm = p.listType ? 1.5 * (p.indent + 1) : 1.5 * p.indent
    const div = doc.createElement('div')
    div.dataset['p'] = String(pi)
    div.style.textAlign = p.align
    div.style.margin = '0'
    if (indentEm) div.style.paddingLeft = `${indentEm}em`
    div.style.position = 'relative'
    div.style.minHeight = `${sizePx * 1.25}px`
    if (first) div.style.fontSize = `${first.fontSize}px`
    div.style.lineHeight = '1.25'
    const marker = p.listType === 'bullet' ? bulletGlyph(p.indent) : p.listType === 'number' ? `${p.listIndex ?? 1}.` : undefined
    if (marker) {
      const m = doc.createElement('span')
      m.dataset['marker'] = ''
      m.contentEditable = 'false'
      m.textContent = marker
      if (first) runCss(m, { text: marker, style: first })
      m.style.position = 'absolute'
      m.style.left = `${indentEm - 1.2}em`
      m.style.width = '1.2em'
      m.style.textAlign = 'left'
      m.style.textDecoration = 'none'
      div.append(m)
    }
    let any = false
    p.runs.forEach((src, ri) => {
      const atomic = !!(src.binding || src.valueRef !== undefined || src.cases)
      for (const run of atomic ? resolveRun(src) : [src]) {
        if (!run.text && !atomic) continue
        const span = doc.createElement('span')
        span.dataset['p'] = String(pi)
        span.dataset['r'] = String(ri)
        runCss(span, run)
        if (atomic) {
          span.dataset['atomic'] = ''
          span.contentEditable = 'false'
          if (valueUnderline && run.text.trim()) {
            span.style.textDecoration = 'underline'
            span.style.textDecorationColor = valueUnderline
            span.style.textUnderlineOffset = '0.2em'
          }
        }
        span.textContent = run.text
        div.append(span)
        any = true
      }
    })
    if (!any) div.append(doc.createElement('br'))
    root.append(div)
  })
  if (!paragraphs.length) {
    const div = doc.createElement('div')
    div.append(doc.createElement('br'))
    root.append(div)
  }
  const styles: EditorStyles = new Map()
  for (const span of Array.from(root.querySelectorAll<HTMLElement>('span[data-r]:not([data-atomic])'))) {
    const sig = styleSignature(span)
    if (!styles.has(sig)) styles.set(sig, { p: span.dataset['p']!, r: span.dataset['r']! })
  }
  return styles
}

/** Source run of each rendered run style (computed), recorded when the editor is filled. */
export type EditorStyles = Map<string, { p: string; r: string }>

function styleSignature(el: Element): string {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el)
  return [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.color, cs.textDecorationLine].join('|')
}

/**
 * Re-tag spans the browser created while editing. Chromium keeps the look of text it moves between paragraphs
 * (deleting a heading and its line break pulls the next paragraph's text into the heading's element) by wrapping it
 * in a new span with inline styles and no data attributes; its computed style still names the run it came from.
 */
export function retagEditor(root: HTMLElement, styles: EditorStyles): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('span:not([data-r]):not([data-marker]), font, b, i, u, strong, em'))) {
    if (el.closest('[data-atomic],[data-marker]')) continue
    const hit = styles.get(styleSignature(el))
    if (!hit) continue
    el.dataset['p'] = hit.p
    el.dataset['r'] = hit.r
  }
}

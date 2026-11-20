import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
// Segoe UI Light ("Segoe UI Light" titles are common in PBI reports) falls back to Open Sans 300
import '@fontsource/open-sans/300.css'
import type { VisualProps } from '../contract'
import type { VisualHostContext } from '../contract'
import { buildParagraphs, themeTextDefaults, bulletGlyph, caseRuns, dynamicKey, fitScale, fitsOneLineInPbi, type Paragraph, type TextRun } from './textboxModel'
import { fillEditor, paragraphsFromEdit, readEditor, retagEditor, type EditorStyles } from './textboxEdit'
import { evaluateField } from './evaluate'
import { evaluateDynamicValue, valueDefs, type EvalResult, type TransformCache } from './narrativeQuery'

/** Shown in place of smart-narrative summaries whose algorithm Lumen doesn't implement (see narrativeQuery.ts). */
export const NARRATIVE_UNSUPPORTED = 'Smart narrative summary isn’t available in Lumen'

type Resolver = (run: TextRun) => EvalResult | undefined

export function makeResolver(visualJson: any, ctx: VisualHostContext): Resolver {
  const defs = valueDefs(visualJson)
  const cache = new Map<string, EvalResult>()
  const transforms: TransformCache = new Map()
  return (run) => {
    const key = dynamicKey(run)
    if (!key) return undefined
    let r = cache.get(key)
    if (!r) {
      if (run.valueRef !== undefined) r = evaluateDynamicValue(ctx, defs.get(run.valueRef), transforms)
      else {
        const ev = evaluateField(ctx, run.binding!)
        r = ev.error ? { error: ev.error } : { value: ev.value, formatted: ev.formatted }
      }
      cache.set(key, r)
    }
    return r
  }
}

/** Replace dynamic runs by their formatted values and smart-narrative switches by the matching case. */
export function resolveRuns(runs: TextRun[], resolve: Resolver, depth = 0): TextRun[] {
  const out: TextRun[] = []
  let noted = false
  const note = (style: TextRun['style']) => {
    if (noted) return
    noted = true
    out.push({ text: NARRATIVE_UNSUPPORTED, style: { ...style, color: '#605E5C', fontStyle: 'italic' } })
  }
  for (const r of runs) {
    if (r.cases) {
      const ev = resolve({ text: '', style: r.style, valueRef: r.cases.on })
      if (ev && 'value' in ev && depth < 8) out.push(...resolveRuns(caseRuns(r, ev.value), resolve, depth + 1))
      else note(r.style)
      continue
    }
    const ev = resolve(r)
    if (!ev) out.push(r)
    else if ('formatted' in ev) out.push({ text: ev.formatted, style: r.style, url: r.url, dynamic: true })
    else if ('unsupported' in ev) note(r.style)
    else out.push({ text: '(error)', style: r.style })
  }
  // drop zero-width no-break spaces PBI pads narrative paragraphs with
  return out.map((r) => (r.text.includes('\uFEFF') ? { ...r, text: r.text.replace(/\uFEFF/g, '') } : r))
}

function paragraphsOf(visualJson: any): any[] {
  const p = visualJson?.visual?.objects?.general?.[0]?.properties?.paragraphs
  return Array.isArray(p) ? p : []
}

/**
 * Dynamic values (Q&A "+ Value", smart narratives) are underlined in theme color 1 while editing, like Power BI
 * Desktop / the service's edit mode; reading view shows them plain.
 */
function RunView({ run, scale = 1, valueUnderline }: { run: TextRun; scale?: number; valueUnderline?: string }) {
  const style: CSSProperties = { ...run.style, fontSize: `${run.style.fontSize * scale}px` }
  if (run.dynamic && valueUnderline && run.text.trim()) Object.assign(style, { textDecoration: 'underline', textDecorationColor: valueUnderline, textUnderlineOffset: '0.2em', textDecorationThickness: '1px' })
  const text = run.text
  if (run.url) {
    return (
      <a href={run.url} target="_blank" rel="noreferrer" style={{ ...style, textDecoration: run.style.textDecoration ?? 'underline' }} data-url={run.url}>
        {text}
      </a>
    )
  }
  return <span style={style}>{text}</span>
}

/**
 * One paragraph. When Power BI would set it on a single line (Segoe UI metrics) but our fallback
 * font is wider, the line is kept unwrapped and its font scaled down just enough to fit — so titles
 * keep PBI's line breaks and never overflow the box (approximation of Segoe UI's narrower glyphs).
 */
function ParagraphView({ p: source, resolve, width, valueUnderline }: { p: Paragraph; resolve: Resolver; width?: number; valueUnderline?: string }) {
  const p = useMemo(() => ({ ...source, runs: resolveRuns(source.runs, resolve) }), [source, resolve])
  const first = p.runs[0]?.style ?? source.runs[0]?.style
  const sizePx = Math.max(...source.runs.map((r) => r.style.fontSize), first?.fontSize ?? 13.33)
  const empty = p.runs.every((r) => r.text === '')
  const indentEm = p.listType ? 1.5 * (p.indent + 1) : 1.5 * p.indent
  const marker = p.listType === 'bullet' ? bulletGlyph(p.indent) : p.listType === 'number' ? `${p.listIndex ?? 1}.` : undefined
  const oneLine = !empty && width !== undefined && fitsOneLineInPbi(p, width)
  const [scale, setScale] = useState(1)
  const lineRef = useRef<HTMLSpanElement>(null)
  const scaleRef = useRef(1)
  scaleRef.current = scale
  useLayoutEffect(() => {
    if (!oneLine) {
      if (scaleRef.current !== 1) setScale(1)
      return
    }
    let alive = true
    const measure = () => {
      const el = lineRef.current
      const box = el?.parentElement
      if (!alive || !el || !box) return
      const natural = el.getBoundingClientRect().width / scaleRef.current
      const avail = box.clientWidth - (parseFloat(getComputedStyle(box).paddingLeft) || 0)
      const k = fitScale(natural, avail)
      if (Math.abs(k - scaleRef.current) > 0.001) setScale(k)
    }
    measure()
    // webfonts may finish loading after the first layout
    void document.fonts?.ready.then(measure)
    return () => {
      alive = false
    }
  }, [oneLine, width, p])
  const k = oneLine ? scale : 1
  return (
    <div
      style={{
        textAlign: p.align,
        margin: 0,
        paddingLeft: indentEm ? `${indentEm}em` : undefined,
        position: 'relative',
        minHeight: `${sizePx * 1.25}px`,
        fontSize: first ? `${first.fontSize * k}px` : undefined,
        lineHeight: k !== 1 ? `${sizePx * 1.25}px` : 1.25,
        whiteSpace: oneLine ? 'pre' : undefined
      }}
    >
      {marker && (
        <span style={{ position: 'absolute', left: `${indentEm - 1.2}em`, width: '1.2em', textAlign: 'left', ...(first ?? {}), fontSize: first ? `${first.fontSize * k}px` : undefined }}>
          {marker}
        </span>
      )}
      {empty ? (
        <br />
      ) : oneLine ? (
        <span ref={lineRef}>
          {p.runs.map((r, i) => (
            <RunView key={i} run={r} scale={k} valueUnderline={valueUnderline} />
          ))}
        </span>
      ) : (
        p.runs.map((r, i) => <RunView key={i} run={r} valueUnderline={valueUnderline} />)
      )}
    </div>
  )
}

export function TextboxVisual({ visual, width, height, ctx }: VisualProps) {
  const raw = paragraphsOf(visual.json)
  const defaults = useMemo(() => themeTextDefaults(ctx.theme), [ctx.theme])
  const paragraphs = useMemo(() => buildParagraphs(raw, defaults), [raw, defaults])
  const resolve = useMemo(() => makeResolver(visual.json, ctx), [visual.json, ctx])
  const [editing, setEditing] = useState(false)
  const valueUnderline = ctx.mode === 'edit' ? (ctx.theme.dataColors[0] ?? '#118DFF') : undefined
  const editRef = useRef<HTMLDivElement>(null)
  const editStyles = useRef<EditorStyles>(new Map())

  // The editor's content is plain DOM built once per edit session (see textboxEdit.ts): React renders no children
  // into the contentEditable box, so the browser's own edits (deleting a whole paragraph) never desync React.
  useLayoutEffect(() => {
    const el = editRef.current
    if (!editing || !el) return
    editStyles.current = fillEditor(el, paragraphs, (run) => resolveRuns([run], resolve), valueUnderline)
    el.focus()
  }, [editing])

  const commit = () => {
    const el = editRef.current
    setEditing(false)
    if (!el) return
    retagEditor(el, editStyles.current)
    const edited = readEditor(el)
    const before = paragraphsOf(visual.json)
    const next = paragraphsFromEdit(edited, before)
    if (JSON.stringify(next) === JSON.stringify(before)) return
    ctx.updateVisual((vj) => {
      const v = vj.visual
      v.objects ??= {}
      v.objects.general ??= [{ properties: {} }]
      v.objects.general[0].properties ??= {}
      v.objects.general[0].properties.paragraphs = paragraphsFromEdit(edited, paragraphsOf(vj))
    })
  }

  const onLinkClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-url]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    if (ctx.mode === 'view' || e.ctrlKey || e.metaKey) ctx.actions.openUrl(a.dataset.url!)
  }

  const box: CSSProperties = {
    width,
    height,
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    cursor: 'default',
    userSelect: editing ? 'text' : 'none'
  }

  if (editing) {
    return (
      <div
        key="edit"
        ref={editRef}
        style={{ ...box, outline: '1px dashed #118DFF', cursor: 'text' }}
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
          }
          e.stopPropagation()
        }}
        onMouseDown={(e) => e.stopPropagation()}
      />
    )
  }

  return (
    <div
      key="view"
      style={box}
      onClick={onLinkClick}
      onDoubleClick={() => {
        if (ctx.mode !== 'edit') return
        setEditing(true)
      }}
    >
      {paragraphs.map((p, i) => (
        <ParagraphView key={i} p={p} resolve={resolve} width={width} valueUnderline={valueUnderline} />
      ))}
    </div>
  )
}

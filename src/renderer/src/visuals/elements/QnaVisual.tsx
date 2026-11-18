/**
 * Q&A visual (`qnaVisual`): a question box that turns natural-language questions into a live visual,
 * rendered inside the box with the registered visual for the chosen type.
 *
 * Power BI parity: recognized terms are underlined in blue and unknown words with a red squiggle, a
 * restatement line shows how the question was understood, starter questions are suggested from the
 * model, and (edit mode) "Turn this Q&A result into a standard visual" replaces the Q&A visual with
 * the generated one (query + visual-level filters, incl. TopN, in Power BI's saved shapes).
 *
 * Approximation: the language understanding is Lumen's small rule-based grammar (see ./qna/parse.ts),
 * not the Power BI Q&A service — it covers aggregations, grouping, top/bottom N, sorting, value and
 * numeric filters and explicit visual types, and says so when it doesn't understand a word.
 * The typed question is saved in `objects.general.question` (edit mode).
 */
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { ChartMultiple20Regular, ChatBubblesQuestion20Regular, Dismiss16Regular } from '@fluentui/react-icons'
import { decodeLiteral, encodeLiteral } from '@core/report/literal'
import type { VisualHostContext, VisualProps } from '../contract'
import { getVisual } from '../registry'
import { createQnaEngine } from './qna'
import { applyQnaResult, previewFilters, visualLabel } from './qna/build'
import type { TokenSpan } from './qna/parse'

const FONT = "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif"
const NOOP = () => undefined

export function savedQuestion(visualJson: any): string {
  const raw = visualJson?.visual?.objects?.general?.[0]?.properties?.question?.expr?.Literal?.Value
  if (typeof raw !== 'string') return ''
  const v = decodeLiteral(raw)
  return typeof v === 'string' ? v : ''
}

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error?: string; key?: string }> {
  override state: { error?: string; key?: string } = {}
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { error?: string; key?: string }) {
    return p.resetKey !== s.key ? { error: undefined, key: p.resetKey } : null
  }
  override componentDidCatch(_e: unknown, _i: ErrorInfo) {}
  override render() {
    return this.state.error ? <div style={{ color: '#A4262C', fontSize: 12, padding: 8 }}>Couldn’t render this result: {this.state.error}</div> : this.props.children
  }
}

/** The question text drawn under a transparent input, with PBI-style term underlines. */
function Highlighted({ text, spans, scrollLeft }: { text: string; spans: TokenSpan[]; scrollLeft: number }) {
  const parts: ReactNode[] = []
  let at = 0
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(text.slice(at, s.start))
    const deco =
      s.role === 'unknown'
        ? { textDecoration: 'underline wavy #D13438', textUnderlineOffset: 3 }
        : s.role === 'field' || s.role === 'value'
          ? { textDecoration: 'underline', textDecorationColor: '#118DFF', textDecorationThickness: 2, textUnderlineOffset: 4 }
          : undefined
    parts.push(
      <span key={i} style={deco}>
        {text.slice(s.start, s.end)}
      </span>
    )
    at = s.end
  })
  if (at < text.length) parts.push(text.slice(at))
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, padding: '0 8px', whiteSpace: 'pre', overflow: 'hidden', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
      <div style={{ transform: `translateX(${-scrollLeft}px)` }}>{parts}</div>
    </div>
  )
}

export function QnaVisual({ visual, width, height, ctx }: VisualProps) {
  const initial = savedQuestion(visual.json)
  const [text, setText] = useState(initial)
  const [debounced, setDebounced] = useState(initial)
  const [focus, setFocus] = useState(false)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [completionIdx, setCompletionIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setText(initial)
    setDebounced(initial)
  }, [initial])
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 200)
    return () => clearTimeout(t)
  }, [text])

  const qna = useMemo(() => createQnaEngine(ctx.engine), [ctx.engine])
  const suggestions = useMemo(() => qna.suggestions(6), [qna])
  const answer = useMemo(() => (debounced.trim() ? qna.ask(debounced) : undefined), [qna, debounced])
  const liveSpans = useMemo(() => (text.trim() ? qna.ask(text).interp.spans : []), [qna, text])
  const completions = useMemo(() => (focus ? qna.complete(text, 6) : []), [qna, text, focus])
  const spec = answer?.spec
  const filtersKey = JSON.stringify(ctx.filters)
  const preview = useMemo(
    () => (spec && answer ? previewFilters(spec, answer.interp, ctx.engine, ctx.filters) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, answer, ctx.engine, filtersKey]
  )
  const def = spec ? getVisual(spec.visualType) : undefined

  const innerCtx: VisualHostContext | undefined = useMemo(
    () =>
      preview
        ? {
            ...ctx,
            filters: preview.filters,
            highlightFilters: undefined,
            selection: [],
            select: NOOP,
            drill: { level: 0, path: [] },
            setDrill: NOOP,
            showContextMenu: NOOP,
            // the result is transient: interactions inside it must not edit the Q&A visual's JSON
            updateVisual: NOOP
          }
        : undefined,
    [ctx, preview]
  )

  const commitQuestion = (q: string) => {
    if (ctx.mode !== 'edit' || q === initial) return
    ctx.updateVisual((j) => {
      j.visual ??= {}
      j.visual.objects ??= {}
      const props = { question: { expr: { Literal: { Value: encodeLiteral(q) } } } }
      if (q) j.visual.objects.general = [{ properties: { ...(j.visual.objects.general?.[0]?.properties ?? {}), ...props } }]
      else if (j.visual.objects.general?.[0]?.properties) delete j.visual.objects.general[0].properties.question
    })
  }

  const turnIntoVisual = () => {
    if (spec) ctx.updateVisual((j) => applyQnaResult(j, spec))
  }

  const ask = (q: string) => {
    setText(q)
    setDebounced(q)
    commitQuestion(q)
    inputRef.current?.focus()
  }

  const applyCompletion = (c: string) => {
    const m = /(\S+)$/.exec(text)
    const next = (m ? text.slice(0, m.index) : text) + c + ' '
    setText(next)
    setCompletionIdx(-1)
    inputRef.current?.focus()
  }

  const boxH = 34
  const pad = 8
  const editMode = ctx.mode === 'edit'
  const resultH = Math.max(0, height - boxH - pad * 2 - 30)
  const resultW = Math.max(0, width - pad * 2)
  const showCompletions = focus && completions.length > 0

  return (
    <div style={{ width, height, display: 'flex', flexDirection: 'column', padding: pad, boxSizing: 'border-box', fontFamily: FONT, color: '#252423', overflow: 'hidden', gap: 6 }}>
      <div style={{ position: 'relative', flex: 'none' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: boxH,
            border: `1px solid ${focus ? '#118DFF' : '#C8C6C4'}`,
            borderRadius: 4,
            background: '#FFFFFF',
            boxShadow: focus ? '0 0 0 1px #118DFF inset' : undefined
          }}
        >
          <span style={{ display: 'flex', padding: '0 2px 0 8px', color: '#118DFF' }}>
            <ChatBubblesQuestion20Regular />
          </span>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%' }}>
            {text && <Highlighted text={text} spans={liveSpans} scrollLeft={scrollLeft} />}
            <input
              ref={inputRef}
              value={text}
              spellCheck={false}
              placeholder="Ask a question about your data"
              onChange={(e) => {
                setText(e.target.value)
                setCompletionIdx(-1)
              }}
              onScroll={(e) => setScrollLeft((e.target as HTMLInputElement).scrollLeft)}
              onSelect={(e) => setScrollLeft((e.target as HTMLInputElement).scrollLeft)}
              onFocus={() => setFocus(true)}
              onBlur={() => {
                setFocus(false)
                commitQuestion(text)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (showCompletions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault()
                  setCompletionIdx((i) => (e.key === 'ArrowDown' ? Math.min(completions.length - 1, i + 1) : Math.max(-1, i - 1)))
                } else if (showCompletions && (e.key === 'Tab' || (e.key === 'Enter' && completionIdx >= 0))) {
                  e.preventDefault()
                  applyCompletion(completions[Math.max(0, completionIdx)])
                } else if (e.key === 'Enter') {
                  setDebounced(text)
                  commitQuestion(text)
                } else if (e.key === 'Escape') setCompletionIdx(-1)
              }}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                border: 0,
                outline: 0,
                background: 'transparent',
                padding: '0 8px',
                fontFamily: FONT,
                fontSize: 14,
                color: text ? 'transparent' : '#252423',
                caretColor: '#252423',
                boxSizing: 'border-box'
              }}
            />
          </div>
          {text && (
            <button title="Clear" onClick={() => ask('')} style={iconBtn}>
              <Dismiss16Regular />
            </button>
          )}
          {editMode && (
            <button
              title={spec ? 'Turn this Q&A result into a standard visual' : 'Ask a question to create a visual'}
              disabled={!spec || !def}
              onClick={turnIntoVisual}
              style={{ ...iconBtn, color: spec && def ? '#252423' : '#C8C6C4', cursor: spec && def ? 'pointer' : 'default', marginRight: 4 }}
            >
              <ChartMultiple20Regular />
            </button>
          )}
        </div>
        {showCompletions && (
          <div role="listbox" style={{ position: 'absolute', top: boxH + 2, left: 30, right: 0, background: '#FFFFFF', border: '1px solid #E1DFDD', boxShadow: '0 3.2px 7.2px rgba(0,0,0,.13), 0 .6px 1.8px rgba(0,0,0,.11)', zIndex: 5, padding: '4px 0' }}>
            {completions.map((c, i) => (
              <div
                key={c}
                role="option"
                aria-selected={i === completionIdx}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyCompletion(c)
                }}
                style={{ padding: '4px 10px', fontSize: 13, cursor: 'pointer', background: i === completionIdx ? '#F3F2F1' : undefined }}
              >
                {text.replace(/\S+$/, '')}
                <b>{c}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {!text.trim() ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {qna.schema.fields.length ? (
            <>
              <div style={{ fontSize: 12, color: '#605E5C', margin: '4px 0 8px' }}>Try one of these to get started</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => ask(s)} style={pill}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#605E5C', marginTop: 4 }}>Q&amp;A needs a semantic model with tables to answer questions.</div>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#605E5C', flex: 'none', minHeight: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={answer?.interp.restatement}>
            {spec ? (
              <>
                Showing results for <span style={{ color: '#252423' }}>{answer!.interp.restatement}</span>
                {!answer!.interp.explicitVisual && <span> · {visualLabel(spec.visualType)}</span>}
                {answer!.interp.unrecognized.length > 0 && <span style={{ color: '#A4262C' }}> · didn’t understand “{answer!.interp.unrecognized.join(' ')}”</span>}
              </>
            ) : answer ? (
              <span>Sorry, I don’t understand that. Try rephrasing, or use a field name from your data.</span>
            ) : null}
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {spec && def && innerCtx && resultH > 20 ? (
              <Boundary resetKey={JSON.stringify(spec.json)}>
                <def.component visual={{ name: `${visual.name}__qna`, json: spec.json }} pageName="" width={resultW} height={resultH} ctx={innerCtx} />
              </Boundary>
            ) : spec && !def ? (
              <div style={{ fontSize: 12, color: '#605E5C' }}>The {visualLabel(spec.visualType)} visual isn’t available.</div>
            ) : !spec && answer ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {suggestions.slice(0, 4).map((s) => (
                  <button key={s} onClick={() => ask(s)} style={pill}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            {preview?.error && <div style={{ fontSize: 11, color: '#A4262C' }}>{preview.error}</div>}
          </div>
        </>
      )}
    </div>
  )
}

const iconBtn = { border: 0, background: 'none', padding: 4, display: 'flex', cursor: 'pointer', color: '#605E5C', borderRadius: 2 } as const
const pill = {
  border: '1px solid #C7E0F4',
  background: '#EFF6FC',
  color: '#252423',
  borderRadius: 4,
  padding: '5px 10px',
  fontSize: 12,
  fontFamily: FONT,
  cursor: 'pointer',
  textAlign: 'left'
} as const

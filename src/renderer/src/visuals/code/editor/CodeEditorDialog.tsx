/**
 * The code visual editor: HTML / CSS / JSX / Parameters / Data tabs on the left, a live preview on the right (the
 * real visual, rendered at the visual's size or a test size, with the report's filters). Apply writes the code in one
 * undo step; Revert goes back to the applied code. The preview has its own selection and drill state: clicking in it
 * does not cross-filter the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { cloneDeep } from '@core/clone'
import { identityKey, type DataPointIdentity } from '@core/report/sq'
import { readCodeSource, readParamDefs, writeCodeSource, writeParamDefs, type CodeSource } from '@core/codevisual/model'
import { HELPERS } from '@core/codevisual/template'
import { cssName } from '@core/codevisual/naming'
import { STARTER_TEMPLATES, applyTemplate, type StarterTemplate } from '@core/codevisual/templates'
import type { ParamDef } from '@core/codevisual/types'
import { Modal, confirmDialog } from '../../../app/ui/Modal'
import { Button } from '../../../app/ui/primitives'
import { MenuButton } from '../../../app/ui/Menu'
import { useApp } from '../../../state/store'
import { findPage, findVisual } from '../../../report/pbir'
import { liveContext } from '../../../report/host'
import type { DrillState, VisualHostContext } from '../../contract'
import { CodeVisual, type CodeVisualStatus } from '../CodeVisual'
import { CodeArea, type CodeAreaHandle, type CodeLang, type CodeProblem } from './CodeArea'
import { DataPanel } from './DataPanel'
import { ParamsPanel } from './ParamsPanel'
import { TemplateThumb } from './TemplatePicker'
import './codeEditor.css'

type Tab = 'html' | 'css' | 'jsx' | 'params' | 'data'
type SizeKey = 'current' | 'small' | 'wide' | 'tall'

interface Draft extends CodeSource {
  params: ParamDef[]
}

const SIZES: Record<Exclude<SizeKey, 'current'>, { width: number; height: number; label: string }> = {
  small: { width: 200, height: 120, label: 'Small' },
  wide: { width: 640, height: 200, label: 'Wide' },
  tall: { width: 260, height: 420, label: 'Tall' }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.html === b.html && a.css === b.css && a.jsx === b.jsx && JSON.stringify(a.params) === JSON.stringify(b.params)
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}

/** Content size of the visual on the canvas (falls back to its stored size). */
function canvasSize(visualName: string, json: any): { width: number; height: number } {
  const el = document.querySelector<HTMLElement>(`.wbi-page .wbi-vc[data-visual="${CSS.escape(visualName)}"] .wbi-codevisual`)
  if (el && el.offsetWidth > 0) return { width: el.offsetWidth, height: el.offsetHeight }
  return { width: Math.round(json?.position?.width ?? 400), height: Math.round(json?.position?.height ?? 240) }
}

export function CodeEditorDialog({ pageName, visualName, onClose }: { pageName: string; visualName: string; onClose(): void }) {
  const visual = useApp((s) => findVisual(findPage(s.project?.report, pageName), visualName))
  const stored: Draft = useMemo(() => ({ ...readCodeSource(visual?.json), params: readParamDefs(visual?.json) }), [visual?.json])
  const [draft, setDraft] = useState<Draft>(stored)
  const [tab, setTab] = useState<Tab>(stored.jsx && !stored.html ? 'jsx' : 'html')
  const [sizeKey, setSizeKey] = useState<SizeKey>('current')
  const [dark, setDark] = useState(false)
  const [status, setStatus] = useState<CodeVisualStatus | null>(null)
  const dirty = !sameDraft(draft, stored)
  const debounced = useDebounced(draft, 300)
  const editors = useRef<Partial<Record<CodeLang, CodeAreaHandle | null>>>({})

  // preview: the visual's JSON with the draft code
  const previewJson = useMemo(() => {
    if (!visual) return undefined
    const j = cloneDeep(visual.json)
    writeCodeSource(j, debounced)
    writeParamDefs(j, debounced.params)
    return j
  }, [visual, debounced])

  // preview host context: the live visual's (filters, theme, engine), with a local selection and drill state
  const live = liveContext(pageName, visualName)
  const [drill, setDrill] = useState<DrillState>(() => live?.drill ?? { level: 0, path: [] })
  const [selection, setSelection] = useState<DataPointIdentity[]>([])
  const ctx = useMemo<VisualHostContext | undefined>(() => {
    if (!live) return undefined
    return {
      ...live,
      mode: 'view',
      drill,
      setDrill,
      selection,
      select: (ids, opts) =>
        setSelection((cur) => {
          if (!ids.length) return []
          if (!opts?.multi) return cur.length === 1 && ids.length === 1 && identityKey(cur[0]) === identityKey(ids[0]) ? [] : ids
          const map = new Map(cur.map((c) => [identityKey(c), c]))
          for (const id of ids) map.has(identityKey(id)) ? map.delete(identityKey(id)) : map.set(identityKey(id), id)
          return [...map.values()]
        }),
      updateVisual: () => undefined,
      showContextMenu: () => undefined,
      showTooltip: () => undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.engine, live?.filters, live?.highlightFilters, live?.theme, drill, selection])

  const current = useMemo(() => (visual ? canvasSize(visualName, visual.json) : { width: 400, height: 240 }), [visual, visualName])
  const size = sizeKey === 'current' ? current : SIZES[sizeKey]

  // ---- apply / revert / close ----------------------------------------------------------------
  const apply = useCallback(() => {
    if (!dirty) return
    useApp.getState().mutateReport('Edit code', (r) => {
      const v = findVisual(findPage(r, pageName), visualName)
      if (!v) return
      writeCodeSource(v.json, draft)
      writeParamDefs(v.json, draft.params)
    })
  }, [dirty, draft, pageName, visualName])
  const revert = () => setDraft(stored)
  const close = async () => {
    if (dirty) {
      const b = await confirmDialog({ title: 'Apply your changes?', message: 'The code has changes that are not applied to the visual yet.', buttons: ['Apply', "Don't apply", 'Cancel'], primary: 0 })
      if (b === 2) return
      if (b === 0) apply()
    }
    onClose()
  }
  const useTemplate = async (t: StarterTemplate) => {
    if (draft.html || draft.css || draft.jsx) {
      const b = await confirmDialog({ title: `Use the ${t.name} template?`, message: 'It replaces the HTML, CSS, JSX and parameters in the editor. Nothing changes on the canvas until you apply.', buttons: ['Replace', 'Cancel'], primary: 0 })
      if (b !== 0) return
    }
    const j: any = { visual: { objects: {} } }
    applyTemplate(j, t)
    setDraft({ ...readCodeSource(j), params: readParamDefs(j) })
    setTab(t.jsx ? 'jsx' : 'html')
  }

  // ---- problems --------------------------------------------------------------------------------
  const problems = useMemo(() => {
    const out: Record<CodeLang, CodeProblem[]> = { html: [], css: [], jsx: [] }
    const e = status?.error
    if (e) {
      const lang: CodeLang | undefined = e.phase === 'template' ? 'html' : e.phase === 'css' ? 'css' : e.phase === 'transpile' || e.phase === 'runtime' || e.phase === 'promise' ? 'jsx' : undefined
      if (lang) out[lang].push({ severity: 'error', message: e.message, line: e.line, column: e.column })
    }
    for (const w of status?.warnings ?? []) out[w.phase === 'css' ? 'css' : 'html'].push({ severity: 'warning', message: w.message, line: w.line, column: w.column })
    return out
  }, [status])
  const allProblems = [...problems.html.map((p) => ({ ...p, lang: 'html' as const })), ...problems.css.map((p) => ({ ...p, lang: 'css' as const })), ...problems.jsx.map((p) => ({ ...p, lang: 'jsx' as const }))]
  const dataError = status?.error && !['template', 'css', 'transpile', 'runtime', 'promise'].includes(status.error.phase) ? status.error : null

  // ---- completions ---------------------------------------------------------------------------
  const statusRef = useRef(status)
  statusRef.current = status
  const draftRef = useRef(draft)
  draftRef.current = draft
  const completions = useMemo(() => makeCompletions(() => statusRef.current, () => draftRef.current.params), [])

  if (!visual || !previewJson) return null
  const setLayer = (k: 'html' | 'css' | 'jsx') => (v: string) => setDraft((d) => (d[k] === v ? d : { ...d, [k]: v }))
  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'html', label: 'HTML', count: problems.html.length },
    { key: 'css', label: 'CSS', count: problems.css.length },
    { key: 'jsx', label: 'JSX', count: problems.jsx.length },
    { key: 'params', label: 'Parameters' },
    { key: 'data', label: 'Data' }
  ]
  const scale = Math.min(1, 560 / size.width, 520 / size.height)

  return (
    <Modal
      title="Edit code"
      subtitle={
        <>
          HTML templates, CSS and optional JSX run in a sandbox: no network, no access to the app. Fields come from the visual&rsquo;s wells; images from the report&rsquo;s registered images (<code>{'{{resource "name"}}'}</code>) or data: URIs.
        </>
      }
      onClose={() => void close()}
      width="min(1360px, 96vw)"
      height="min(880px, 92vh)"
      className="wbi-cve"
      bodyClassName="wbi-cve__body"
      footerLeft={
        <>
          <MenuButton
            className="wbi-btn wbi-btn--default"
            items={STARTER_TEMPLATES.map((t) => ({ label: t.name, onClick: () => void useTemplate(t), icon: <TemplateThumb id={t.id} /> }))}
          >
            Templates
          </MenuButton>
          <Button onClick={revert} disabled={!dirty}>
            Revert
          </Button>
          <span className="wbi-cve__hint">Ctrl+Enter applies</span>
        </>
      }
      footer={
        <>
          <Button variant="primary" onClick={apply} disabled={!dirty}>
            Apply
          </Button>
          <Button onClick={() => void close()}>Close</Button>
        </>
      }
    >
      <div className="wbi-cve__left">
        <div className="wbi-cve__tabs" role="tablist" aria-label="Code">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`wbi-cve__tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {t.key !== 'params' && t.key !== 'data' && (draft as any)[t.key] ? <span className="wbi-cve__dot" aria-hidden /> : null}
              {t.count ? <span className="wbi-cve__count">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="wbi-cve__pane">
          {(['html', 'css', 'jsx'] as const).map((k) => (
            <div key={k} className="wbi-cve__editor" hidden={tab !== k}>
              <CodeArea
                ref={(h) => {
                  editors.current[k] = h
                }}
                lang={k}
                label={`${k.toUpperCase()} code`}
                value={draft[k]}
                onChange={setLayer(k)}
                onApply={apply}
                completions={completions[k]}
                problems={problems[k]}
              />
            </div>
          ))}
          {tab === 'params' && <ParamsPanel params={draft.params} onChange={(params) => setDraft((d) => ({ ...d, params }))} />}
          {tab === 'data' && <DataPanel status={status} />}
        </div>
        <div className="wbi-cve__problems" aria-live="polite">
          {dataError ? (
            <div className="wbi-cve__problem is-error">{dataError.message}</div>
          ) : allProblems.length ? (
            allProblems.slice(0, 6).map((p, i) => (
              <button
                key={i}
                type="button"
                className={`wbi-cve__problem is-${p.severity}`}
                onClick={() => {
                  setTab(p.lang)
                  if (p.line) setTimeout(() => editors.current[p.lang]?.reveal(p.line!, p.column), 0)
                }}
              >
                <b>{p.lang.toUpperCase()}</b> {p.line ? `${p.line}:${p.column ?? 1}` : ''} {p.message}
              </button>
            ))
          ) : (
            <span className="wbi-cve__ok">No problems</span>
          )}
        </div>
      </div>
      <div className="wbi-cve__right">
        <div className="wbi-cve__previewbar">
          <span className="wbi-cve__label">Preview</span>
          <div className="wbi-cve__seg" role="group" aria-label="Preview size">
            {(['current', 'small', 'wide', 'tall'] as SizeKey[]).map((k) => (
              <button key={k} type="button" aria-pressed={sizeKey === k} onClick={() => setSizeKey(k)}>
                {k === 'current' ? 'Current' : SIZES[k].label}
              </button>
            ))}
          </div>
          <label className="wbi-cve__darktoggle">
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark page
          </label>
        </div>
        <div className={`wbi-cve__stage${dark ? ' is-dark' : ''}`}>
          <div className="wbi-cve__frame" style={{ width: size.width * scale, height: size.height * scale }}>
            <div className="wbi-cve__visual" data-preview="1" style={{ width: size.width, height: size.height, transform: scale < 1 ? `scale(${scale})` : undefined }}>
              {ctx ? (
                <CodeVisual visual={{ name: visualName, json: previewJson }} pageName={pageName} width={size.width} height={size.height} ctx={ctx} onStatus={setStatus} />
              ) : (
                <div className="wbi-cve__nopreview">Show the visual&rsquo;s page to preview it.</div>
              )}
            </div>
          </div>
          <div className="wbi-cve__size">
            {size.width} × {size.height} px{scale < 1 ? ` (shown at ${Math.round(scale * 100)}%)` : ''}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// completions
// ---------------------------------------------------------------------------------------------

const BLOCKS = ['#each rows', '#if ', '#unless ', '#with ', 'else', '/each', '/if', '/unless', '/with']
const DATA_ATTRS: Array<[string, string]> = [
  ['data-select', 'click selects the row (Ctrl+click adds); cross-filters the page'],
  ['data-drill', 'click drills into the row'],
  ['data-drill-up', 'click drills up'],
  ['data-expand', 'click expands all down one level'],
  ['data-next-level', 'click goes to the next level'],
  ['data-clear', 'click clears the selection'],
  ['data-no-tooltip', 'no row tooltip inside this element']
]
const ROW_NAMES = ['category', 'label', 'selected', 'highlighted', 'canDrill', 'depth', 'value1', 'value2', 'value3', '@index', '@number', '@first', '@last']
const ROOT_NAMES = ['rows', 'measure1', 'measure2', 'measureName1', 'measureName2', 'categoryName', 'rowCount', 'breadcrumb', 'level', 'hasHighlight', 'hasSelection', 'truncated', 'drill.canDrillUp', 'drill.canDrillDown', 'drill.levelName']
const JSX_PROPS = ['rows', 'columns', 'values', 'measures', 'totals', 'theme', 'size', 'params', 'drillInfo', 'level', 'breadcrumb', 'truncated', 'hasHighlight', 'selection', 'html', 'select', 'clear', 'drill', 'drillUp', 'expandNextLevel', 'goToNextLevel', 'tooltip', 'isSelected', 'isHighlighted', 'format', 'resource', 'rowStyle', 'rowProps']

function makeCompletions(status: () => CodeVisualStatus | null, params: () => ParamDef[]) {
  const fieldNames = () => (status()?.data?.columns ?? []).map((c) => c.name)
  const html = (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 200), ctx.pos)
    const open = before.lastIndexOf('{{')
    if (open >= 0 && before.indexOf('}}', open) < 0) {
      const word = ctx.matchBefore(/[@#/\w.[\] ]*$/)
      const from = word ? word.from + (word.text.length - word.text.trimStart().length) : ctx.pos
      const opts: Completion[] = [
        ...fieldNames().map((n) => ({ label: n, type: 'variable', detail: 'field' })),
        ...ROOT_NAMES.map((n) => ({ label: n, type: 'property' })),
        ...ROW_NAMES.map((n) => ({ label: n, type: 'property', detail: 'in #each' })),
        ...params().map((p) => ({ label: `params.${p.name}`, type: 'property', detail: 'parameter' })),
        ...Object.keys(HELPERS).map((h) => ({ label: h, type: 'function', detail: 'helper' })),
        ...BLOCKS.map((b) => ({ label: b, type: 'keyword' }))
      ]
      return { from, options: opts, validFor: /^[@#/\w.[\] ]*$/ }
    }
    const attr = ctx.matchBefore(/data-[\w-]*$/)
    if (attr) return { from: attr.from, options: DATA_ATTRS.map(([a, d]) => ({ label: a, type: 'property', detail: d })) }
    return null
  }
  const css = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/--[\w-]*$/)
    if (!m) return null
    const s = status()
    const names = new Set<string>(Object.keys(s?.vars ?? {}))
    const firstRow = s?.rowStyles?.[0] ?? ''
    for (const part of firstRow.split(';')) {
      const k = part.split(':')[0]?.trim()
      if (k) names.add(k)
    }
    for (const p of params()) names.add(`--param-${cssName(p.name)}`)
    return {
      from: m.from,
      options: [...names].sort().map((n) => ({ label: n, type: 'variable', detail: s?.vars?.[n] ? String(s.vars[n]).slice(0, 24) : 'per row' })),
      validFor: /^--[\w-]*$/
    }
  }
  const jsx = (ctx: CompletionContext): CompletionResult | null => {
    const w = ctx.matchBefore(/[\w$]+$/)
    if (!w && !ctx.explicit) return null
    const cols = status()?.data?.columns ?? []
    return {
      from: w?.from ?? ctx.pos,
      options: [...JSX_PROPS.map((p) => ({ label: p, type: 'property', detail: 'prop' })), ...cols.map((c) => ({ label: c.js, type: 'variable', detail: `row.${c.js} = ${c.name}` }))],
      validFor: /^[\w$]*$/
    }
  }
  return { html, css, jsx }
}

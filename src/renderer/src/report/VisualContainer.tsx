/**
 * Visual container: positions a visual on the page and draws PBI container chrome (title, subtitle,
 * divider, background, border, shadow, padding, visual header on hover, visual link), hosts the visual
 * component (via the registry) inside an error boundary, and reports first render for headless readiness.
 */
import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  QuestionCircleRegular,
  ArrowDownRegular,
  ArrowMaximizeRegular,
  ArrowTurnDownRightRegular,
  ArrowUpRegular,
  ErrorCircleRegular,
  FilterRegular,
  MoreHorizontalRegular,
  BranchForkRegular
} from '@fluentui/react-icons'
import type { ReportDocument, VisualDocument } from '@core/report/types'
import type { SQFilter } from '@core/report/sq'
import type { VisualDefinition, VisualHostContext, VisualProps } from '../visuals/contract'
import { getVisual } from '../visuals/registry'
import { customVisualDisplayName, customVisualLabel } from '../visuals/custom/customVisualInfo'
import { useApp } from '../state/store'
import { useInteraction } from '../state/interaction'
import { borderCss, gradientBorderLayer, resolveChrome, titleAreaGaps, type ChromeSpec, type TextSpec } from './chrome'
import { lumenStyleCss, lumenStyleOf } from '@core/report/lumenStyle'
import { entranceDelay, motionFamily, visualMotion } from '@core/report/motion'
import { VisualAnimator, type AnimatorOptions } from './motion/animator'
import { onReplayMotion } from './motion/env'
import { activeGradients, GradientPainter } from './gradientPaint'
import { resolveBoundColors } from './boundColors'
import { useCanvasEnv } from './canvasEnv'
import { lastMenuRequest, registerLiveContext, useVisualHost } from './host'
import { PerfMark, useVisualPerf } from './perf'
import { applyBoundContainerColors } from './containerCF'
import { brokenFields, removeBrokenFields, reportMeasureKeys, type BrokenField } from './brokenFields'

const NO_BROKEN: BrokenField[] = []
import { useShell } from '../app/shellState'
import { isSlicerType, visualFields, visualTypeOf, type Rect } from './pbir'
import { applyBookmark, drillthrough, goBack, navigatePage, openUrl, clearAllSlicers, setDrill } from './runtime'
import { describeFilters } from './filterSummary'
import { VisualReadyContext, type VisualReadiness } from '../visuals/common/readiness'
import { sampleContext, sampleDatasetText, sampleDrawFor } from './sampleData'

// ---------------------------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------------------------

interface BoundaryProps {
  visualType: string
  resetKey: unknown
  onError?(): void
  children: ReactNode
}

export class VisualErrorBoundary extends Component<BoundaryProps, { error: Error | null; details: boolean }> {
  override state = { error: null as Error | null, details: false }
  static getDerivedStateFromError(error: Error) {
    return { error, details: false }
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[visual ${this.props.visualType}]`, error, info.componentStack)
    this.props.onError?.()
  }
  override componentDidUpdate(prev: BoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, details: false })
  }
  override render() {
    if (!this.state.error) return this.props.children
    return (
      <VisualMessage
        title="Can't display this visual"
        detailsOpen={this.state.details}
        onToggleDetails={() => this.setState({ details: !this.state.details })}
        details={`${this.state.error.message}\n\nVisual type: ${this.props.visualType}`}
      />
    )
  }
}

export function VisualMessage(props: { title: string; details?: string; detailsOpen?: boolean; onToggleDetails?(): void; icon?: ReactNode; action?: { label: string; onClick(): void } }) {
  return (
    <div className="wbi-vmsg">
      <div className="wbi-vmsg-icon">{props.icon ?? <ErrorCircleRegular />}</div>
      <div className="wbi-vmsg-title">{props.title}</div>
      {props.action && (
        <button
          className="wbi-link"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            props.action!.onClick()
          }}
        >
          {props.action.label}
        </button>
      )}
      {props.details && (
        <button
          className="wbi-link"
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleDetails?.()
          }}
        >
          {props.detailsOpen ? 'Hide details' : 'See details'}
        </button>
      )}
      {props.details && props.detailsOpen && <pre className="wbi-vmsg-details">{props.details}</pre>}
    </div>
  )
}

function UnknownVisual({ visualType, report }: { visualType: string; report?: ReportDocument }) {
  // AppSource / organizational custom visuals: their visualType carries a GUID suffix or is listed by the report
  const isCustom = /[0-9A-F]{32}$/i.test(visualType) || ((report?.report?.publicCustomVisuals ?? []) as string[]).includes(visualType) || !!(report && customVisualDisplayName(report, visualType))
  const short = isCustom ? customVisualLabel(report, visualType) : visualType
  return (
    <div className="wbi-unknown">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
        <rect x="3" y="14" width="5" height="11" fill="#C8C6C4" />
        <rect x="11.5" y="8" width="5" height="17" fill="#B3B0AD" />
        <rect x="20" y="3" width="5" height="22" fill="#C8C6C4" />
      </svg>
      <div className="wbi-unknown-type" title={visualType}>
        {short}
      </div>
      <div className="wbi-unknown-note">{isCustom ? "This custom visual isn't supported in Lumen" : "This visual type isn't supported yet"}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Visual content (memoized: dragging the container doesn't re-render the visual)
// ---------------------------------------------------------------------------------------------

const VisualContent = memo(function VisualContent(props: { def: VisualDefinition } & VisualProps) {
  const C = props.def.component
  return <C visual={props.visual} pageName={props.pageName} width={props.width} height={props.height} ctx={props.ctx} />
})

// ---------------------------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------------------------

function quoteTable(t: string): string {
  return `'${t.replace(/'/g, "''")}'`
}

/** Evaluate a data-bound title/subtitle (field-value conditional formatting: a measure or aggregation). */
function evalBoundText(raw: any, ctx: VisualHostContext | null): string | undefined {
  if (!ctx) return undefined
  const e = raw?.expr ?? raw
  try {
    if (e?.Measure) {
      const t = e.Measure.Expression?.SourceRef?.Entity
      const dax = t ? `${quoteTable(t)}[${e.Measure.Property}]` : `[${e.Measure.Property}]`
      const r = ctx.engine.evaluateScalar(dax, ctx.filters)
      return r.value === null ? '' : ctx.format(r.value, r.formatString)
    }
    if (e?.Aggregation?.Expression?.Column) {
      const c = e.Aggregation.Expression.Column
      const fn = ['SUM', 'AVERAGE', 'DISTINCTCOUNT', 'MIN', 'MAX', 'COUNT', 'MEDIAN', 'STDEV.P', 'VAR.P'][e.Aggregation.Function ?? 0] ?? 'SUM'
      const r = ctx.engine.evaluateScalar(`${fn}(${quoteTable(c.Expression?.SourceRef?.Entity ?? '')}[${c.Property}])`, ctx.filters)
      return r.value === null ? '' : ctx.format(r.value, r.formatString)
    }
  } catch {
    return undefined
  }
  return undefined
}

const VALUE_ROLES = ['Y', 'Values', 'Y2', 'Size', 'Value', 'Fields', 'Data', 'Measure', 'TargetValue', 'Indicator', 'Goal']
const CATEGORY_ROLES = ['Category', 'Axis', 'Rows', 'Series', 'Legend', 'Columns', 'X', 'Details', 'Location']

/** PBI auto title: "<values> by <categories>" (e.g. "Total Sales by Category and Region"). */
export function autoTitle(visualJson: any, ctx: VisualHostContext | null): string {
  const fields = visualFields(visualJson)
  const name = (f: { expr: any; displayName?: string }) => f.displayName ?? ctx?.engine.describeField(f.expr)?.displayName ?? (f.expr?.Measure?.Property ?? f.expr?.Column?.Property ?? f.expr?.HierarchyLevel?.Level ?? f.expr?.Aggregation?.Expression?.Column?.Property ?? '')
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]
  const values = uniq(fields.filter((f) => VALUE_ROLES.includes(f.role)).map(name))
  const cats = uniq(fields.filter((f) => CATEGORY_ROLES.includes(f.role)).map(name))
  const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
  if (values.length && cats.length) return `${join(values)} by ${join(cats)}`
  return join(values.length ? values : cats)
}

/**
 * Visuals whose container title is not generated: the card names its values with the category label,
 * so a title that is switched on (e.g. by a theme) without a text of its own shows nothing and takes
 * no room — otherwise the field name would appear twice. (`autoTitle` still names the visual for
 * export file names and the Performance analyzer.)
 */
const NO_GENERATED_TITLE = new Set(['cardVisual'])

/** Text displayed by a title without an explicit text. */
export function generatedTitle(visualJson: any, ctx: VisualHostContext | null): string {
  return NO_GENERATED_TITLE.has(visualJson?.visual?.visualType) ? '' : autoTitle(visualJson, ctx)
}

function textStyle(t: TextSpec): CSSProperties {
  return {
    color: t.color,
    background: t.background,
    fontSize: t.fontSizePx,
    fontFamily: t.fontFamily,
    fontWeight: t.fontWeight,
    fontStyle: t.italic ? 'italic' : undefined,
    textDecoration: t.underline ? 'underline' : undefined,
    textAlign: t.align,
    whiteSpace: t.wrap ? 'normal' : 'nowrap',
    overflow: 'hidden',
    textOverflow: t.wrap ? undefined : 'ellipsis',
    // Power BI doesn't set a line height on titles: the font's own (Segoe UI: 1.33)
    lineHeight: 'normal'
  }
}

/**
 * Title block (title, subtitle, divider) laid out the way Power BI does (measured on Desktop renders):
 *  - the title's line box starts at the container's top padding edge; text is inset by the left/right padding, but the
 *    title background spans the full container width and covers the spacing below the text;
 *  - each shown element is followed by its spacing (`titleAreaGaps`); the divider respects the horizontal padding
 *    unless "Ignore padding" is on.
 */
export function TitleBlock({ chrome, title, subTitle }: { chrome: ChromeSpec; title?: string; subTitle?: string }) {
  const hasTitle = !!title
  const hasSub = !!subTitle
  const divider = chrome.divider
  if (!hasTitle && !hasSub && !divider) return null
  const gaps = titleAreaGaps(chrome.spacing, { title: hasTitle, subTitle: hasSub, divider: !!divider })
  const { left, right } = chrome.padding
  const afterText = divider ? gaps.aboveDivider : gaps.aboveContent
  const band = (t: TextSpec, below: number): CSSProperties => ({ ...textStyle(t), padding: `0 ${right}px ${below}px ${left}px` })
  return (
    <>
      {(hasTitle || hasSub) && (
        <div className="wbi-vc-titles" style={{ margin: `0 -${right}px 0 -${left}px` }}>
          {hasTitle ? <div style={band(chrome.title, hasSub ? gaps.titleToSubTitle : afterText)}>{title}</div> : null}
          {hasSub ? <div style={band(chrome.subTitle, afterText)}>{subTitle}</div> : null}
        </div>
      )}
      {divider && (
        <div
          className="wbi-vc-divider"
          style={{
            flex: '0 0 auto',
            borderTop: `${divider.width}px ${divider.style} ${divider.color}`,
            margin: divider.ignorePadding ? `0 -${right}px ${gaps.aboveContent}px -${left}px` : `0 0 ${gaps.aboveContent}px`
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------------------------

export interface VisualContainerProps {
  visual: VisualDocument
  /** rect relative to the parent (page or group) */
  rect: Rect
  z: number
  filters: SQFilter[]
  highlightFilters: SQFilter[]
  /** fill the whole box (focus mode) */
  fill?: boolean
  /** stays fixed during page transitions (core isPinned): no entrance animation */
  pinned?: boolean
}

export const VisualContainer = memo(function VisualContainer(props: VisualContainerProps) {
  const env = useCanvasEnv()
  const theme = useApp((s) => s.theme)
  const { visual, rect } = props
  const type = visualTypeOf(visual)
  const def = getVisual(type)
  const isSlicer = def?.isSlicer ?? isSlicerType(type)
  const hostCtx = useVisualHost(env, visual.name, props.filters, props.highlightFilters, isSlicer)
  // an empty visual of a report with sample data on draws a sample (sampleData.ts); `drawn` is what it draws
  const reportJson = env.report.report
  const sampleText = useApp((s) => sampleDatasetText(s.project?.model.sidecarFiles))
  const sample = useMemo(() => sampleDrawFor(visual.json, def, reportJson, sampleText), [visual.json, def, reportJson, sampleText])
  const drawn: VisualDocument = useMemo(() => (sample ? { ...visual, json: sample.json } : visual), [sample, visual])
  const ctx = useMemo(() => (sample && hostCtx ? sampleContext(hostCtx, sample.engine) : hostCtx), [sample, hostCtx])
  const baseChrome: ChromeSpec = useMemo(
    () => resolveChrome(visual.json, theme, def ? { titleOnByDefault: def.category === 'chart' || def.category === 'map' ? undefined : false, element: def.category === 'element' } : {}),
    [visual.json, theme, def]
  )
  // fx on container colors (title / background / border …) evaluated in the visual's filter context
  const chrome: ChromeSpec = useMemo(() => applyBoundContainerColors(baseChrome, visual.json, ctx), [baseChrome, visual.json, ctx])
  // fx on the visual's other colors that have one value for the whole visual (boundColors.ts)
  const rendered = useMemo(() => resolveBoundColors(drawn, ctx), [drawn, ctx])
  useEffect(() => (env.interactive ? registerLiveContext(env.pageName, visual.name, ctx) : undefined), [env.interactive, env.pageName, visual.name, ctx])
  const [hover, setHoverState] = useState(false)
  // the header can sit outside the container (above it, in the canvas header layer): leaving the container towards the
  // header must not hide it, so hiding is deferred and cancelled when the pointer enters the header
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setHover = useCallback((on: boolean) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
    if (on) setHoverState(true)
    else hideTimer.current = setTimeout(() => setHoverState(false), 120)
  }, [])
  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), [])
  const outerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Lumen gradient fills on whatever the visual draws with a gradient property's fallback color (gradientPaint.ts)
  const paints = useMemo(() => activeGradients(visual.json, theme), [visual.json, theme])
  useLayoutEffect(() => {
    const el = outerRef.current
    if (!el || !paints.size) return
    const painter = new GradientPainter(el, paints)
    painter.start()
    return () => painter.stop()
  }, [paints])
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Lumen visual animations (report/motion/animator.ts): entrance once mounted, morph after data changes
  const engineNow = useApp((s) => s.engine)
  const animOpts: AnimatorOptions | null = useMemo(() => {
    const m = env.motion
    if (!m) return null
    const family = motionFamily(type)
    const own = visualMotion(visual.json)
    if (family === 'still' && !own.entrance) return null
    if (own.entrance === 'none' || props.pinned) return null
    return { duration: m.report.duration, family: family === 'marks' ? 'marks' : 'fade', entrance: own.entrance ?? 'auto', delay: entranceDelay(m.report, own, m.order.get(visual.name) ?? 0) }
  }, [env.motion, type, visual.json, visual.name, props.pinned])
  const animator = useRef<VisualAnimator | null>(null)
  const animated = !!animOpts
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el || !animOpts) return
    const a = new VisualAnimator(el, animOpts)
    animator.current = a
    a.arm('enter')
    return () => {
      a.dispose()
      animator.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated])
  useEffect(() => {
    if (animOpts) animator.current?.setOptions(animOpts)
  }, [animOpts])
  useEffect(() => onReplayMotion((v) => (!v || v === visual.name ? animator.current?.replay() : undefined)), [visual.name])
  const dataSeen = useRef(false)
  useLayoutEffect(() => {
    if (!dataSeen.current) {
      dataSeen.current = true
      return
    }
    animator.current?.arm('update')
  }, [props.filters, props.highlightFilters, visual.json?.visual?.query, engineNow])
  const lastSize = useRef<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    if (lastSize.current && size && (lastSize.current.w !== size.w || lastSize.current.h !== size.h)) animator.current?.pause()
    lastSize.current = size
  }, [size])

  // readiness: first render with a measured size (or a terminal state) counts as done
  const reported = useRef(false)
  const canRenderVisual = !!def && !!ctx && !!size && size.w > 0 && size.h > 0
  const reportDoneRef = useRef(env.reportDone)
  reportDoneRef.current = env.reportDone
  // visuals that draw asynchronously (code visual frames) hold readiness until their output is on screen
  const readyHolds = useRef(0)
  const pendingDone = useRef<(() => void) | null>(null)
  const readiness = useMemo<VisualReadiness>(
    () => ({
      hold() {
        readyHolds.current++
        let released = false
        return () => {
          if (released) return
          released = true
          readyHolds.current--
          if (readyHolds.current === 0 && pendingDone.current) {
            const f = pendingDone.current
            pendingDone.current = null
            f()
          }
        }
      }
    }),
    []
  )
  useEffect(() => {
    if (reported.current) return
    if (canRenderVisual || !def || !ctx || (size && (size.w <= 0 || size.h <= 0))) {
      reported.current = true
      // give the visual a frame to paint (charts often lay out in effects); setTimeout fallback for hidden windows
      let fired = false
      const fire = () => {
        if (fired) return
        fired = true
        if (readyHolds.current > 0) {
          pendingDone.current = () => reportDoneRef.current(visual.name)
          return
        }
        reportDoneRef.current(visual.name)
      }
      requestAnimationFrame(() => setTimeout(fire, 0))
      setTimeout(fire, 250)
    }
  })

  // Performance analyzer (report/perf.ts): one entry per (re)load of this visual while recording
  useVisualPerf(ctx, env.interactive && canRenderVisual, visual.json?.visual, () => ({
    visual: visual.name,
    title: (chrome.title.text ?? autoTitle(drawn.json, ctx)) || def?.displayName || type,
    type,
    page: env.pageName
  }))

  const titleText = chrome.title.show ? (chrome.title.boundExpr ? evalBoundText(chrome.title.boundExpr, ctx) : (chrome.title.text ?? generatedTitle(drawn.json, ctx))) : undefined
  const subText = chrome.subTitle.show ? (chrome.subTitle.boundExpr ? evalBoundText(chrome.subTitle.boundExpr, ctx) : chrome.subTitle.text) : undefined
  const engineError = useApp((s) => s.engineError)
  // fields that no longer resolve against the model → PBI's field error state
  const engineForCheck = useApp((s) => s.engine)
  const broken = useMemo(() => {
    if (!engineForCheck || !def) return NO_BROKEN
    const b = brokenFields(visual.json, engineForCheck, reportMeasureKeys(env.report.reportExtensions))
    return b.length ? b : NO_BROKEN
  }, [visual.json, engineForCheck, def, env.report.reportExtensions])
  const [brokenDetails, setBrokenDetails] = useState(false)

  const outer: CSSProperties = props.fill
    ? { position: 'absolute', inset: 0 }
    : { position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: props.z }
  const spotDim = env.spotlight && env.spotlight !== visual.name
  // Lumen-only effects (gradient, frosted glass, glow, rotation) from the `Lumen_Style` annotation
  const fx = useMemo(() => {
    const s = lumenStyleOf(visual.json)
    return s ? lumenStyleCss(s, chrome.background) : undefined
  }, [visual.json, chrome.background])
  const shadows = [chrome.shadow?.css, fx?.glow].filter(Boolean).join(', ')
  const box: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: fx?.background ?? chrome.background,
    backdropFilter: fx?.backdropFilter,
    transform: fx?.transform,
    borderRadius: chrome.radius || undefined,
    border: borderCss(chrome.border),
    boxShadow: shadows || undefined,
    padding: `${chrome.padding.top}px ${chrome.padding.right}px ${chrome.padding.bottom}px ${chrome.padding.left}px`,
    display: 'flex',
    flexDirection: 'column',
    overflow: chrome.radius ? 'hidden' : undefined,
    opacity: spotDim ? 0.15 : 1,
    transition: 'opacity 120ms'
  }
  const borderLayer = gradientBorderLayer(chrome.border, chrome.radius, 0, { transform: fx?.transform, opacity: box.opacity, transition: box.transition })

  const link = chrome.link
  const linkActive = !!link && (env.mode === 'view' || !env.editing)
  const runLink = () => {
    if (!link) return
    switch (link.type) {
      case 'Back':
        goBack()
        break
      case 'Bookmark':
        if (link.bookmark) applyBookmark(link.bookmark)
        break
      case 'PageNavigation':
        if (link.navigationSection) navigatePage(link.navigationSection)
        break
      case 'Drillthrough': {
        const sel = useInteraction.getState().crossFilter[env.pageName]
        if (link.drillthroughSection && sel?.identities[0]) drillthrough(env.pageName, link.drillthroughSection, sel.identities[0], [])
        break
      }
      case 'WebUrl':
        if (link.webUrl) openUrl(link.webUrl)
        break
      case 'ClearAllSlicers':
        clearAllSlicers(env.pageName)
        break
    }
  }

  return (
    <div
      ref={outerRef}
      className="wbi-vc"
      data-visual={visual.name}
      data-type={type}
      data-pinned={props.pinned || undefined}
      data-sample={sample?.source}
      style={outer}
      aria-label={chrome.altText ?? titleText ?? type}
      title={linkActive && link?.tooltip ? link.tooltip : undefined}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={env.editing ? (e) => env.onContainerPointerDown?.(e, visual.name) : undefined}
      onClick={(e) => {
        if (!link) return
        // PBI Desktop: Ctrl+click follows a link while editing; plain click in reading view
        if (env.editing && !(e.ctrlKey || e.metaKey)) return
        runLink()
      }}
      onContextMenu={(e) => {
        if (!env.interactive) return
        e.preventDefault()
        if (Date.now() - lastMenuRequest < 300) return
        useInteraction.getState().setContextMenu({ page: env.pageName, visual: visual.name, req: { x: e.clientX, y: e.clientY } })
      }}
    >
      <div className="wbi-vc-box" style={{ ...box, cursor: linkActive ? 'pointer' : undefined }}>
        <TitleBlock chrome={chrome} title={titleText || undefined} subTitle={subText || undefined} />
        <div ref={contentRef} className="wbi-vc-content">
          {!def ? (
            <UnknownVisual visualType={type} report={env.report} />
          ) : !ctx ? (
            <VisualMessage title="Can't display this visual" details={engineError ? `The data model couldn't be loaded:\n${engineError}` : 'The data model is still loading.'} />
          ) : broken.length ? (
            <VisualMessage
              title="Something's wrong with one or more fields"
              detailsOpen={brokenDetails}
              onToggleDetails={() => setBrokenDetails((o) => !o)}
              details={`These fields can't be found in the model (they may have been renamed or deleted):\n${broken.map((b) => `  • ${b.label} (${b.role})`).join('\n')}`}
              action={
                env.editing
                  ? {
                      label: 'Fix this',
                      onClick: () =>
                        useApp.getState().mutateReport('Remove missing fields', (r) => {
                          const v = r.pages.find((p) => p.name === env.pageName)?.visuals.find((x) => x.name === visual.name)
                          if (v) removeBrokenFields(v.json, broken)
                        })
                    }
                  : undefined
              }
            />
          ) : canRenderVisual ? (
            <VisualErrorBoundary visualType={type} resetKey={visual.json}>
              <PerfMark ctx={ctx} edge="start" />
              <VisualReadyContext.Provider value={readiness}>
                <VisualContent def={def} visual={rendered} pageName={env.pageName} width={size!.w} height={size!.h} ctx={ctx} />
              </VisualReadyContext.Provider>
              <PerfMark ctx={ctx} edge="end" />
            </VisualErrorBoundary>
          ) : null}
        </div>
        {sample && env.editing && hover && (
          <div className="wbi-vc-sample" title="Sample data: this visual has no fields yet. Drop fields in to show real data, or turn sample data off on the View tab.">
            Sample data
          </div>
        )}
      </div>
      {borderLayer && <div className="wbi-vc-border" aria-hidden style={borderLayer} />}
      {env.headers && hover && chrome.header.show && def && ctx && (
        <PlacedHeader layer={env.headerLayer} anchor={outerRef} scale={env.scale} rect={rect} onHover={setHover}>
          <VisualHeader visual={visual} def={def} ctx={ctx} chrome={chrome} />
        </PlacedHeader>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------------------------
// Visual header (icons on hover)
// ---------------------------------------------------------------------------------------------

/** Height of the header strip in page px (24px buttons + 1px padding + border). */
const HEADER_H = 28

/**
 * Places the hover header like PBI Desktop: right-aligned just ABOVE the visual's top edge when there is room on the
 * page, else inside the top-right corner. Rendered into the canvas header layer (above all visuals) so it never hides
 * the visual's own top-right controls (slicer eraser, matrix expand icons…) and isn't covered by visuals stacked
 * above. Without a layer (mobile / focus / print canvases) it falls back to the in-container corner.
 */
function PlacedHeader(p: { layer?: HTMLElement | null; anchor: React.RefObject<HTMLDivElement | null>; scale: number; rect: Rect; onHover(on: boolean): void; children: ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; inside: boolean } | null>(null)
  const { layer, anchor, scale } = p
  useLayoutEffect(() => {
    const el = anchor.current
    if (!layer || !el) return
    const lr = layer.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const k = scale || 1
    const left = (er.left - lr.left) / k
    const top = (er.top - lr.top) / k
    const width = er.width / k
    const inside = top < HEADER_H
    setPos({ left, top: inside ? top + 2 : top - HEADER_H, width, inside })
  }, [layer, anchor, scale, p.rect.x, p.rect.y, p.rect.width, p.rect.height])
  if (!layer) return <>{p.children}</>
  if (!pos) return null
  return createPortal(
    <div
      className={'wbi-vh-slot' + (pos.inside ? ' inside' : '')}
      style={{ left: pos.left, top: pos.top, width: pos.width, height: HEADER_H }}
      onPointerEnter={() => p.onHover(true)}
      onPointerLeave={() => p.onHover(false)}
    >
      {p.children}
    </div>,
    layer
  )
}

function VisualHeader({ visual, def, ctx, chrome }: { visual: VisualDocument; def: VisualDefinition; ctx: VisualHostContext; chrome: ChromeSpec }) {
  const env = useCanvasEnv()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const h = chrome.header
  const iconStyle: CSSProperties = { color: h.foreground }
  const drill = ctx.drill
  // matrix: PBI's "Drill on [Rows | Columns]" when there is a hierarchy on Columns
  const canDrillColumns = visualTypeOf(visual) === 'pivotTable' && (visual.json?.visual?.query?.queryState?.Columns?.projections?.length ?? 0) > 1
  const onColumns = canDrillColumns && drill.target === 'columns'
  const canDrillUp = onColumns ? (drill.columnLevel ?? 0) > 0 || drill.path.length > 0 : drill.level > 0 || drill.path.length > 0
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const btn = (title: string, icon: ReactNode, onClick: () => void, active = false, disabled = false) => (
    <button
      className={'wbi-vh-btn' + (active ? ' active' : '')}
      title={title}
      aria-label={title}
      disabled={disabled}
      style={iconStyle}
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {icon}
    </button>
  )
  const summary = filtersOpen ? describeFilters(ctx) : []
  return (
    <div className="wbi-vh" data-visual-header={visual.name} style={{ background: h.background ?? 'rgba(255,255,255,0.95)', borderColor: h.border }} onPointerDown={stop}>
      {def.supportsDrill && (
        <>
          {canDrillColumns && h.showDrillRoleSelector && (
            <select
              className="wbi-vh-drillon"
              title="Drill on"
              aria-label="Drill on"
              value={onColumns ? 'columns' : 'rows'}
              style={iconStyle}
              onPointerDown={stop}
              onClick={stop}
              onChange={(e) => setDrillSafe(env.pageName, visual.name, { ...drill, target: e.target.value === 'columns' ? 'columns' : 'rows' })}
            >
              <option value="rows">Rows</option>
              <option value="columns">Columns</option>
            </select>
          )}
          {h.showDrillUp && btn('Drill up', <ArrowUpRegular />, () => {
            const path = drill.path.slice(0, -1)
            if (onColumns) setDrillSafe(env.pageName, visual.name, { ...drill, path, columnLevel: Math.max(0, (drill.columnLevel ?? 0) - 1) })
            else setDrillSafe(env.pageName, visual.name, { ...drill, path, level: Math.max(0, drill.level - 1) })
          }, false, !canDrillUp)}
          {h.showDrill && btn(drill.drillMode ? 'Drill down is on' : 'Click to turn on Drill down', <ArrowDownRegular />, () => setDrillSafe(env.pageName, visual.name, { ...drill, drillMode: !drill.drillMode }), !!drill.drillMode)}
          {h.showDrillLevel && btn('Go to the next level in the hierarchy', <ArrowTurnDownRightRegular />, () =>
            onColumns
              ? setDrillSafe(env.pageName, visual.name, { ...drill, columnLevel: (drill.columnLevel ?? 0) + 1, columnExpandedLevel: undefined })
              : setDrillSafe(env.pageName, visual.name, { ...drill, level: drill.level + 1, expandedLevel: undefined })
          )}
          {h.showDrillExpand && btn('Expand all down one level in the hierarchy', <BranchForkRegular />, () =>
            onColumns
              ? setDrillSafe(env.pageName, visual.name, { ...drill, columnExpandedLevel: (drill.columnExpandedLevel ?? drill.columnLevel ?? 0) + 1 })
              : setDrillSafe(env.pageName, visual.name, { ...drill, expandedLevel: (drill.expandedLevel ?? drill.level) + 1 })
          )}
        </>
      )}
      {h.helpTooltip && (
        <span className="wbi-vh-filterwrap">
          {btn(h.helpTooltip.title ?? 'Help', <QuestionCircleRegular />, () => setHelpOpen((o) => !o), helpOpen)}
          {helpOpen && (
            <div className="wbi-vh-filters wbi-vh-help" style={{ color: h.helpTooltip.color, background: h.helpTooltip.background }} onPointerDown={stop}>
              {h.helpTooltip.title && <div className="wbi-vh-filters-title">{h.helpTooltip.title}</div>}
              <div className="wbi-vh-help-text">{h.helpTooltip.text}</div>
            </div>
          )}
        </span>
      )}
      {h.showFilter && (
        <span className="wbi-vh-filterwrap">
          {btn('Filters and slicers affecting this visual', <FilterRegular />, () => setFiltersOpen((o) => !o), filtersOpen)}
          {filtersOpen && (
            <div className="wbi-vh-filters" onPointerDown={stop}>
              <div className="wbi-vh-filters-title">Filters and slicers affecting this visual</div>
              {summary.length === 0 ? <div className="wbi-vh-filters-empty">No filters are applied</div> : null}
              {summary.map((s, i) => (
                <div key={i} className="wbi-vh-filter">
                  <div className="wbi-vh-filter-field">{s.field}</div>
                  <div className="wbi-vh-filter-desc">{s.description}</div>
                </div>
              ))}
            </div>
          )}
        </span>
      )}
      {h.showFocus && btn('Focus mode', <ArrowMaximizeRegular />, () => useInteraction.getState().setFocus({ page: env.pageName, visual: visual.name, mode: 'focus' }))}
      {h.showMore &&
        btn('More options', <MoreHorizontalRegular />, () => {
          const el = document.querySelector(`.wbi-vh[data-visual-header="${CSS.escape(visual.name)}"]`)
          const r = el?.getBoundingClientRect()
          useInteraction.getState().setContextMenu({ page: env.pageName, visual: visual.name, req: { x: r ? r.right - 8 : 0, y: r ? r.bottom : 0 } })
        })}
    </div>
  )
}

function setDrillSafe(page: string, visual: string, state: Parameters<typeof setDrill>[2]) {
  setDrill(page, visual, state)
}

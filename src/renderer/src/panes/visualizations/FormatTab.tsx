/**
 * Format tab of the Visualizations pane.
 *  - one visual selected: Visual / General sub-tabs generated from the VisualDefinition's
 *    formatCards plus the built-in container cards (containerCards.ts); searchable.
 *  - no visual selected: page formatting (page information, canvas settings, canvas background,
 *    wallpaper, filter pane, filter cards) written to page.json.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { makePropContext, rawProp, type Selector } from '@core/report/props'
import { readFills } from '@core/report/gradientFill'
import type { PageDocument, VisualDocument } from '@core/report/types'
import type { ResolvedTheme } from '@core/report/theme'
import type { FormatCardDef, FormatPropDef } from '../../visuals/contract'
import { useApp } from '../../state/store'
import { useMobileLayout } from '../../report/mobile/state'
import { mobileFormatVisual, mobileOverrides, mobileTarget, resetMobileFormatting } from '../../report/mobile/format'
import { mobileVisualJson } from '../../report/mobile/layout'
import { useShell } from '../../app/shellState'
import { absoluteRect, findPage, findVisual, visualTypeOf, type Rect } from '../../report/pbir'
import * as editOps from '../../report/editOps'
import { getVisual } from '../../visuals/registry'
import { CollapsibleCard, Dropdown, Pivot, SearchBox, Toggle } from '../../app/ui'
import { pageBag, visualBag } from './objects'
import { ANALYTICS_OBJECTS, CONTAINER_CARDS, type GroupedCard } from './containerCards'
import { FormatCardView, PropRow, PropRows, TextInput, matchesSearch, type BagTarget } from './PropEditor'
import { SpinField } from './controls'
import { rendererDefault } from './effective'
import { roleProjections, isValueProjection, nativeName } from './wells'
import { CfDialogHost } from './cf/CfDialog'
import { CellElementsCard } from './cf/FxControls'
import { LevelSubtotalsCard, TableLayoutCard } from '../../visuals/tables/LayoutCard'
import { PageMotionCard, VisualMotionCard } from './MotionCards'

export function visualTarget(pageName: string, visual: VisualDocument, container: boolean, theme: ResolvedTheme): BagTarget {
  const pc = makePropContext(visual.json, theme)
  return {
    bag: visualBag(visual.json, container),
    locate: (r) => visualBag(findVisual(findPage(r, pageName), visual.name)?.json, container, true),
    resolveRaw: (object, prop, sel) => rawProp(pc, object, prop, sel),
    // what the renderer uses when nothing is set: shown instead of an empty control (effective.ts)
    defaults: (object, prop, def) => rendererDefault(object, prop, theme, visual.json, container, def),
    theme,
    label: 'Format visual',
    cf: { pageName, visualName: visual.name, visualType: visualTypeOf(visual), container },
    fill: { visualType: visualTypeOf(visual), container, pc, locateOwner: (r) => findVisual(findPage(r, pageName), visual.name)?.json }
  }
}

export function pageTarget(page: PageDocument, theme: ResolvedTheme): BagTarget {
  const pc = { visualType: 'page', objects: page.json?.objects, theme, fills: readFills(page.json) }
  return {
    bag: pageBag(page.json),
    locate: (r) => pageBag(findPage(r, page.name)?.json, true),
    resolveRaw: (object, prop, sel) => rawProp(pc, object, prop, sel),
    theme,
    label: 'Format page',
    fill: { visualType: 'page', container: false, pc, locateOwner: (r) => findPage(r, page.name)?.json }
  }
}

/** Series (measure projections) of a visual for per-series selectors. */
function seriesOf(visualJson: any): Array<{ queryRef: string; label: string }> {
  const qs = visualJson?.visual?.query?.queryState ?? {}
  const out: Array<{ queryRef: string; label: string }> = []
  for (const role of Object.keys(qs)) {
    if (role === 'Tooltips') continue
    for (const p of roleProjections(visualJson, role)) if (isValueProjection(p.field) && !out.some((o) => o.queryRef === p.queryRef)) out.push({ queryRef: p.queryRef, label: p.displayName ?? p.nativeQueryRef ?? nativeName(p.field) })
  }
  return out
}

export function FormatTab() {
  const project = useApp((s) => s.project)
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => s.selectedVisuals)
  const theme = useApp((s) => s.theme)
  const page = findPage(project?.report, activePage)
  const visual = selected.length === 1 ? findVisual(page, selected[0]) : undefined
  // View ▸ Mobile layout: the pane follows the phone-canvas selection and edits mobile-only formatting
  const mobileOn = useMobileLayout((s) => s.on)
  const mobileSelected = useMobileLayout((s) => s.selected)
  if (!page) return <div className="wbi-pane__empty">Open or create a report to format it.</div>
  if (mobileOn) {
    const mv = mobileFormatVisual(page, mobileSelected)
    if (!mv) return <div className="wbi-pane__empty">Select a visual on the phone canvas to format it. Formatting changes made in the mobile layout apply to the phone layout only.</div>
    return <VisualFormat key={`m:${mv.name}`} page={page} visual={mv} theme={theme} mobile />
  }
  if (selected.length > 1) return <div className="wbi-pane__empty">Select a single visual to format it.</div>
  if (!visual) return <PageFormat page={page} theme={theme} />
  return <VisualFormat page={page} visual={visual} theme={theme} />
}

function VisualFormat({ page, visual, theme, mobile = false }: { page: PageDocument; visual: VisualDocument; theme: ResolvedTheme; mobile?: boolean }) {
  const tab = useShell((s) => s.formatTab)
  const setTab = useShell((s) => s.setFormatTab)
  const [search, setSearch] = useState('')
  const type = visualTypeOf(visual)
  const def = getVisual(type)
  const isGroup = type === 'group'
  const series = useMemo(() => seriesOf(visual.json), [visual.json])
  const own = ((def?.formatCardsFor ? def.formatCardsFor(visual.json) : def?.formatCards) ?? []).filter((c) => !ANALYTICS_OBJECTS.has(c.object))
  const visualCards = own.filter((c) => c.tab !== 'general' && !c.container)
  const builtinObjects = new Set(CONTAINER_CARDS.map((c) => c.object))
  const extraGeneral = own.filter((c) => (c.tab === 'general' || c.container) && !(c.container && builtinObjects.has(c.object)))
  // mobile formatting shows the same effective defaults as desktop (the phone canvas uses the same renderers)
  // (defaults probed on the merged phone formatting, computed once per render)
  const mobileJson = mobile ? mobileVisualJson(visual) : undefined
  const mobileWithDefaults = (container: boolean): BagTarget => ({ ...mobileTarget(page.name, visual, container, theme), defaults: (object, prop, def) => rendererDefault(object, prop, theme, mobileJson, container, def) })
  const vt = mobile ? mobileWithDefaults(false) : visualTarget(page.name, visual, false, theme)
  const ct = mobile ? mobileWithDefaults(true) : visualTarget(page.name, visual, true, theme)
  const overrides = mobile ? mobileOverrides(visual) : []

  const effectiveTab = isGroup ? 'general' : tab
  return (
    <div className="wbi-fmt">
 {mobile && (
        <div className="wbi-fmt__mobile">
          <span>Mobile formatting: changes apply to the phone layout only.</span>
          {overrides.length > 0 && (
            <button
              type="button"
              className="wbi-link"
              title={`Overridden on mobile: ${overrides.map((o) => o.object).join(', ')}`}
              onClick={() =>
                useApp.getState().mutateReport('Reset mobile formatting', (r) => {
                  const v = findVisual(findPage(r, page.name), visual.name)
                  if (v) resetMobileFormatting(v)
                })
              }
            >
              Reset to desktop formatting
            </button>
          )}
        </div>
      )}
      {!isGroup && <Pivot className="wbi-fmt__pivot" tabs={[{ key: 'visual', label: 'Visual' }, { key: 'general', label: 'General' }]} value={tab} onChange={setTab} />}
      <div className="wbi-fmt__search">
        <SearchBox value={search} onChange={setSearch} size="small" />
      </div>
      <div className="wbi-fmt__cards">
        {effectiveTab === 'visual' ? (
          visualCards.length ? (
            <>
              {(type === 'tableEx' || type === 'pivotTable') && <TableLayoutCard visual={visual} target={vt} search={search} />}
              {visualCards.map((c) => (
                <FormatCardView key={c.object + c.displayName} card={c} target={c.container ? ct : vt} search={search} series={series} />
              ))}
              {type === 'pivotTable' && <LevelSubtotalsCard visual={visual} target={vt} search={search} />}
              {!mobile && (type === 'tableEx' || type === 'pivotTable') && <CellElementsCard page={page} visual={visual} search={search} />}
            </>
          ) : (
            <div className="wbi-pane__empty">{def ? 'This visual has no visual-specific formatting options.' : `No formatting options are available for "${type}" yet. Use the General tab for title, background and border.`}</div>
          )
        ) : (
          <>
            {/* size / position on the phone are edited on the phone canvas */}
            {!mobile && <PropertiesCard page={page} visual={visual} vt={vt} ct={ct} search={search} extra={extraGeneral.filter((c) => !c.container && c.object === 'general')} />}
            <GroupedCards cards={CONTAINER_CARDS} target={ct} search={search} />
            {!mobile && <VisualMotionCard page={page} visual={visual} search={search} group={isGroup} />}
            {extraGeneral
              .filter((c) => !(c.object === 'general' && !c.container))
              .map((c) => (
                <FormatCardView key={'x' + c.object + c.displayName} card={c} target={c.container ? ct : vt} search={search} series={series} />
              ))}
          </>
        )}
      </div>
      <CfDialogHost />
    </div>
  )
}

/** Renders cards; consecutive cards sharing `group` nest under one top-level card. */
function GroupedCards({ cards, target, search }: { cards: GroupedCard[]; target: BagTarget; search: string }) {
  const groups: Array<{ name?: string; cards: GroupedCard[] }> = []
  for (const c of cards) {
    const last = groups[groups.length - 1]
    if (c.group && last?.name === c.group) last.cards.push(c)
    else groups.push({ name: c.group, cards: [c] })
  }
  return (
    <>
      {groups.map((g, i) => {
        if (!g.name || g.cards.length === 1) return g.cards.map((c) => <FormatCardView key={`${i}${c.displayName}`} card={c} target={target} search={search} />)
        const anyMatch = matchesSearch(search, g.name) || g.cards.some((c) => matchesSearch(search, c.displayName) || c.properties.some((p) => matchesSearch(search, p.displayName)))
        if (!anyMatch) return null
        return (
          // remount when a search starts / ends so the group opens on its matches (and closes again)
          <CollapsibleCard key={`${g.name}${search ? ':q' : ''}`} title={g.name} defaultOpen={!!search}>
            <div className="wbi-fmt__sub">
              {g.cards.map((c) => (
                <FormatCardView key={c.displayName} card={c} target={target} search={matchesSearch(search, g.name) ? '' : search} level={2} />
              ))}
            </div>
          </CollapsibleCard>
        )
      })}
    </>
  )
}

function PropertiesCard({ page, visual, vt, ct, search, extra }: { page: PageDocument; visual: VisualDocument; vt: BagTarget; ct: BagTarget; search: string; extra: FormatCardDef[] }) {
  const mutate = useApp((s) => s.mutateReport)
  if (!matchesSearch(search, 'Properties', 'Size', 'Height', 'Width', 'Position', 'Padding', 'Advanced options', 'Responsive', 'Maintain layer order', 'Lock aspect')) return null
  const lock = !!ct.resolveRaw('lockAspect', 'show') && ct.resolveRaw('lockAspect', 'show')?.expr?.Literal?.Value === 'true'
  // values shown/edited relative to the page (group children are stored relative to their group in PBIR)
  const abs = absoluteRect(page, visual)
  const setPos = (key: 'x' | 'y' | 'width' | 'height', v: number | undefined) => {
    if (v === undefined || !Number.isFinite(v)) return
    const val = Math.round(v * 100) / 100
    const patch: Partial<Rect> = { [key]: key === 'width' || key === 'height' ? Math.max(10, val) : val }
    // Lock aspect ratio: changing one dimension changes the other (PBI)
    if (lock && abs.width > 0 && abs.height > 0) {
      if (key === 'width') patch.height = Math.max(10, Math.round(((patch.width as number) * abs.height * 100) / abs.width) / 100)
      if (key === 'height') patch.width = Math.max(10, Math.round(((patch.height as number) * abs.width * 100) / abs.height) / 100)
    }
    mutate(
      key === 'x' || key === 'y' ? 'Move visual' : 'Resize visual',
      (r) => {
        const p = findPage(r, page.name)
        if (p) editOps.setAbsoluteRects(p, { [visual.name]: patch })
      },
      { coalesce: `fmtpos:${page.name}:${visual.name}:${key}` }
    )
  }
  const num = (name: string, displayName: string): FormatPropDef => ({ name, displayName, type: 'integer', min: 0, max: 100, default: name === 'top' || name === 'left' || name === 'right' || name === 'bottom' ? 5 : 0 })
  return (
    <CollapsibleCard key={search ? 'q' : 'n'} title="Properties" defaultOpen={!!search}>
      <div className="wbi-fmt__sub">
        <CollapsibleCard title="Size" level={2} defaultOpen>
          <div className="wbi-fmt__pair">
            <Labeled label="Height">
              <SpinField label="Height" value={round2(abs.height)} min={10} onChange={(v) => setPos('height', v)} />
            </Labeled>
            <Labeled label="Width">
              <SpinField label="Width" value={round2(abs.width)} min={10} onChange={(v) => setPos('width', v)} />
            </Labeled>
          </div>
          <div className="wbi-fmt__row is-inline">
            <div className="wbi-fmt__label">
              <span>Lock aspect ratio</span>
            </div>
            <Toggle size="small" on={lock} onChange={(on) => mutate('Format visual', (r) => setLockAspect(r, page.name, visual.name, on))} />
          </div>
        </CollapsibleCard>
        <CollapsibleCard title="Position" level={2} defaultOpen>
          <div className="wbi-fmt__pair">
            <Labeled label="Horizontal">
              <SpinField label="Horizontal" value={round2(abs.x)} onChange={(v) => setPos('x', v)} />
            </Labeled>
            <Labeled label="Vertical">
              <SpinField label="Vertical" value={round2(abs.y)} onChange={(v) => setPos('y', v)} />
            </Labeled>
          </div>
        </CollapsibleCard>
        <CollapsibleCard title="Padding" level={2}>
          {['top', 'bottom', 'left', 'right'].map((p) => (
            <PropRow key={p} def={num(p, p[0].toUpperCase() + p.slice(1))} object="padding" target={ct} />
          ))}
        </CollapsibleCard>
        <CollapsibleCard title="Advanced options" level={2}>
          <PropRow def={{ name: 'responsive', displayName: 'Responsive', type: 'bool', default: true }} object="general" target={vt} />
          <PropRow def={{ name: 'keepLayerOrder', displayName: 'Maintain layer order', type: 'bool', default: false }} object="general" target={ct} />
          {extra.flatMap((c) => c.properties.filter((p) => p.name !== 'responsive').map((p) => <PropRow key={c.object + p.name} def={p} object={c.object} target={vt} />))}
        </CollapsibleCard>
      </div>
    </CollapsibleCard>
  )
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** A control with its label above (the two-column Size / Position pairs). */
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wbi-fmt__row">
      <div className="wbi-fmt__label">
        <span title={label}>{label}</span>
      </div>
      {children}
    </div>
  )
}

function setLockAspect(r: any, pageName: string, visualName: string, on: boolean): void {
  const vis = findVisual(findPage(r, pageName), visualName)
  const v = vis?.json?.visual ?? vis?.json?.visualGroup
  if (!v) return
  v.visualContainerObjects ??= {}
  if (on) v.visualContainerObjects.lockAspect = [{ properties: { show: { expr: { Literal: { Value: 'true' } } } } }]
  else delete v.visualContainerObjects.lockAspect
}

// ---------------------------------------------------------------------------------------------
// Page formatting
// ---------------------------------------------------------------------------------------------

const CANVAS_TYPES: Array<{ value: string; label: string; w?: number; h?: number }> = [
  { value: '16:9', label: '16:9', w: 1280, h: 720 },
  { value: '4:3', label: '4:3', w: 960, h: 720 },
  { value: 'Letter', label: 'Letter', w: 816, h: 1056 },
  { value: 'Tooltip', label: 'Tooltip', w: 320, h: 240 },
  { value: 'Custom', label: 'Custom' }
]

const PAGE_CARDS: FormatCardDef[] = [
  {
    object: 'background',
    displayName: 'Canvas background',
    properties: [
      { name: 'color', displayName: 'Color', type: 'color', default: '#FFFFFF' },
      { name: 'image', displayName: 'Image', type: 'image' },
      { name: 'scaling', displayName: 'Image fit', type: 'enum', options: [{ value: 'Normal', label: 'Normal' }, { value: 'Fit', label: 'Fit' }, { value: 'Fill', label: 'Fill' }], default: 'Fit' },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 100 }
    ]
  },
  {
    object: 'outspace',
    displayName: 'Wallpaper',
    properties: [
      { name: 'color', displayName: 'Color', type: 'color', default: '#FFFFFF' },
      { name: 'image', displayName: 'Image', type: 'image' },
      { name: 'scaling', displayName: 'Image fit', type: 'enum', options: [{ value: 'Normal', label: 'Normal' }, { value: 'Fit', label: 'Fit' }, { value: 'Fill', label: 'Fill' }], default: 'Fit' },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
    ]
  },
  {
    object: 'outspacePane',
    displayName: 'Filter pane',
    properties: [
      { name: 'backgroundColor', displayName: 'Background color', type: 'color', default: '#FFFFFF' },
      { name: 'transparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 0 },
      { name: 'foregroundColor', displayName: 'Font and icon color', type: 'color', default: '#252423' },
      { name: 'titleSize', displayName: 'Title text size', type: 'fontSize', min: 8, max: 40 },
      { name: 'headerSize', displayName: 'Header text size', type: 'fontSize', min: 8, max: 40 },
      { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
      { name: 'border', displayName: 'Border', type: 'bool', default: true },
      { name: 'borderColor', displayName: 'Border color', type: 'color', default: '#E1DFDD' },
      { name: 'inputBoxColor', displayName: 'Input box color', type: 'color' },
      { name: 'checkboxAndApplyColor', displayName: 'Checkbox and apply button color', type: 'color' },
      { name: 'width', displayName: 'Width', type: 'integer', min: 150, max: 500 }
    ]
  }
]

const FILTER_CARD_PROPS: FormatPropDef[] = [
  { name: 'backgroundColor', displayName: 'Background color', type: 'color' },
  { name: 'transparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 0 },
  { name: 'border', displayName: 'Border', type: 'bool', default: true },
  { name: 'borderColor', displayName: 'Border color', type: 'color' },
  { name: 'foregroundColor', displayName: 'Font and icon color', type: 'color' },
  { name: 'textSize', displayName: 'Text size', type: 'fontSize', min: 8, max: 40 },
  { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
  { name: 'inputBoxColor', displayName: 'Input box color', type: 'color' }
]

function PageFormat({ page, theme }: { page: PageDocument; theme: ResolvedTheme }) {
  const mutate = useApp((s) => s.mutateReport)
  const [search, setSearch] = useState('')
  const [cardState, setCardState] = useState<'Available' | 'Applied'>('Available')
  const target = pageTarget(page, theme)
  const j = page.json ?? {}
  const w = Number(j.width ?? 1280)
  const h = Number(j.height ?? 720)
  const canvasType = CANVAS_TYPES.find((t) => t.w === w && t.h === h)?.value ?? 'Custom'
  const isTooltip = j.pageBinding?.type === 'Tooltip' || j.type === 'Tooltip'
  const vAlign = (() => {
    const raw = target.resolveRaw('displayArea', 'verticalAlignment')
    const v = raw?.expr?.Literal?.Value
    return typeof v === 'string' ? v.replace(/'/g, '') : 'Top'
  })()
  const edit = (label: string, fn: (pj: any) => void) =>
    mutate(label, (r) => {
      const p = findPage(r, page.name)
      if (p) fn(p.json)
    })
  const filterSel: Selector = { id: cardState }

  return (
    <div className="wbi-fmt">
      <div className="wbi-fmt__search">
        <SearchBox value={search} onChange={setSearch} size="small" />
      </div>
      <div className="wbi-fmt__cards">
        {matchesSearch(search, 'Page information', 'Name', 'Allow use as tooltip') && (
          <CollapsibleCard title="Page information" defaultOpen>
            <div className="wbi-fmt__row">
              <div className="wbi-fmt__label">
                <span>Name</span>
              </div>
              <TextInput value={j.displayName ?? page.name} onCommit={(v) => v.trim() && edit('Rename page', (pj) => (pj.displayName = v.trim()))} />
            </div>
            <div className="wbi-fmt__row is-inline">
              <div className="wbi-fmt__label">
                <span>Allow use as tooltip</span>
              </div>
              <Toggle
                size="small"
                on={isTooltip}
                onChange={(on) =>
                  edit('Page type', (pj) => {
                    if (on) {
                      pj.pageBinding = { name: pj.pageBinding?.name ?? randomName(), type: 'Tooltip', ...(pj.pageBinding?.parameters ? { parameters: pj.pageBinding.parameters } : {}) }
                      if (pj.width === 1280 && pj.height === 720) {
                        pj.width = 320
                        pj.height = 240
                      }
                    } else if (pj.pageBinding?.type === 'Tooltip') {
                      delete pj.pageBinding
                      if (pj.type === 'Tooltip') delete pj.type
                    }
                  })
                }
              />
            </div>
          </CollapsibleCard>
        )}
        {matchesSearch(search, 'Canvas settings', 'Type', 'Height', 'Width', 'Vertical alignment') && (
          <CollapsibleCard title="Canvas settings" defaultOpen>
            <div className="wbi-fmt__row">
              <div className="wbi-fmt__label">
                <span>Type</span>
              </div>
              <Dropdown
                size="small"
                value={canvasType}
                options={CANVAS_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                onChange={(v) => {
                  const t = CANVAS_TYPES.find((x) => x.value === v)
                  if (t?.w && t.h)
                    edit('Canvas size', (pj) => {
                      pj.width = t.w
                      pj.height = t.h
                    })
                }}
              />
            </div>
            <div className="wbi-fmt__pair">
              <Labeled label="Height (px)">
                <SpinField label="Height (px)" integer value={h} min={100} max={10000} onChange={(v) => v && edit('Canvas size', (pj) => (pj.height = Math.round(v)))} />
              </Labeled>
              <Labeled label="Width (px)">
                <SpinField label="Width (px)" integer value={w} min={100} max={10000} onChange={(v) => v && edit('Canvas size', (pj) => (pj.width = Math.round(v)))} />
              </Labeled>
            </div>
            <div className="wbi-fmt__row">
              <div className="wbi-fmt__label">
                <span>Vertical alignment</span>
              </div>
              <Dropdown
                size="small"
                value={vAlign}
                options={[
                  { value: 'Top', label: 'Top' },
                  { value: 'Middle', label: 'Middle' }
                ]}
                onChange={(v) =>
                  edit('Format page', (pj) => {
                    pj.objects ??= {}
                    pj.objects.displayArea = [{ properties: { verticalAlignment: { expr: { Literal: { Value: `'${v}'` } } } } }]
                  })
                }
              />
            </div>
            <div className="wbi-fmt__row">
              <div className="wbi-fmt__label">
                <span>Page view</span>
              </div>
              <Dropdown
                size="small"
                value={j.displayOption ?? 'FitToPage'}
                options={[
                  { value: 'FitToPage', label: 'Fit to page' },
                  { value: 'FitToWidth', label: 'Fit to width' },
                  { value: 'ActualSize', label: 'Actual size' }
                ]}
                onChange={(v) => edit('Page view', (pj) => (pj.displayOption = v))}
              />
            </div>
          </CollapsibleCard>
        )}
        {PAGE_CARDS.map((c) => (
          <FormatCardView key={c.object} card={c} target={target} search={search} />
        ))}
        <PageMotionCard page={page} search={search} />
        {matchesSearch(search, 'Filter cards', ...FILTER_CARD_PROPS.map((p) => p.displayName)) && (
          <CollapsibleCard title="Filter cards" defaultOpen={!!search}>
            <div className="wbi-fmt__row">
              <div className="wbi-fmt__label">
                <span>Apply settings to</span>
              </div>
              <Dropdown
                size="small"
                value={cardState}
                options={[
                  { value: 'Available', label: 'Available' },
                  { value: 'Applied', label: 'Applied' }
                ]}
                onChange={(v) => setCardState(v as 'Available' | 'Applied')}
              />
            </div>
            <PropRows defs={FILTER_CARD_PROPS} object="filterCard" target={target} selFor={() => filterSel} />
          </CollapsibleCard>
        )}
      </div>
    </div>
  )
}

function randomName(): string {
  const b = new Uint8Array(10)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

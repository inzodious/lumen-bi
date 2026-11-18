/**
 * The Format pane shows, for every Visual-tab property that is set nowhere, the value the renderer really uses
 * (effective.ts). Checked against the renderers themselves: every gallery fixture is rendered with an empty format
 * definition (fields kept, `objects` removed) — and once more with every Visual-tab switch turned on, so the
 * properties behind a switch are read too — while core/report/props `recordFallbacks` records the default each
 * reader passes. Every control the renderer read must then show exactly that default (or stay "Auto" for a reason
 * listed in AUTO_REASONS). Theme-set properties are skipped: pane and renderer resolve those through the same props.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEngine } from '@core/engine/engine'
import { makePropContext, rawProp, recordFallbacks } from '@core/report/props'
import { resolveTheme } from '@core/report/theme'
import { createMockHost, createMockState } from '../../visuals/common/mockHost'
import { buildSampleModel } from '../../visuals/gallery/sampleData'
import { galleryEntries, type GalleryEntry } from '../../visuals/gallery/registry'
import { getVisual } from '../../visuals/registry'
import type { FormatCardDef, FormatPropDef, VisualDefinition } from '../../visuals/contract'
import { ANALYTICS_OBJECTS } from './containerCards'
import { asControlValue, rendererDefault, withSwitchesOn } from './effective'
import { getRaw } from './objects'
import { propState, type PropSource } from './propModel'
import '../../visuals'

import.meta.glob('../../visuals/*/gallery.ts', { eager: true })

const theme = resolveTheme()
const { model, data } = buildSampleModel()
const engine = createEngine(model, data)
engine.processCalculated()

/** The visuals of the Format pane polish: every one of them gets a concrete value or a reason for "Auto". */
const IN_SCOPE = [
  'cardVisual',
  'card',
  'multiRowCard',
  'kpi',
  'clusteredColumnChart',
  'columnChart',
  'hundredPercentStackedColumnChart',
  'clusteredBarChart',
  'barChart',
  'hundredPercentStackedBarChart',
  'lineChart',
  'areaChart',
  'stackedAreaChart',
  'hundredPercentStackedAreaChart',
  'lineClusteredColumnComboChart',
  'lineStackedColumnComboChart',
  'ribbonChart',
  'scatterChart',
  'waterfallChart',
  'pieChart',
  'donutChart',
  'treemap',
  'funnel',
  'gauge',
  'map',
  'filledMap',
  'tableEx',
  'pivotTable',
  'slicer',
  'advancedSlicerVisual'
]

/**
 * Why a Visual-tab control legitimately stays "Auto" (or an empty text box): the renderer computes the value per
 * render, or draws nothing. Matched against `object.prop`.
 */
export const AUTO_REASONS: Array<{ match: RegExp; reason: string }> = [
  { match: /(^|\.)(labelPrecision|secLabelPrecision|percentageLabelPrecision|indicatorPrecision|valuePrecision|detailPrecision)$/, reason: 'decimal places follow the format string ("Auto" in Power BI too)' },
  { match: /DisplayUnits$/, reason: 'display units "Auto" (Power BI\'s own option: scaled to the values)' },
  { match: /^(categoryAxis|valueAxis|y2Axis)\.(start|end|secStart|secEnd)$|^axis\.(min|max|target)$/, reason: 'axis range computed from the data' },
  { match: /^categoryAxis\.axisType$/, reason: 'continuous / categorical follows the field data type' },
  { match: /\.(titleText|secTitleText|text|customFormatString|showBlankAs|imageUrl|url|anchorDate|sortMeasure|gridlineDashArray|strokeDashArray|displayName|titleText)$/, reason: 'text: empty by default (titles use the field name)' },
  { match: /^(labels|categoryLabels)\.color$/, reason: 'data-label color picked per label (contrast inside, label class outside)' },
  { match: /^(dataPoint\.(fill|defaultColor)|error\.barColor|lineStyles\.(areaColor|markerColor)|anomalyDetection\.confidenceBandColor|markers\.borderColor)$/, reason: 'follows each series / category color' },
  { match: /^goals\.distanceFontColor$/, reason: 'follows the KPI status color' },
  { match: /\.(lumenIcon|lumenIconSource)$/, reason: 'Lumen icon source (pseudo property, icons/IconSourceRows): no icon until one is chosen' },
  { match: /^(plotArea\.color|smallMultiplesLayout\.backgroundColor|card\.cardBackground|(columnHeaders|rowHeaders|total|rowTotal|columnTotal)\.backColor|blankRows\.blankRowColor|(header|items|searchBox|numericInputStyle|date)\.background)$/, reason: 'no fill drawn unless set' },
  { match: /^columnFormatting\./, reason: 'a specific column inherits the values / header formatting' },
  { match: /^(columnHeaders|rowHeaders|columnFormatting)\.(alignment|titleAlignment)$|^referenceLabelLayout\.horizontalAlignment$/, reason: 'aligned by content (numbers right, text left) / by the layout style' },
  { match: /^(layout|smallMultiplesLayout)\.(rowCount|maxHeaderSize|titleOrientation)$|^referenceLabelLayout\.valueArea$|^grid\.imageWidth$|^indicator\.iconSize$/, reason: 'sized / oriented by the layout' },
  { match: /^labels\.labelPosition$/, reason: 'combo charts: bars and lines have different positions' },
  { match: /^markers\.transparency$|^fillPoint\.style$/, reason: 'scatter markers follow the series' }
]
const autoReason = (key: string) => AUTO_REASONS.find((r) => r.match.test(key))?.reason

/**
 * The pane shows a value that differs from the recorded fallback but renders identically, documented here:
 * cartesian / pie / waterfall legends fall back to "off" with a single series or a tiny responsive size, and the
 * renderer forces the legend off in exactly those cases whatever the setting, so "On" (Power BI's pane) is equivalent.
 */
const EQUIVALENT: Record<string, RegExp> = { '*': /^legend\.show$/ }

const visualCards = (def: VisualDefinition): FormatCardDef[] => def.formatCards.filter((c) => !ANALYTICS_OBJECTS.has(c.object) && c.tab !== 'general' && !c.container)
const controls = (def: VisualDefinition) => visualCards(def).flatMap((c) => c.properties.filter((p) => p.type !== 'image' && p.type !== 'textarea').map((p) => ({ object: c.object, def: p })))

function source(json: any): PropSource {
  const pc = makePropContext(json, theme)
  return { bag: json.visual.objects, resolveRaw: (o, p, s) => rawProp(pc, o, p, s), defaults: (o, p, d) => rendererDefault(o, p, theme, json, false, d), theme }
}

function renderRecording(e: GalleryEntry, json: any): Map<string, unknown[]> {
  const def = getVisual(json.visual.visualType)!
  const rec = new Map<string, unknown[]>()
  const ctx = createMockHost({ engine: e.engine ?? engine, report: e.report, mode: e.mode, filters: e.filters, theme, state: createMockState({ drill: { level: 0, path: [], ...e.drill } }) })
  const Comp = def.component
  const err = console.error
  console.error = () => {}
  try {
    recordFallbacks(
      (o, p, f) => {
        const k = `${o}.${p}`
        rec.set(k, [...(rec.get(k) ?? []), f])
      },
      () => renderToStaticMarkup(<Comp visual={{ name: e.id, json }} pageName="gallery" width={e.width ?? 400} height={e.height ?? 300} ctx={ctx} />)
    )
  } finally {
    console.error = err
  }
  return rec
}

/** Pane value vs. recorded renderer fallbacks for one rendering; returns the controls the pane leaves automatic. */
function check(type: string, e: GalleryEntry, json: any): string[] {
  const def = getVisual(type)!
  const recorded = renderRecording(e, json)
  const src = source(json)
  const pc = makePropContext({ visual: { visualType: type } }, theme)
  const unresolved: string[] = []
  for (const { object, def: p } of controls(def)) {
    const key = `${object}.${p.name}`
    const vals = recorded.get(key)
    if (!vals) continue
    if (getRaw(json.visual.objects, object, p.name) !== undefined || rawProp(pc, object, p.name) !== undefined) continue
    const pane = propState(p, object, src).value
    if (pane === undefined) {
      unresolved.push(key)
      continue
    }
    if (EQUIVALENT['*'].test(key) || EQUIVALENT[type]?.test(key)) continue
    expect(
      vals.map((v) => asControlValue(p, v)),
      `${type} (${e.id}) ${key}: the pane shows ${JSON.stringify(pane)}, the renderer falls back to ${JSON.stringify(vals)}`
    ).toContain(pane)
  }
  return unresolved
}

describe('format pane: unset Visual-tab properties show the renderer default', () => {
  const fixtures = galleryEntries().filter((e) => getVisual(e.json?.visual?.visualType ?? '')?.formatCards.length)
  it('has a fixture for every visual in scope', () => {
    const types = new Set(fixtures.map((e) => e.json.visual.visualType))
    expect(IN_SCOPE.filter((t) => !types.has(t))).toEqual([])
  })
  for (const e of fixtures) {
    const type: string = e.json.visual.visualType
    it(`${type} · ${e.id}`, () => {
      const def = getVisual(type)!
      const stripped = structuredClone(e.json)
      delete stripped.visual.objects
      const unresolved = [...check(type, e, stripped), ...check(type, e, withSwitchesOn(stripped, def))]
      // a fallback the renderer has but the pane does not show must be one of the documented automatic values
      if (IN_SCOPE.includes(type)) expect([...new Set(unresolved)].filter((k) => !autoReason(k)), `${type}: controls left "Auto" although the renderer has a default`).toEqual([])
    })
  }
})

/** Every Visual-tab control of an empty visual: what it shows (count table of the Format pane polish). */
export function unresolvedControls(type: string): Array<{ key: string; type: FormatPropDef['type']; reason?: string }> {
  const def = getVisual(type)!
  const json = { visual: { visualType: type } }
  const src = source(json)
  return controls(def)
    .filter(({ object, def: p }) => {
      const v = propState(p, object, src).value
      return v === undefined || v === null || v === ''
    })
    .map(({ object, def: p }) => ({ key: `${object}.${p.name}`, type: p.type, reason: autoReason(`${object}.${p.name}`) }))
}

describe('format pane: what an empty visual still shows as "Auto"', () => {
  for (const type of IN_SCOPE) {
    it(`${type}: only documented automatic values`, () => {
      expect(unresolvedControls(type).filter((c) => !c.reason).map((c) => c.key)).toEqual([])
    })
  }
})

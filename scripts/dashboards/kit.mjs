/** Pieces every live dashboard shares: field helpers and the year slicer (synced across pages, the latest year saved). */
import { c, col, m, props, raw } from '../templates/lib.mjs'

export const kpi = (name) => m('_measures_kpi', name)
export const fmt = (name) => m('_measures_format', name)
export const cal = (name) => col('dim_calendar', name)

/** The year in view when the dashboard opens. */
export const CURRENT_YEAR = 2026

function inFilter(entity, prop, literal) {
  return {
    Version: 2,
    From: [{ Name: 'd', Entity: entity, Type: 0 }],
    Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'd' } }, Property: prop } }], Values: [[{ Literal: { Value: literal } }]] } } }]
  }
}

/** Dropdown slicer on dim_calendar[year], single select, synced on every page, opening on the current year (or `spec.year`). */
export function yearSlicer(k, spec) {
  const year = spec.year ?? CURRENT_YEAR
  return k.slicer({
    name: 'year',
    mode: 'Dropdown',
    header: false,
    ...spec,
    field: cal('year'),
    syncGroup: 'year',
    objects: { selection: { singleSelect: true, strictSingleSelect: true }, ...(spec.objects ?? {}) },
    rawObjects: { general: [{ properties: { filter: { filter: inFilter('dim_calendar', 'year', `${year}L`) } } }] }
  })
}

/** A color bound to a `_measures_format` measure (fx ▸ Field value). */
export function fx(measure) {
  return raw({ solid: { color: { expr: { Measure: { Expression: { SourceRef: { Entity: '_measures_format' } }, Property: measure } } } } })
}

/** Legend without the field-name title (the series values say enough). */
export function legend(t, position = 'TopRight') {
  return { show: true, position, showTitle: false, labelColor: c(t.muted), fontFamily: t.fontBody, fontSize: 8 }
}

/** Add properties to a built visual's object: into its default entry, or a new entry when a selector is given. */
export function tune(v, object, properties, selector) {
  const bag = (v.visual.objects ??= {})
  const list = (bag[object] ??= [])
  if (selector) list.push({ properties: props(properties), selector })
  else {
    const entry = list.find((e) => !e.selector) ?? list[list.push({ properties: {} }) - 1]
    Object.assign(entry.properties, props(properties))
  }
  return v
}

/** Table columns stretch to the visual's width. */
export const growToFit = (v) => tune(v, 'columnHeaders', { columnAdjustment: 'growToFit' })

/** A table column's text colored by a `_measures_format` measure, on values only (not the total). */
export function columnColor(v, queryRef, measure) {
  return tune(v, 'values', { fontColor: fx(measure) }, { metadata: queryRef, data: [{ dataViewWildcard: { matchingOption: 1 } }] })
}

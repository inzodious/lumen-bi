/**
 * Click logic of list-style slicers (Basic / Dropdown / Tile / button slicer), pure so it can be
 * unit tested. State is (persisted filter, inverted-selection flag); results are the next filter
 * and flag to persist.
 */
import type { Scalar } from '@core/model/data'
import type { SQExpr, SQFilter } from '@core/report/sq'
import { listContains, listFilter, parseListFilter, toggleListValue, valueSelected, type ListSelection } from './filterModel'

export interface ListState {
  field: SQExpr
  filter: SQFilter | undefined
  inverted: boolean
  /** identity column for field parameters (when known even before a filter exists) */
  keyField?: SQExpr
}

export interface ListUpdate {
  filter: SQFilter | undefined
  inverted: boolean
}

export function currentSelection(s: ListState): ListSelection | undefined {
  return parseListFilter(s.filter, s.field)
}

/** Is the item (identity `key`, display `label`) selected? */
export function itemSelected(s: ListState, key: Scalar, label: Scalar): boolean {
  if (!s.filter) return s.inverted
  const sel = currentSelection(s)
  if (sel) {
    const hit = sel.keyField
      ? listContains(sel.values, key) || (!!sel.labels && listContains(sel.labels, label))
      : listContains(sel.values, label)
    return sel.mode === 'include' ? hit : !hit
  }
  return valueSelected(s.filter, s.field, label)
}

export function hasSelection(s: ListState): boolean {
  return !!s.filter || s.inverted
}

export interface ClickOptions {
  /** ctrl/cmd held */
  ctrl: boolean
  /** "Multi-select with CTRL" on (PBI `singleSelect`) */
  ctrlMulti: boolean
  /** "Single select" on (PBI `strictSingleSelect`) */
  strictSingle: boolean
  /** Force selection (Lumen extra): a click that would leave nothing selected is ignored */
  force?: boolean
}

/** Apply a click on an item. */
export function clickItem(s: ListState, key: Scalar, label: Scalar, o: ClickOptions): ListUpdate {
  const next = clickItemRaw(s, key, label, o)
  if (o.force && isEmptySelection(next)) return { filter: s.filter, inverted: s.inverted }
  return next
}

/** Nothing selected (no filter, not in Select-all mode). */
export function isEmptySelection(u: ListUpdate): boolean {
  return !u.filter && !u.inverted
}

function clickItemRaw(s: ListState, key: Scalar, label: Scalar, o: ClickOptions): ListUpdate {
  const replace = o.strictSingle || (o.ctrlMulti && !o.ctrl)
  const sel = currentSelection(s)
  const keyField = sel?.keyField ?? s.keyField
  if (s.inverted && !s.filter && !replace) {
    // Select-all state: clicking an item deselects it (Not In)
    const next: ListSelection = { mode: 'exclude', values: [key], keyField, labels: keyField ? [label] : undefined }
    return { filter: listFilter(s.field, next), inverted: true }
  }
  if (replace) {
    const already = sel?.mode === 'include' && sel.values.length === 1 && listContains(sel.values, key)
    if (o.strictSingle && already) return { filter: s.filter, inverted: false }
    const next = toggleListValue(sel && sel.mode === 'include' ? sel : { mode: 'include', values: [], keyField }, key, true, label)
    return { filter: listFilter(s.field, { ...next, keyField }), inverted: false }
  }
  const base: ListSelection = sel ?? { mode: s.inverted ? 'exclude' : 'include', values: [], keyField }
  const next = toggleListValue({ ...base, keyField, labels: keyField ? base.labels ?? [] : undefined }, key, false, label)
  if (next.mode === 'exclude' && !next.values.length) return { filter: undefined, inverted: true }
  return { filter: listFilter(s.field, next), inverted: next.mode === 'exclude' }
}

/** "Select all" checkbox: all selected → clear; otherwise → inverted mode with nothing excluded. */
export function clickSelectAll(s: ListState, force = false): ListUpdate {
  const allOn = s.inverted && !s.filter
  if (allOn && force) return { filter: s.filter, inverted: s.inverted }
  return allOn ? { filter: undefined, inverted: false } : { filter: undefined, inverted: true }
}

/** Selection of exactly one item (PBI single-select auto-pick of the first item, Force selection). */
export function selectOnly(s: ListState, key: Scalar, label: Scalar): ListUpdate {
  return clickItemRaw({ ...s, filter: undefined, inverted: false }, key, label, { ctrl: false, ctrlMulti: true, strictSingle: false })
}

/** Tri-state of the "Select all" checkbox. */
export function selectAllState(s: ListState, keys: Scalar[], labels: Scalar[]): 'on' | 'off' | 'partial' {
  if (s.inverted && !s.filter) return 'on'
  if (!s.filter) return 'off'
  let on = 0
  keys.forEach((k, i) => {
    if (itemSelected(s, k, labels[i])) on++
  })
  return on === 0 ? 'off' : on === keys.length ? 'on' : 'partial'
}

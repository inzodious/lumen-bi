/**
 * Format pane cards specific to the table and matrix visuals (rendered by the Format tab next to the cards
 * generated from the visual definitions):
 *
 *  - "Layout" (Power BI: Format ▸ Visual ▸ Layout): Column width — Auto-size behavior (Fit to content / Grow to
 *    fit / Fixed width), Default width (Fixed width only), Custom widths (one input per column, "(auto)" when the
 *    column follows the auto-size behavior; an "Apply settings to" picker from 15 columns on; switching it off
 *    clears every custom width), and for a matrix with column fields "More granular" — plus Freeze ▸ Row headers.
 *  - "Subtotals per level": the per-level "Show subtotal" switches of a matrix (keyed by the level's field).
 *
 * Everything is read from / written to the PBIR objects bag of the format target (visual.json, or the mobile
 * layout override), with the edits of ./columnWidths.
 */
import { useState } from 'react'
import { decodeLiteral } from '@core/report/literal'
import { getProp, type ObjectsBag } from '@core/report/props'
import type { VisualDocument } from '@core/report/types'
import { useApp } from '../../state/store'
import { CollapsibleCard, Dropdown, Toggle } from '../../app/ui'
import { matchesSearch, type BagTarget } from '../../panes/visualizations/PropEditor'
import { SpinField } from '../../panes/visualizations/controls'
import { nativeName, roleProjections } from '../../panes/visualizations/wells'
import { readTableFormat, scopeTotalKey } from './tableFormat'
import { steppedHeaderWidth } from './MatrixVisual'
import { DEFAULT_FIXED_WIDTH, type SizeBehavior } from './widths'
import { resetColumnWidth, setColumnWidth, setCustomWidthsEnabled, setDefaultWidth, setGranularWidths, setSizeBehavior, type WidthTarget } from './columnWidths'

/** From this many columns on, Power BI shows one "Apply settings to" picker instead of an input per column. */
export const CUSTOM_WIDTH_PICKER_FROM = 15

const BEHAVIORS: Array<{ value: SizeBehavior; label: string }> = [
  { value: 'fitToContent', label: 'Fit to content' },
  { value: 'growToFit', label: 'Grow to fit' },
  { value: 'fixedWidth', label: 'Fixed width' }
]

export interface WidthRow {
  key: string
  label: string
  target: WidthTarget
  width?: number
}

function projectionLabel(p: { displayName?: string; nativeQueryRef?: string; field: any; queryRef: string }): string {
  return p.displayName ?? p.nativeQueryRef ?? (nativeName(p.field) || p.queryRef)
}

/** Columns whose width can be customized, with their stored custom width (pure; exported for tests). */
export function customWidthRows(visualJson: any, bag: ObjectsBag | undefined, theme: BagTarget['theme']): { rows: WidthRow[]; scoped: WidthRow[] } {
  const type = String(visualJson?.visual?.visualType ?? '')
  const f = readTableFormat({ visual: { visualType: type, objects: bag ?? {} } }, theme)
  const rows: WidthRow[] = []
  if (type === 'pivotTable') {
    const rowPs = roleProjections(visualJson, 'Rows')
    if (f.rowHeaders.stepped) {
      // one row-header column, stored under the outermost row field
      if (rowPs.length) rows.push({ key: `r:${rowPs[0].queryRef}`, label: `${projectionLabel(rowPs[0])} (row headers)`, target: { metadata: rowPs[0].queryRef }, width: steppedHeaderWidth(rowPs.map((p) => p.queryRef), f.widthByRef) ?? f.cornerWidth })
    } else for (const p of rowPs) rows.push({ key: `r:${p.queryRef}`, label: projectionLabel(p), target: { metadata: p.queryRef }, width: f.widthByRef.get(p.queryRef) })
    for (const p of roleProjections(visualJson, 'Values')) rows.push({ key: `v:${p.queryRef}`, label: projectionLabel(p), target: { metadata: p.queryRef }, width: f.widthByRef.get(p.queryRef) })
  } else {
    for (const p of roleProjections(visualJson, 'Values')) rows.push({ key: `v:${p.queryRef}`, label: projectionLabel(p), target: { metadata: p.queryRef }, width: f.widthByRef.get(p.queryRef) })
  }
  // matrix: widths of single column headers / total columns
  const values = roleProjections(visualJson, 'Values')
  const scoped = f.widthByScope.map((w, i): WidthRow => {
    const value = w.scope.map((s) => s?.scopeId?.Comparison?.Right?.Literal?.Value).filter((x) => x !== undefined).map((x) => scalarLabel(decodeLiteral(x)))
    const what = scopeTotalKey(w.scope) !== undefined ? 'Total' : value.join(' · ') || 'Column'
    const of = w.ref ? values.find((p) => p.queryRef === w.ref) : undefined
    return { key: `s:${i}`, label: of ? `${what} · ${projectionLabel(of)}` : what, target: { data: w.scope, ...(w.ref !== undefined ? { metadata: w.ref } : {}) }, width: w.width }
  })
  return { rows, scoped }
}

function scalarLabel(v: unknown): string {
  if (v === null || v === undefined) return '(Blank)'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

export function TableLayoutCard({ visual, target, search }: { visual: VisualDocument; target: BagTarget; search: string }) {
  const [picked, setPicked] = useState('')
  const type = String(visual.json?.visual?.visualType ?? '')
  const isMatrix = type === 'pivotTable'
  const terms = ['Layout', 'Column width', 'Auto-size behavior', 'Fit to content', 'Grow to fit', 'Fixed width', 'Default width', 'Custom widths', ...(isMatrix ? ['More granular', 'Freeze', 'Row headers'] : [])]
  if (!matchesSearch(search, ...terms)) return null
  const f = readTableFormat({ visual: { visualType: type, objects: target.bag ?? {} } }, target.theme)
  const { rows, scoped } = customWidthRows(visual.json, target.bag, target.theme)
  const hasColumnFields = isMatrix && roleProjections(visual.json, 'Columns').length > 0
  // `coalesce`: a burst of spin-arrow clicks on one width box is a single undo step (like the other Format pane boxes)
  const edit = (fn: (bag: ObjectsBag) => void, coalesce?: string) =>
    useApp.getState().mutateReport(
      target.label,
      (r) => {
        const bag = target.locate(r)
        if (!bag) return
        for (const o of ['columnHeaders', 'columnWidth', 'rowHeaders']) target.beforeWrite?.(r, bag, o)
        fn(bag)
      },
      coalesce ? { coalesce: `fmt:${target.cf?.visualName ?? target.label}:layout:${coalesce}` } : undefined
    )
  // the Format pane's shared spin box (controls.tsx), so these rows look and behave like every other numeric property
  const widthInput = (row: WidthRow) => (
    <SpinField
      label={`${row.label} width`}
      value={row.width === undefined ? undefined : Math.round(row.width * 100) / 100}
      placeholder="(auto)"
      min={0}
      max={2000}
      unit="px"
      onChange={(n, stepping) => edit((bag) => (n === undefined ? resetColumnWidth(bag, row.target) : setColumnWidth(bag, row.target, n)), stepping ? row.key : undefined)}
    />
  )
  const list = (items: WidthRow[]) =>
    items.length < CUSTOM_WIDTH_PICKER_FROM ? (
      items.map((row) => (
        <div className="wbi-fmt__row" key={row.key} data-width-for={row.target.metadata ?? row.key}>
          <div className="wbi-fmt__label">
            <span>{row.label}</span>
          </div>
          <div className="wbi-fmt__editor">{widthInput(row)}</div>
        </div>
      ))
    ) : (
      <ColumnPicker items={items} picked={picked} setPicked={setPicked} input={widthInput} />
    )
  return (
    <CollapsibleCard title="Layout" defaultOpen={!!search} key={search ? 'q' : 'n'}>
      <div className="wbi-fmt__sub">
        {isMatrix && (
          <CollapsibleCard title="Freeze" level={2}>
            <div className="wbi-fmt__row is-inline" data-prop="unfrozen">
              <div className="wbi-fmt__label">
                <span>Row headers</span>
              </div>
              <div className="wbi-fmt__editor">
                <Toggle size="small" on={!f.rowHeaders.unfrozen} onChange={(on) => edit((bag) => setRowHeadersFrozen(bag, on))} />
              </div>
            </div>
          </CollapsibleCard>
        )}
        <CollapsibleCard title="Column width" level={2} defaultOpen>
          <div className="wbi-fmt__row" data-prop="columnAdjustment">
            <div className="wbi-fmt__label">
              <span>Auto-size behavior</span>
            </div>
            <div className="wbi-fmt__editor">
              <Dropdown size="small" value={f.sizing.behavior} options={BEHAVIORS} onChange={(v) => edit((bag) => setSizeBehavior(bag, v as SizeBehavior, { legacyManual: f.sizing.legacyManual }))} />
            </div>
          </div>
          {f.sizing.behavior === 'fixedWidth' && (
            <div className="wbi-fmt__row" data-prop="defaultColumnWidth">
              <div className="wbi-fmt__label">
                <span>Default width</span>
              </div>
              <div className="wbi-fmt__editor">
                <SpinField
                  label="Default width"
                  value={f.sizing.defaultWidth}
                  // legacy "Auto-size width: off" files have no default: columns without a custom width keep their content width
                  placeholder={f.sizing.legacyManual ? '(content)' : String(DEFAULT_FIXED_WIDTH)}
                  min={1}
                  max={2000}
                  unit="px"
                  onChange={(n, stepping) => edit((bag) => setDefaultWidth(bag, n), stepping ? 'default' : undefined)}
                />
              </div>
            </div>
          )}
          <div className="wbi-fmt__row is-inline" data-prop="customColumnWidth">
            <div className="wbi-fmt__label">
              <span>Custom widths</span>
            </div>
            <div className="wbi-fmt__editor">
              <Toggle size="small" on={f.sizing.custom} onChange={(on) => edit((bag) => setCustomWidthsEnabled(bag, on))} />
            </div>
          </div>
          {f.sizing.custom && (
            <>
              {list(rows)}
              {hasColumnFields && (
                <div className="wbi-fmt__row is-inline" data-prop="customColumnWidthGranularView">
                  <div className="wbi-fmt__label">
                    <span>More granular</span>
                  </div>
                  <div className="wbi-fmt__editor">
                    <Toggle size="small" on={f.sizing.granular} onChange={(on) => edit((bag) => setGranularWidths(bag, on))} />
                  </div>
                </div>
              )}
              {hasColumnFields && f.sizing.granular && (scoped.length ? list(scoped) : <div className="wbi-fmt__bound">Drag the edge of a column header, or right-click it and choose Set column width, to size that column on its own.</div>)}
            </>
          )}
        </CollapsibleCard>
      </div>
    </CollapsibleCard>
  )
}

function ColumnPicker({ items, picked, setPicked, input }: { items: WidthRow[]; picked: string; setPicked(k: string): void; input(row: WidthRow): React.ReactNode }) {
  const row = items.find((r) => r.key === picked) ?? items[0]
  return (
    <>
      <div className="wbi-fmt__row" data-prop="applySettingsTo">
        <div className="wbi-fmt__label">
          <span>Apply settings to</span>
        </div>
        <div className="wbi-fmt__editor">
          {/* columns with a custom width are marked with an asterisk */}
          <Dropdown size="small" value={row.key} options={items.map((r) => ({ value: r.key, label: r.width === undefined ? r.label : `${r.label} *` }))} onChange={(v) => setPicked(String(v))} />
        </div>
      </div>
      <div className="wbi-fmt__row" data-width-for={row.target.metadata ?? row.key}>
        <div className="wbi-fmt__label">
          <span>Width</span>
        </div>
        <div className="wbi-fmt__editor">{input(row)}</div>
      </div>
    </>
  )
}

/** Layout ▸ Freeze ▸ Row headers (`rowHeaders.unfrozen`, written only when the row headers are not frozen). */
export function setRowHeadersFrozen(bag: ObjectsBag, frozen: boolean): void {
  let e = bag.rowHeaders?.find((x) => !x.selector || !Object.keys(x.selector).length)
  if (frozen) {
    if (!e) return
    delete e.properties.unfrozen
    if (!Object.keys(e.properties).length) {
      bag.rowHeaders = bag.rowHeaders.filter((x) => x !== e)
      if (!bag.rowHeaders.length) delete bag.rowHeaders
    }
    return
  }
  if (!e) {
    e = { properties: {} }
    ;(bag.rowHeaders ??= []).push(e)
  }
  e.properties.unfrozen = { expr: { Literal: { Value: 'true' } } }
}

/**
 * Matrix subtotals per level: Power BI's "Per row level" / "Per column level" show a subtotal switch for each
 * level, stored as `subTotals.levelSubtotalEnabled` with the level's field as `metadata` selector.
 */
export function LevelSubtotalsCard({ visual, target, search }: { visual: VisualDocument; target: BagTarget; search: string }) {
  if (!matchesSearch(search, 'Subtotals per level', 'Show subtotal', 'Per row level', 'Per column level')) return null
  const pc = { visualType: 'pivotTable', objects: target.bag ?? {}, theme: target.theme }
  const perRow = getProp<boolean>(pc, 'subTotals', 'perRowLevel', false) === true
  const perCol = getProp<boolean>(pc, 'subTotals', 'perColumnLevel', false) === true
  const section = (role: 'Rows' | 'Columns', on: boolean) => {
    // the last level has no subtotal
    const levels = roleProjections(visual.json, role).slice(0, -1)
    if (!on || !levels.length) return null
    return levels.map((p) => {
      const enabled = getProp<boolean>(pc, 'subTotals', 'levelSubtotalEnabled', true, { metadata: p.queryRef }) !== false
      return (
        <div className="wbi-fmt__row is-inline" key={`${role}:${p.queryRef}`} data-level={p.queryRef}>
          <div className="wbi-fmt__label">
            <span>
              {role === 'Rows' ? 'Row' : 'Column'} subtotal: {projectionLabel(p)}
            </span>
          </div>
          <div className="wbi-fmt__editor">
            <Toggle
              size="small"
              on={enabled}
              onChange={(v) =>
                useApp.getState().mutateReport(target.label, (r) => {
                  const bag = target.locate(r)
                  if (!bag) return
                  target.beforeWrite?.(r, bag, 'subTotals')
                  setLevelSubtotal(bag, p.queryRef, v)
                })
              }
            />
          </div>
        </div>
      )
    })
  }
  const rows = section('Rows', perRow)
  const cols = section('Columns', perCol)
  return (
    <CollapsibleCard title="Subtotals per level" defaultOpen={!!search} key={search ? 'q' : 'n'}>
      {rows}
      {cols}
      {!rows?.length && !cols?.length && <div className="wbi-fmt__bound">Turn on Per row level or Per column level under Subtotals to choose which levels show a subtotal.</div>}
    </CollapsibleCard>
  )
}

/** `subTotals.levelSubtotalEnabled` of one level (selector.metadata = the level's queryRef). */
export function setLevelSubtotal(bag: ObjectsBag, queryRef: string, enabled: boolean): void {
  const list = (bag.subTotals ??= [])
  let e = list.find((x) => x.selector?.metadata === queryRef)
  if (!e) {
    e = { properties: {}, selector: { metadata: queryRef } }
    list.push(e)
  }
  e.properties.levelSubtotalEnabled = { expr: { Literal: { Value: String(enabled) } } }
}

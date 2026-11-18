/**
 * Format pane fx affordances: the "fx" button next to a property that supports conditional
 * formatting, the chip shown instead of the editor once CF is applied, and PBI's "Cell elements"
 * card for tables and matrices (background / font color, data bars, icons, web URL per series).
 */
import { useState } from 'react'
import { DismissRegular } from '@fluentui/react-icons'
import type { SemanticModel } from '@core/model/types'
import type { ResolvedTheme } from '@core/report/theme'
import type { PageDocument, VisualDocument } from '@core/report/types'
import { useApp } from '../../../state/store'
import { CollapsibleCard, Dropdown, Tip, Toggle } from '../../../app/ui'
import { visualBag } from '../objects'
import { roleProjections } from '../wells'
import { commitCF } from './actions'
import { defaultInputFor } from './fields'
import { ICON_SETS, defaultDataBars, defaultGradient, defaultIconRules, describeModel, parseCF, parseIcons, serializeCF, serializeDataBars, serializeIcons } from './rules'
import { openCfDialog } from './store'
import { cellTarget, findCF, type CFTarget } from './target'
import './cf.css'

function matchesSearch(q: string, ...texts: string[]): boolean {
  const s = q.toLowerCase()
  return !q || texts.some((t) => t.toLowerCase().includes(s))
}

export function FxButton({ target, on }: { target: CFTarget; on?: boolean }) {
  return (
    <Tip title="Conditional formatting">
      <button type="button" className={'wbi-fx-btn' + (on ? ' is-on' : '')} aria-label={`Conditional formatting: ${target.title}`} onClick={() => openCfDialog(target)}>
        fx
      </button>
    </Tip>
  )
}

function describeRaw(t: CFTarget, raw: any): string {
  if (t.kind === 'dataBars') return 'Data bars'
  if (t.kind === 'icon') {
    const m = parseIcons(raw)
    return m ? `Icons · ${describeModel(m.rule).replace(/^[^·]+· /, '')}` : 'Icons'
  }
  return describeModel(parseCF(raw)?.model)
}

/** Shown in place of a property editor when the property is conditionally formatted. */
export function FxChip({ target, raw }: { target: CFTarget; raw: any }) {
  const text = describeRaw(target, raw)
  return (
    <div className="wbi-fx-wrap">
      <div className="wbi-fx-chip" data-cf={`${target.object}.${target.prop}`}>
        <button type="button" className="wbi-fx-chip__text" title={`${text} — click to edit`} onClick={() => openCfDialog(target)}>
          {text}
        </button>
        <Tip title="Remove conditional formatting">
          <button type="button" className="wbi-fx-chip__x" aria-label="Remove conditional formatting" onClick={() => commitCF(target, undefined)}>
            <DismissRegular fontSize={12} />
          </button>
        </Tip>
      </div>
      <FxButton target={target} on />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Cell elements (tableEx / pivotTable)
// ---------------------------------------------------------------------------------------------

type CellKind = 'backColor' | 'fontColor' | 'dataBars' | 'icon' | 'webURL'
const CELL_ROWS: Array<{ kind: CellKind; label: string }> = [
  { kind: 'backColor', label: 'Background color' },
  { kind: 'fontColor', label: 'Font color' },
  { kind: 'dataBars', label: 'Data bars' },
  { kind: 'icon', label: 'Icons' },
  { kind: 'webURL', label: 'Web URL' }
]

/** Initial CF written when a Cell elements toggle is switched on (PBI defaults). Web URL has none: it opens the dialog. */
function initialRaw(kind: CellKind, model: SemanticModel | undefined, visual: VisualDocument, queryRef: string, theme: ResolvedTheme): any {
  const input = defaultInputFor(model, visual.json, queryRef)
  if (kind === 'dataBars') return serializeDataBars(defaultDataBars(theme.dataColors[0]?.toUpperCase() ?? '#118DFF'))
  if (!input) return undefined
  if (kind === 'icon') return serializeIcons({ kind: 'Icon', layout: 'Before', verticalAlignment: 'Top', rule: defaultIconRules(input, ICON_SETS.find((s) => s.id === 'lights')!.icons) })
  if (kind === 'webURL') return undefined
  return serializeCF({ wrap: 'solid', model: defaultGradient(input) })
}

export function CellElementsCard({ page, visual, search }: { page: PageDocument; visual: VisualDocument; search: string }) {
  const model = useApp((s) => s.project?.model)
  const theme = useApp((s) => s.theme)
  const series = roleProjections(visual.json, 'Values').map((p) => ({ queryRef: p.queryRef, label: p.displayName ?? p.nativeQueryRef ?? p.queryRef }))
  const [sel, setSel] = useState<string>('')
  if (!matchesSearch(search, 'Cell elements', ...CELL_ROWS.map((r) => r.label))) return null
  const current = series.find((s) => s.queryRef === sel) ?? series[0]
  const bag = visualBag(visual.json, false)
  return (
    <CollapsibleCard title="Cell elements" defaultOpen={!!search}>
      {!current ? (
        <div className="wbi-muted">Add fields to the visual to format its cells.</div>
      ) : (
        <>
          <div className="wbi-fmt__row">
            <div className="wbi-fmt__label">
              <span>Apply settings to</span>
            </div>
            <Dropdown size="small" value={current.queryRef} options={series.map((s) => ({ value: s.queryRef, label: s.label }))} onChange={(v) => setSel(String(v))} />
          </div>
          {CELL_ROWS.filter((r) => !search || matchesSearch(search, 'Cell elements', r.label)).map((r) => {
            const t = cellTarget(page.name, visual.name, current.queryRef, current.label, r.kind)
            const found = findCF(bag, t)
            return (
              <div key={r.kind} className="wbi-fx-cell" data-cell={r.kind}>
                <span className="wbi-fx-cell__label">{r.label}</span>
                <span className="wbi-fx-cell__ctl">
                  <Toggle
                    size="small"
                    on={!!found}
                    onChange={(on) => {
                      if (!on) return commitCF(t, undefined)
                      const raw = initialRaw(r.kind, model, visual, current.queryRef, theme)
                      if (raw === undefined) openCfDialog(t)
                      else commitCF(t, raw)
                    }}
                  />
                  <FxButton target={t} on={!!found} />
                </span>
              </div>
            )
          })}
        </>
      )}
    </CollapsibleCard>
  )
}

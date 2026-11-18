/**
 * Format-pane property editors: one row per FormatPropDef (toggle / number / color / text / enum /
 * font / alignment / display units / image), and a card view that renders a FormatCardDef with its
 * header toggle and optional per-series selector. Works on any PBIR objects bag through a BagTarget
 * (visual objects, visual container objects, page objects).
 */
import { useState, type ReactNode } from 'react'
import { LUMEN_SLICER_OBJECT, normalizeLumenSlicer } from '../../visuals/slicers/slicerFormat'
import { ArrowResetRegular, TextAlignLeftRegular, TextAlignCenterRegular, TextAlignRightRegular, TextBoldRegular, TextItalicRegular, TextUnderlineRegular, ImageAddRegular } from '@fluentui/react-icons'
import type { Scalar } from '@core/model/data'
import { isDataBound, type ObjectsBag, type Selector } from '@core/report/props'
import type { ReportDocument } from '@core/report/types'
import type { ResolvedTheme } from '@core/report/theme'
import type { FormatCardDef, FormatPropDef } from '../../visuals/contract'
import { useApp } from '../../state/store'
import { registerResource } from '../../app/commands'
import { CollapsibleCard, ColorPicker, Dropdown, TextField, Toggle, cx, Tip } from '../../app/ui'
import { getRaw, setRaw, themeColorRaw } from './objects'
import { DISPLAY_UNITS, FONT_FAMILIES, fontFamilyName, fontFamilyValue } from './containerCards'
import { cfKindFor, findCF, propTarget, type CFContext } from './cf/target'
import { FxButton, FxChip } from './cf/FxControls'
import { PercentSlider, Segmented, SpinField } from './controls'
import { BIU, layoutProps, propState } from './propModel'

export { layoutProps, propState, type PropLayoutItem, type PropState } from './propModel'

export interface BagTarget {
  /** current bag (read-only, for display) */
  bag: ObjectsBag | undefined
  /** locate (creating if needed) the same bag inside a draft report */
  locate(report: ReportDocument): ObjectsBag | undefined
  /** resolved raw value (explicit → theme → undefined) for display */
  resolveRaw(object: string, prop: string, selector?: Selector): any
  /**
   * The value the renderer uses when the property is set nowhere (effective.ts) — shown instead of an empty control.
   * Takes precedence over the card definition's `default`.
   */
  defaults?(object: string, prop: string): Scalar | undefined
  theme: ResolvedTheme
  /** undo label */
  label: string
  /** visual context enabling conditional formatting (fx) on supported properties; absent for page formatting */
  cf?: CFContext
  /**
   * Called inside the edit, right before a property of `object` is written into `bag` (located in the draft). The
   * mobile-layout target uses it to seed a mobile override object from the desktop formatting (report/mobile/format.ts).
   */
  beforeWrite?(report: ReportDocument, bag: ObjectsBag, object: string): void
}

type RawOrFn = any | ((report: ReportDocument) => any)

/** `coalesce`: continuous edits (dragging a slider, holding a spin arrow) with the same key merge into one undo step. */
export function writeProp(target: BagTarget, object: string, prop: string, raw: RawOrFn, selector?: Selector, coalesce?: string): void {
  useApp.getState().mutateReport(
    target.label,
    (r) => {
      const bag = target.locate(r)
      if (!bag) return
      target.beforeWrite?.(r, bag, object)
      setRaw(bag, object, prop, typeof raw === 'function' ? raw(r) : raw, selector)
      // Lumen-only slicer options: drop default-valued props / the empty object so untouched reports stay byte-identical for PBI
      if (object === LUMEN_SLICER_OBJECT) normalizeLumenSlicer({ visual: { objects: bag } })
    },
    coalesce ? { coalesce } : undefined
  )
}

/** Clear several properties of one object in a single undo step (a card's "Reset to default"). */
export function resetProps(target: BagTarget, object: string, props: Array<{ name: string; selector?: Selector }>): void {
  useApp.getState().mutateReport('Reset to default', (r) => {
    const bag = target.locate(r)
    if (!bag) return
    for (const p of props) setRaw(bag, object, p.name, undefined, p.selector)
    if (object === LUMEN_SLICER_OBJECT) normalizeLumenSlicer({ visual: { objects: bag } })
  })
}

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const str = (s: string) => lit(`'${s.replace(/'/g, "''")}'`)
const num = (n: number) => lit(`${n}D`)
const bool = (b: boolean) => lit(String(b))
const color = (hex: string) => ({ solid: { color: str(hex) } })

function wrapFor(def: FormatPropDef, v: string | number | boolean): any {
  if (typeof v === 'boolean') return bool(v)
  if (typeof v === 'number') return num(v)
  if (def.type === 'color') return color(v)
  return str(v)
}

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }

async function pickImage(): Promise<((r: ReportDocument) => any) | null> {
  const paths = await window.wbi.dialog.openFile({ title: 'Open image', filters: [{ name: 'Images', extensions: Object.keys(IMAGE_MIME) }] })
  if (!paths?.[0]) return null
  const bytes = await window.wbi.fs.readFile(paths[0])
  const file = paths[0].split('/').pop() ?? 'image.png'
  const ext = (file.split('.').pop() ?? 'png').toLowerCase()
  const itemName = `${file.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '')}${Date.now().toString().slice(-8)}.${ext}`
  return (r) => {
    const path = `StaticResources/RegisteredResources/${itemName}`
    r.resources[path] = { path, bytes, mime: IMAGE_MIME[ext] }
    registerResource(r, itemName, 'Image')
    return { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: itemName } } }
  }
}

export interface PropRowProps {
  def: FormatPropDef
  object: string
  target: BagTarget
  selector?: Selector
  /** hide the label (e.g. the header toggle) */
  compact?: boolean
}

const coalesceKey = (target: BagTarget, object: string, prop: string, selector?: Selector) => `fmt:${target.cf?.pageName ?? ''}/${target.cf?.visualName ?? target.label}:${object}.${prop}:${selector ? JSON.stringify(selector) : ''}`

/** Case-insensitive match of a stored enum value against the card's options (PBIR files vary in casing). */
function enumValue(def: FormatPropDef, value: unknown): any {
  const opts = def.options ?? []
  if (opts.some((o) => o.value === value)) return value
  if (typeof value !== 'string') return value
  return opts.find((o) => typeof o.value === 'string' && o.value.toLowerCase() === value.toLowerCase())?.value ?? value
}

/** The control for one property (without label), plus what the row needs to know about it. */
function propEditor({ def, object, target, selector }: PropRowProps): { editor: ReactNode; explicit: boolean; reset(): void; value: any; set(v: string | number | boolean, continuous?: boolean): void } {
  const { explicit, raw, value } = propState(def, object, target, selector)
  const set = (v: string | number | boolean, continuous?: boolean) => writeProp(target, object, def.name, wrapFor(def, v), selector, continuous ? coalesceKey(target, object, def.name, selector) : undefined)
  const reset = () => writeProp(target, object, def.name, undefined, selector)

  const cfKind = cfKindFor(def, object, target.cf)
  const cfTarget = cfKind && target.cf ? propTarget(target.cf, object, def, cfKind, selector) : undefined
  const cfFound = cfTarget ? findCF(target.bag, cfTarget) : undefined

  let editor: ReactNode
  if (cfTarget && cfFound) {
    editor = <FxChip target={cfTarget} raw={cfFound.raw} />
  } else if (raw !== undefined && isDataBound(raw)) {
    // data-bound value we can't locate as an editable fx target (e.g. inherited from the theme)
    editor = <span className="wbi-fmt__bound">fx Conditional formatting applied</span>
  } else
    switch (def.type) {
      case 'bool':
        editor = <Toggle size="small" on={value === true} onChange={(on) => set(on)} />
        break
      case 'number':
      case 'integer':
      case 'fontSize':
        editor = (
          <SpinField
            label={def.displayName}
            value={typeof value === 'number' ? value : undefined}
            min={def.min}
            max={def.max}
            integer={def.type === 'integer'}
            unit={def.type === 'fontSize' ? 'pt' : undefined}
            onChange={(n, stepping) => (n === undefined ? reset() : set(n, stepping))}
          />
        )
        break
      case 'percent':
        editor = <PercentSlider label={def.displayName} value={typeof value === 'number' ? value : undefined} min={def.min ?? 0} max={def.max ?? 100} onChange={(n, sliding) => (n === undefined ? reset() : set(n, sliding))} />
        break
      case 'color':
        editor = (
          <ColorPicker
            value={typeof value === 'string' ? value : undefined}
            themeColors={target.theme}
            onChange={(hex, theme) => writeProp(target, object, def.name, theme ? themeColorRaw(theme.colorId, theme.percent) : color(hex), selector)}
            onReset={explicit ? reset : undefined}
            emptyTitle="Not set: the visual's default color applies"
          />
        )
        break
      case 'text':
        editor = <TextInput value={typeof value === 'string' ? value : value === undefined ? '' : String(value)} onCommit={(t) => (t === '' && !explicit ? undefined : set(t))} />
        break
      case 'textarea':
        editor = <TextInput multiline value={typeof value === 'string' ? value : ''} onCommit={(t) => set(t)} />
        break
      case 'enum':
        // nothing set anywhere and no known default: the visual decides → "Auto" (never an empty box)
        editor = <Dropdown size="small" placeholder="Auto" value={enumValue(def, value)} options={(def.options ?? []).map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => set(v as any)} />
        break
      case 'fontFamily': {
        const name = fontFamilyName(value) ?? 'Segoe UI'
        const options = FONT_FAMILIES.includes(name) ? FONT_FAMILIES : [name, ...FONT_FAMILIES]
        editor = <Dropdown size="small" title={name} value={name} options={options.map((f) => ({ value: f, label: f, fontFamily: fontFamilyValue(f) }))} onChange={(f) => set(fontFamilyValue(f))} />
        break
      }
      case 'alignment': {
        const cur = String(value ?? 'left').toLowerCase()
        editor = (
          <Segmented
            mode="radio"
            label={def.displayName}
            options={[
              { value: 'left', label: 'Left', icon: <TextAlignLeftRegular fontSize={16} /> },
              { value: 'center', label: 'Center', icon: <TextAlignCenterRegular fontSize={16} /> },
              { value: 'right', label: 'Right', icon: <TextAlignRightRegular fontSize={16} /> }
            ]}
            isOn={(a) => cur === a}
            onPick={(a) => set(a)}
          />
        )
        break
      }
      case 'displayUnits':
        editor = <Dropdown size="small" value={typeof value === 'number' ? value : 0} options={DISPLAY_UNITS as Array<{ value: number; label: string }>} onChange={(v) => set(v)} />
        break
      case 'image': {
        const has = value && typeof value === 'object' && 'resource' in (value as any)
        editor = (
          <button
            type="button"
            className="wbi-btn wbi-btn--small wbi-fmt__browse"
            title={has ? String((value as any).resource) : undefined}
            onClick={async () => {
              const fn = await pickImage()
              if (fn) writeProp(target, object, def.name, fn, selector)
            }}
          >
            <ImageAddRegular fontSize={14} /> <span>{has ? String((value as any).resource) : 'Browse…'}</span>
          </button>
        )
        break
      }
      default:
        editor = <span className="wbi-muted">{String(value ?? '')}</span>
    }
  if (cfTarget && !cfFound)
    editor = (
      <div className="wbi-fx-wrap">
        {editor}
        <FxButton target={cfTarget} />
      </div>
    )
  return { editor, explicit, reset, value, set }
}

function ResetButton({ name, onClick }: { name: string; onClick(): void }) {
  return (
    <Tip title="Reset to default">
      <button type="button" className="wbi-fmt__reset" aria-label={`Reset ${name}`} onClick={onClick}>
        <ArrowResetRegular fontSize={12} />
      </button>
    </Tip>
  )
}

export function PropRow(props: PropRowProps) {
  const { def, compact } = props
  const { editor, explicit, reset } = propEditor(props)
  return (
    <div className={cx('wbi-fmt__row', def.type === 'bool' && 'is-inline')} data-prop={def.name}>
      {!compact && (
        <div className="wbi-fmt__label">
          <span title={def.displayName}>{def.displayName}</span>
          {explicit && <ResetButton name={def.displayName} onClick={reset} />}
        </div>
      )}
      <div className="wbi-fmt__editor">{editor}</div>
    </div>
  )
}

/** PBI's "Font" row: family dropdown with the size spin box next to it. */
function FontRow({ family, size, object, target, selFor }: { family: FormatPropDef; size: FormatPropDef; object: string; target: BagTarget; selFor(p: FormatPropDef): Selector | undefined }) {
  const f = propEditor({ def: family, object, target, selector: selFor(family) })
  const z = propEditor({ def: size, object, target, selector: selFor(size) })
  return (
    <div className="wbi-fmt__row" data-props={`${family.name} ${size.name}`}>
      <div className="wbi-fmt__label">
        <span title={family.displayName}>{family.displayName}</span>
        {(f.explicit || z.explicit) && (
          <ResetButton
            name={family.displayName}
            onClick={() =>
              resetProps(target, object, [
                { name: family.name, selector: selFor(family) },
                { name: size.name, selector: selFor(size) }
              ])
            }
          />
        )}
      </div>
      <div className="wbi-fmt__font">
        <div className="wbi-fmt__editor" data-prop={family.name}>
          {f.editor}
        </div>
        <div className="wbi-fmt__editor wbi-fmt__fontsize" data-prop={size.name} title={size.displayName}>
          {z.editor}
        </div>
      </div>
    </div>
  )
}

const STYLE_ICONS: Record<string, ReactNode> = { bold: <TextBoldRegular fontSize={16} />, italic: <TextItalicRegular fontSize={16} />, underline: <TextUnderlineRegular fontSize={16} /> }

/** PBI's B / I / U buttons for adjacent bold / italic / underline switches. */
function StyleRow({ defs, object, target, selFor }: { defs: FormatPropDef[]; object: string; target: BagTarget; selFor(p: FormatPropDef): Selector | undefined }) {
  const states = defs.map((d) => ({ def: d, sel: selFor(d), on: propState(d, object, target, selFor(d)).value === true }))
  const byName = new Map(states.map((s) => [s.def.name, s]))
  return (
    <div className="wbi-fmt__row" data-props={defs.map((d) => d.name).join(' ')}>
      <Segmented
        mode="toggle"
        label="Font style"
        options={defs.map((d) => ({ value: d.name, label: d.displayName, icon: STYLE_ICONS[BIU.exec(d.name)![1].toLowerCase()] }))}
        propOf={(name) => name}
        isOn={(name) => byName.get(name)!.on}
        onPick={(name) => {
          const s = byName.get(name)!
          writeProp(target, object, name, bool(!s.on), s.sel)
        }}
      />
    </div>
  )
}

/** The rows of a list of properties, arranged like PBI (see layoutProps). */
export function PropRows({ defs, object, target, selFor }: { defs: FormatPropDef[]; object: string; target: BagTarget; selFor?(p: FormatPropDef): Selector | undefined }) {
  const sel = selFor ?? (() => undefined)
  // conditional formatting lives on single-property rows: keep those apart
  const fx = (d: FormatPropDef) => !!cfKindFor(d, object, target.cf)
  return (
    <>
      {layoutProps(defs).map((item) => {
        if (item.kind === 'font' && !fx(item.family) && !fx(item.size)) return <FontRow key={item.family.name} family={item.family} size={item.size} object={object} target={target} selFor={sel} />
        if (item.kind === 'style' && !item.defs.some(fx)) return <StyleRow key={item.defs[0].name} defs={item.defs} object={object} target={target} selFor={sel} />
        const list = item.kind === 'row' ? [item.def] : item.kind === 'font' ? [item.family, item.size] : item.defs
        return list.map((d) => <PropRow key={d.name} def={d} object={object} target={target} selector={sel(d)} />)
      })}
    </>
  )
}

/** Text input that commits on blur/Enter (keeps typing out of the undo stack). */
export function TextInput({ value, onCommit, multiline, placeholder }: { value: string; onCommit(v: string): void; multiline?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <TextField
      size="small"
      multiline={multiline}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={setDraft}
      onCommit={(v) => {
        setDraft(null)
        if (v !== value) onCommit(v)
      }}
    />
  )
}

export function matchesSearch(q: string, ...texts: Array<string | undefined>): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return texts.some((t) => t?.toLowerCase().includes(s))
}

export interface FormatCardViewProps {
  card: FormatCardDef
  target: BagTarget
  search: string
  /** series selector choices for perSeries props: queryRef → label */
  series?: Array<{ queryRef: string; label: string }>
  level?: 1 | 2
  defaultOpen?: boolean
}

export function FormatCardView({ card, target, search, series, level = 1, defaultOpen }: FormatCardViewProps) {
  const [seriesSel, setSeriesSel] = useState<string>('')
  const cardMatch = matchesSearch(search, card.displayName)
  const props = card.properties.filter((p) => p.name !== card.toggle && (cardMatch || matchesSearch(search, p.displayName)))
  if (!cardMatch && !props.length) return null
  const toggleDef = card.toggle ? card.properties.find((p) => p.name === card.toggle) : undefined
  const hasPerSeries = card.properties.some((p) => p.perSeries) && (series?.length ?? 0) > 0
  const selFor = (p: FormatPropDef): Selector | undefined => (p.perSeries && seriesSel ? { metadata: seriesSel } : undefined)
  let toggle: { on: boolean; onChange(on: boolean): void } | undefined
  if (card.toggle) {
    const v = propState(toggleDef ?? { name: card.toggle }, card.object, target).value
    toggle = { on: v === true, onChange: (on) => writeProp(target, card.object, card.toggle!, bool(on)) }
  }
  // PBI's "Reset to default" at the bottom of a card: everything this card set on the visual
  const explicit = card.properties.map((p) => ({ name: p.name, selector: selFor(p) })).filter((p) => getRaw(target.bag, card.object, p.name, p.selector) !== undefined)
  return (
    <CollapsibleCard title={card.displayName} toggle={toggle} level={level} defaultOpen={defaultOpen ?? !!search} key={search ? 'q' : 'n'}>
      {hasPerSeries && (
        <div className="wbi-fmt__row">
          <div className="wbi-fmt__label">
            <span>Series</span>
          </div>
          <Dropdown size="small" value={seriesSel} options={[{ value: '', label: 'All' }, ...series!.map((s) => ({ value: s.queryRef, label: s.label }))]} onChange={(v) => setSeriesSel(String(v))} />
        </div>
      )}
      <PropRows defs={props} object={card.object} target={target} selFor={selFor} />
      {explicit.length > 0 && (
        <button type="button" className="wbi-fmt__resetall" onClick={() => resetProps(target, card.object, explicit)}>
          <ArrowResetRegular fontSize={14} /> Reset to default
        </button>
      )}
    </CollapsibleCard>
  )
}

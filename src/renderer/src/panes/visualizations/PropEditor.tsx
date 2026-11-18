/**
 * Format-pane property editors: one row per FormatPropDef (toggle / number / color / text / enum /
 * font / alignment / display units / image), and a card view that renders a FormatCardDef with its
 * header toggle and optional per-series selector. Works on any PBIR objects bag through a BagTarget
 * (visual objects, visual container objects, page objects).
 */
import { useState, type ReactNode } from 'react'
import { LUMEN_SLICER_OBJECT, normalizeLumenSlicer } from '../../visuals/slicers/slicerFormat'
import { ArrowResetRegular, TextAlignLeftRegular, TextAlignCenterRegular, TextAlignRightRegular, ImageAddRegular } from '@fluentui/react-icons'
import { decodeValue, isDataBound, type ObjectsBag, type Selector } from '@core/report/props'
import type { ReportDocument } from '@core/report/types'
import type { ResolvedTheme } from '@core/report/theme'
import type { FormatCardDef, FormatPropDef } from '../../visuals/contract'
import { useApp } from '../../state/store'
import { registerResource } from '../../app/commands'
import { CollapsibleCard, ColorPicker, Dropdown, NumberField, Slider, TextField, Toggle, cx, Tip } from '../../app/ui'
import { getRaw, setRaw, themeColorRaw } from './objects'
import { DISPLAY_UNITS, FONT_FAMILIES, fontFamilyName, fontFamilyValue } from './containerCards'
import { cfKindFor, findCF, propTarget, type CFContext } from './cf/target'
import { FxButton, FxChip } from './cf/FxControls'

export interface BagTarget {
  /** current bag (read-only, for display) */
  bag: ObjectsBag | undefined
  /** locate (creating if needed) the same bag inside a draft report */
  locate(report: ReportDocument): ObjectsBag | undefined
  /** resolved raw value (explicit → theme → undefined) for display */
  resolveRaw(object: string, prop: string, selector?: Selector): any
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

export function writeProp(target: BagTarget, object: string, prop: string, raw: RawOrFn, selector?: Selector): void {
  useApp.getState().mutateReport(target.label, (r) => {
    const bag = target.locate(r)
    if (!bag) return
    target.beforeWrite?.(r, bag, object)
    setRaw(bag, object, prop, typeof raw === 'function' ? raw(r) : raw, selector)
    // Lumen-only slicer options: drop default-valued props / the empty object so untouched reports stay byte-identical for PBI
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

export function PropRow({ def, object, target, selector, compact }: PropRowProps) {
  const explicitRaw = getRaw(target.bag, object, def.name, selector)
  const explicit = explicitRaw !== undefined
  const raw = target.resolveRaw(object, def.name, selector)
  const decoded = raw === undefined ? undefined : decodeValue(raw, target.theme)
  const value = decoded === undefined || decoded === null ? def.default ?? undefined : decoded
  const set = (v: string | number | boolean) => writeProp(target, object, def.name, wrapFor(def, v), selector)
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
        editor = <Toggle size="small" on={value === true} onChange={set} />
        break
      case 'number':
      case 'integer':
      case 'fontSize':
        editor = <NumberField size="small" value={typeof value === 'number' ? value : undefined} min={def.min} max={def.max} onChange={(n) => (n === undefined ? reset() : set(def.type === 'integer' ? Math.round(n) : n))} suffix={def.type === 'fontSize' ? <span className="wbi-muted">pt</span> : undefined} />
        break
      case 'percent':
        editor = <Slider value={typeof value === 'number' ? value : 0} min={def.min ?? 0} max={def.max ?? 100} onChange={set} suffix="%" />
        break
      case 'color':
        editor = (
          <ColorPicker
            value={typeof value === 'string' ? value : undefined}
            themeColors={target.theme}
            onChange={(hex, theme) => writeProp(target, object, def.name, theme ? themeColorRaw(theme.colorId, theme.percent) : color(hex), selector)}
            onReset={explicit ? reset : undefined}
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
        editor = <Dropdown size="small" value={value as any} options={(def.options ?? []).map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => set(v as any)} />
        break
      case 'fontFamily': {
        const name = fontFamilyName(value) ?? 'Segoe UI'
        editor = <Dropdown size="small" value={name} options={FONT_FAMILIES.map((f) => ({ value: f, label: f, fontFamily: fontFamilyValue(f) }))} onChange={(f) => set(fontFamilyValue(f))} />
        break
      }
      case 'alignment': {
        const cur = String(value ?? 'left').toLowerCase()
        editor = (
          <div className="wbi-fmt__align" role="radiogroup">
            {(
              [
                ['left', <TextAlignLeftRegular key="l" />],
                ['center', <TextAlignCenterRegular key="c" />],
                ['right', <TextAlignRightRegular key="r" />]
              ] as const
            ).map(([a, icon]) => (
              <button key={a} type="button" role="radio" aria-checked={cur === a} aria-label={a} className={cx('wbi-fmt__alignbtn', cur === a && 'is-on')} onClick={() => set(a)}>
                {icon}
              </button>
            ))}
          </div>
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
            className="wbi-btn wbi-btn--small"
            onClick={async () => {
              const fn = await pickImage()
              if (fn) writeProp(target, object, def.name, fn, selector)
            }}
          >
            <ImageAddRegular fontSize={14} /> {has ? String((value as any).resource) : 'Browse…'}
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

  return (
    <div className={cx('wbi-fmt__row', def.type === 'bool' && 'is-inline')} data-prop={def.name}>
      {!compact && (
        <div className="wbi-fmt__label">
          <span>{def.displayName}</span>
          {explicit && (
            <Tip title="Reset to default">
              <button type="button" className="wbi-fmt__reset" aria-label={`Reset ${def.displayName}`} onClick={reset}>
                <ArrowResetRegular fontSize={12} />
              </button>
            </Tip>
          )}
        </div>
      )}
      <div className="wbi-fmt__editor">{editor}</div>
    </div>
  )
}

/** Text input that commits on blur/Enter (keeps typing out of the undo stack). */
export function TextInput({ value, onCommit, multiline }: { value: string; onCommit(v: string): void; multiline?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <TextField
      size="small"
      multiline={multiline}
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
    const raw = target.resolveRaw(card.object, card.toggle)
    const v = raw === undefined ? toggleDef?.default : decodeValue(raw, target.theme)
    toggle = { on: v === true, onChange: (on) => writeProp(target, card.object, card.toggle!, bool(on)) }
  }
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
      {props.map((p) => (
        <PropRow key={p.name} def={p} object={card.object} target={target} selector={selFor(p)} />
      ))}
    </CollapsibleCard>
  )
}

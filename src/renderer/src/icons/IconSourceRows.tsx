/**
 * Format pane rows for image slots that can show a Lumen icon (FormatPropDef type 'iconSource').
 *
 *   image visual  "Source: Image file | Icon" (+ Browse… for a file, or the icon rows)
 *   card images   the slot's own "Image source" dropdown gains "Icon"; while an icon is shown the URL row is hidden
 *
 * Icon rows: the icon (opens the picker), colour and stroke width (single-colour sets), padding, remove.
 * Edits bake the icon into the visual (icons/actions.ts → core/icons/bake.ts) in one undo step each.
 */
import type { ReactNode } from 'react'
import { DismissRegular, ImageAddRegular } from '@fluentui/react-icons'
import { activeIcon, imageVisualItem, removeIcon, type IconBinding, type IconSlot } from '@core/icons/bake'
import { ICON_SETS } from '@core/icons/sets'
import { iconTitle } from '@core/icons/ref'
import type { IconRef } from '@core/icons/types'
import type { Selector } from '@core/report/props'
import type { FormatPropDef } from '../visuals/contract'
import { useApp } from '../state/store'
import { findPage, findVisual } from '../report/pbir'
import { Dropdown, cx } from '../app/ui'
import { SpinField } from '../panes/visualizations/controls'
import { setRaw } from '../panes/visualizations/objects'
import type { BagTarget } from '../panes/visualizations/PropEditor'
import { openIconPicker, StyleControls } from './IconPicker'
import { IconGlyph } from './IconGlyph'
import { clearVisualIcon, setVisualIcon } from './actions'

export const ICON_OPTION = '__lumenIcon'

export function slotOf(def: FormatPropDef, selector?: Selector): IconSlot | undefined {
  if (!def.icon) return undefined
  return { object: def.icon.object, property: def.icon.property, form: def.icon.form, ...(selector && Object.keys(selector).length ? { selector } : {}) }
}

/** The visual a Format pane target edits, when icons can be edited there (desktop visual formatting only). */
function useTargetVisual(target: BagTarget): { pageName: string; visualName: string; json: any } | undefined {
  const report = useApp((s) => s.project?.report)
  const cf = target.cf
  // mobile formatting (beforeWrite) edits mobile.json; icons live in the desktop visual
  if (!cf || cf.container || target.beforeWrite) return undefined
  const v = findVisual(findPage(report, cf.pageName), cf.visualName)
  return v ? { pageName: cf.pageName, visualName: cf.visualName, json: v.json } : undefined
}

export function useSlotIcon(target: BagTarget, def: FormatPropDef | undefined, selector?: Selector): { binding?: IconBinding; slot?: IconSlot; visual?: ReturnType<typeof useTargetVisual> } {
  const report = useApp((s) => s.project?.report)
  const visual = useTargetVisual(target)
  const slot = def ? slotOf(def, selector) : undefined
  const binding = report && visual && slot ? activeIcon(report, visual.json, slot) : undefined
  return { binding, slot, visual }
}

function Row({ label, prop, children }: { label: string; prop: string; children: ReactNode }) {
  return (
    <div className="wbi-fmt__row" data-prop={prop}>
      <div className="wbi-fmt__label">
        <span title={label}>{label}</span>
      </div>
      <div className="wbi-fmt__editor">{children}</div>
    </div>
  )
}

async function chooseIcon(visual: { pageName: string; visualName: string }, slot: IconSlot, initial?: IconRef): Promise<void> {
  const ref = await openIconPicker({ initial, title: initial ? 'Change icon' : 'Choose an icon', confirmLabel: 'Select' })
  if (ref) await setVisualIcon(visual.pageName, visual.visualName, slot, ref, { label: initial ? 'Change icon' : 'Use icon' })
}

/** The icon's own rows (shown while the slot holds an icon). */
function IconRows({ binding, slot, visual, theme }: { binding: IconBinding; slot: IconSlot; visual: { pageName: string; visualName: string }; theme: ReturnType<typeof useApp.getState>['theme'] }) {
  const icon = binding.icon
  const key = `icon:${visual.pageName}/${visual.visualName}:${slot.object}`
  const update = (patch: Partial<IconRef>, continuous = false) => void setVisualIcon(visual.pageName, visual.visualName, slot, { ...icon, ...patch }, { label: 'Format icon', coalesce: continuous ? key : undefined })
  return (
    <div className="wbi-iconsrc" data-icon={`${icon.set}:${icon.name}`}>
      <Row label="Icon" prop="lumenIcon">
        <button type="button" className="wbi-iconsrc__pick" onClick={() => void chooseIcon(visual, slot, icon)} aria-label={`Icon: ${iconTitle(icon.name)}. Change icon`}>
          <span className="wbi-iconsrc__thumb">
            <IconGlyph icon={icon} theme={theme} />
          </span>
          <span className="wbi-iconsrc__text">
            <span className="wbi-iconsrc__title">{iconTitle(icon.name)}</span>
            <span className="wbi-iconsrc__meta">{ICON_SETS[icon.set].label}</span>
          </span>
        </button>
      </Row>
      <StyleControls compact style={icon} theme={theme} onChange={(p) => update(p, 'strokeWidth' in p)} />
      <Row label="Padding (%)" prop="lumenIconPadding">
        <SpinField label="Padding (%)" value={icon.padding ?? 0} min={0} max={40} integer onChange={(n, stepping) => update({ padding: n ?? 0 }, stepping)} />
      </Row>
      <div className="wbi-iconsrc__note">
        Saved with a picture of the icon that Power BI shows as an image; Lumen keeps the icon editable.{' '}
        <button type="button" className="wbi-link" onClick={() => clearVisualIcon(visual.pageName, visual.visualName, slot)}>
          <DismissRegular fontSize={11} /> Remove icon
        </button>
      </div>
    </div>
  )
}

/**
 * The 'iconSource' row. With a `typeProp` (cards) it only adds the icon rows while an icon is shown (the source
 * dropdown is IconTypeRow); without (image visual) it is the source dropdown itself.
 */
export function IconSourceRows({ def, target, selector, pickImage }: { def: FormatPropDef; target: BagTarget; selector?: Selector; pickImage(): Promise<((r: any) => any) | null> }) {
  const theme = useApp((s) => s.theme)
  const { binding, slot, visual } = useSlotIcon(target, def, selector)
  if (!slot || !visual) return null
  if (def.icon?.typeProp) return binding ? <IconRows binding={binding} slot={slot} visual={visual} theme={theme} /> : null
  const fileName = !binding ? imageVisualItem(visual.json) : undefined
  const browse = async () => {
    const fn = await pickImage()
    if (!fn) return
    useApp.getState().mutateReport('Change image', (r) => {
      const v = findVisual(findPage(r, visual.pageName), visual.visualName)
      if (!v) return
      removeIcon(r, v.json, slot)
      const raw = fn(r)
      v.json.visual.objects ??= {}
      setRaw(v.json.visual.objects, slot.object, slot.property, raw, slot.selector)
    })
  }
  return (
    <>
      <Row label={def.displayName} prop={def.name}>
        <Dropdown
          size="small"
          value={binding ? 'icon' : 'image'}
          options={[
            { value: 'image', label: 'Image file' },
            { value: 'icon', label: 'Icon' }
          ]}
          onChange={(v) => {
            if (v === 'icon' && !binding) void chooseIcon(visual, slot)
            if (v === 'image' && binding) void browse()
          }}
        />
      </Row>
      {binding ? (
        <IconRows binding={binding} slot={slot} visual={visual} theme={theme} />
      ) : (
        <Row label="Image" prop="lumenImageFile">
          <button type="button" className={cx('wbi-btn wbi-btn--small wbi-fmt__browse')} title={fileName} onClick={() => void browse()}>
            <ImageAddRegular fontSize={14} /> <span>{fileName ?? 'Browse…'}</span>
          </button>
        </Row>
      )}
    </>
  )
}

/** A card's "Image source" dropdown with an extra "Icon" entry (shown selected while the slot holds an icon). */
export function IconTypeRow({ typeDef, iconDef, target, selector, value, onSet }: { typeDef: FormatPropDef; iconDef: FormatPropDef; target: BagTarget; selector?: Selector; value: unknown; onSet(v: string): void }) {
  const { binding, slot, visual } = useSlotIcon(target, iconDef, selector)
  const options = [...(typeDef.options ?? []).map((o) => ({ value: String(o.value), label: o.label })), ...(slot && visual ? [{ value: ICON_OPTION, label: 'Icon' }] : [])]
  const cur = binding ? ICON_OPTION : typeof value === 'string' ? (options.find((o) => o.value.toLowerCase() === value.toLowerCase())?.value ?? value) : undefined
  return (
    <Row label={typeDef.displayName} prop={typeDef.name}>
      <Dropdown
        size="small"
        placeholder="Auto"
        value={cur}
        options={options}
        onChange={(v) => {
          if (!slot || !visual) return onSet(v)
          if (v === ICON_OPTION) {
            if (!binding) void chooseIcon(visual, slot)
            return
          }
          if (binding) {
            // leaving the icon: clear the baked data URI so the URL / data choice starts empty
            useApp.getState().mutateReport('Change image source', (r) => {
              const vis = findVisual(findPage(r, visual.pageName), visual.visualName)
              if (!vis) return
              removeIcon(r, vis.json, slot)
              vis.json.visual.objects ??= {}
              setRaw(vis.json.visual.objects, slot.object, typeDef.name, { expr: { Literal: { Value: `'${v}'` } } }, slot.selector)
            })
            return
          }
          onSet(v)
        }}
      />
    </Row>
  )
}

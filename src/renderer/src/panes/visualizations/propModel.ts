/**
 * Format-pane display model (pure, unit-tested in propModel.test.ts): the effective value a control shows for a
 * property, and how a card's properties are arranged into rows.
 */
import type { Scalar } from '@core/model/data'
import { decodeValue, type ObjectsBag, type Selector } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import type { FormatPropDef } from '../../visuals/contract'
import { getRaw } from './objects'

/** The part of a BagTarget (PropEditor.tsx) that reading a property needs. */
export interface PropSource {
  bag: ObjectsBag | undefined
  resolveRaw(object: string, prop: string, selector?: Selector): any
  defaults?(object: string, prop: string): Scalar | undefined
  theme: ResolvedTheme
}

export interface PropState {
  /** set on the visual / page itself (not inherited from the theme) */
  explicit: boolean
  /** resolved raw value: explicit → theme */
  raw: any
  /** what the control shows: explicit → theme → renderer default → card default; undefined = automatic */
  value: any
}

/** Display state of one property — the *effective* value, so an unset property doesn't show as an empty control. */
export function propState(def: Pick<FormatPropDef, 'name' | 'default'>, object: string, target: PropSource, selector?: Selector): PropState {
  const explicit = getRaw(target.bag, object, def.name, selector) !== undefined
  const raw = target.resolveRaw(object, def.name, selector)
  const decoded = raw === undefined ? undefined : decodeValue(raw, target.theme)
  const fallback = target.defaults?.(object, def.name) ?? def.default ?? undefined
  return { explicit, raw, value: decoded === undefined || decoded === null ? fallback : decoded }
}

export const BIU = /(bold|italic|underline)$/i

export type PropLayoutItem = { kind: 'row'; def: FormatPropDef } | { kind: 'font'; family: FormatPropDef; size: FormatPropDef } | { kind: 'style'; defs: FormatPropDef[] }

/** What a font property is the family / size of: 'titleFontFamily' → 'title', 'fontSize' / 'textSize' → ''. */
const fontStem = (name: string) => name.replace(/(font|text)?(family|face|size)$/i, '').toLowerCase()

/**
 * Arrange a card's properties like PBI: a font family directly followed by the size of the same text share one "Font"
 * row, and adjacent Bold / Italic / Underline switches become one B I U button group. Everything else keeps one row per
 * property (a size that belongs to another text — "Header text size" before "Font" — stays on its own labelled row).
 */
export function layoutProps(defs: FormatPropDef[]): PropLayoutItem[] {
  const out: PropLayoutItem[] = []
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]
    const next = defs[i + 1]
    if (next && d.type === 'fontFamily' && next.type === 'fontSize' && fontStem(d.name) === fontStem(next.name)) {
      out.push({ kind: 'font', family: d, size: next })
      i++
      continue
    }
    if (d.type === 'bool' && BIU.test(d.name)) {
      const run = [d]
      while (defs[i + run.length]?.type === 'bool' && BIU.test(defs[i + run.length].name) && !run.some((r) => BIU.exec(r.name)![1].toLowerCase() === BIU.exec(defs[i + run.length].name)![1].toLowerCase())) run.push(defs[i + run.length])
      if (run.length > 1) {
        out.push({ kind: 'style', defs: run })
        i += run.length - 1
        continue
      }
    }
    out.push({ kind: 'row', def: d })
  }
  return out
}

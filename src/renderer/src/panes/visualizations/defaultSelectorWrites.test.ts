/**
 * Every Format pane property of every registered visual, on a visual whose objects carry `selector: { id: 'default' }`
 * (what current Power BI writes for the new card and other new-format visuals): an edit through the pane's write path
 * (objects.ts setRaw, the core of PropEditor writeProp) must change what the visual reads, not land in a second,
 * selector-less entry behind the one the visual reads. Clearing must not leave the old value showing either.
 *
 * Readers: the new card resolves every format property through CardProps (cardProps.ts); every other visual through
 * core/report/props rawProp / getProp. Both are checked (the card with both).
 */
import { describe, expect, it } from 'vitest'
import { makePropContext, rawProp } from '@core/report/props'
import { resolveTheme } from '@core/report/theme'
import { allVisuals } from '../../visuals'
import { CardProps } from '../../visuals/cards/cardProps'
import { getRaw, setRaw } from './objects'
import { propState } from './propModel'
import { findCF, propTarget, writeCF } from './cf/target'

const theme = resolveTheme()
const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const OLD = lit("'old-value'")
const NEW = lit("'new-value'")

function fixture(visualType: string, container: boolean, object: string, prop: string, selector: any = { id: 'default' }) {
  const bag = { [object]: [{ properties: { [prop]: OLD, keep: lit('1L') }, selector }] }
  const json: any = { name: 'v', visual: { visualType, ...(container ? { visualContainerObjects: bag } : { objects: bag }) } }
  return { json, bag }
}

const cases = allVisuals().flatMap((def) =>
  def.formatCards.flatMap((card) =>
    card.properties.filter((p) => p.type !== 'iconSource').map((p) => ({ visualType: def.type, container: !!card.container, object: card.object, prop: p.name }))
  )
)

describe('Format pane writes on `{ id: "default" }` entries reach the reader', () => {
  it('covers the registry', () => {
    expect(cases.length).toBeGreaterThan(500)
    expect(cases.some((c) => c.visualType === 'cardVisual' && c.object === 'image' && c.prop === 'imageType')).toBe(true)
  })

  it('set: every property of every visual', () => {
    const failed: string[] = []
    for (const c of cases) {
      const { json, bag } = fixture(c.visualType, c.container, c.object, c.prop)
      setRaw(bag, c.object, c.prop, NEW, undefined)
      const pc = makePropContext(json, theme)
      const ok =
        bag[c.object].length === 1 &&
        rawProp(pc, c.object, c.prop) === NEW &&
        (c.visualType !== 'cardVisual' || c.container || new CardProps(json, theme).raw(c.object, c.prop) === NEW) &&
        propState({ name: c.prop }, c.object, { bag, theme, resolveRaw: (o, p, s) => rawProp(pc, o, p, s) }).explicit
      if (!ok) failed.push(`${c.visualType} ${c.container ? 'container ' : ''}${c.object}.${c.prop}`)
    }
    expect(failed).toEqual([])
  })

  it('clear (Reset to default): the stored value is gone, the entry keeps its other properties', () => {
    const failed: string[] = []
    for (const c of cases) {
      const { json, bag } = fixture(c.visualType, c.container, c.object, c.prop)
      setRaw(bag, c.object, c.prop, undefined, undefined)
      const pc = makePropContext(json, theme)
      const r = rawProp(pc, c.object, c.prop)
      const ok = r !== OLD && getRaw(bag, c.object, c.prop) === undefined && bag[c.object]?.[0]?.properties.keep !== undefined && (c.visualType !== 'cardVisual' || c.container || new CardProps(json, theme).raw(c.object, c.prop) !== OLD)
      if (!ok) failed.push(`${c.visualType} ${c.object}.${c.prop}`)
    }
    expect(failed).toEqual([])
  })

  it('a per-series edit reaches a `{ metadata, id: "default" }` entry of that series', () => {
    const sel = { metadata: 'Sales.Amount', id: 'default' }
    const { json, bag } = fixture('cardVisual', false, 'value', 'fontSize', sel)
    setRaw(bag, 'value', 'fontSize', NEW, { metadata: 'Sales.Amount' })
    expect(bag.value).toHaveLength(1)
    expect(new CardProps(json, theme).raw('value', 'fontSize', { metadata: 'Sales.Amount' })).toBe(NEW)
  })

  it('a stray selector-less entry behind the `{ id: "default" }` one is folded in by the next edit', () => {
    const bag: any = {
      image: [
        { properties: { imageType: lit("'imageData'"), padding: lit('0L') }, selector: { id: 'default' } },
        { properties: { imageType: lit("'imageUrl'") } }
      ]
    }
    const json = { visual: { visualType: 'cardVisual', objects: bag } }
    setRaw(bag, 'image', 'imageType', lit("'imageUrl'"))
    expect(bag.image).toEqual([{ properties: { imageType: lit("'imageUrl'"), padding: lit('0L') }, selector: { id: 'default' } }])
    expect(new CardProps(json, theme).str('image', 'imageType', '')).toBe('imageUrl')
  })

  it('other selectors stay separate: a state, a series, a data point', () => {
    const bag: any = {
      fillCustom: [
        { properties: { fillColor: OLD }, selector: { id: 'default' } },
        { properties: { fillColor: OLD }, selector: { id: 'interaction:hover' } }
      ]
    }
    setRaw(bag, 'fillCustom', 'fillColor', NEW, { id: 'interaction:hover' })
    setRaw(bag, 'fillCustom', 'fillColor', NEW, { metadata: 'm' })
    expect(bag.fillCustom.map((e: any) => [e.selector, e.properties.fillColor === NEW])).toEqual([
      [{ id: 'default' }, false],
      [{ id: 'interaction:hover' }, true],
      [{ metadata: 'm' }, true]
    ])
  })

  it('conditional formatting (fx) stored in a `{ id: "default" }` entry is found, replaced and removed there', () => {
    const measure = (name: string) => ({ solid: { color: { expr: { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: name } } } } })
    const bag: any = { fillCustom: [{ properties: { fillColor: measure('Old Color'), show: lit('true') }, selector: { id: 'default' } }] }
    const json = { visual: { visualType: 'cardVisual', objects: bag } }
    const t = propTarget({ pageName: 'p', visualName: 'v', visualType: 'cardVisual', container: false }, 'fillCustom', { name: 'fillColor', displayName: 'Color', type: 'color' }, 'color')
    expect(findCF(bag, t)?.raw).toEqual(measure('Old Color'))
    writeCF(bag, t, measure('New Color'))
    expect(bag.fillCustom).toHaveLength(1)
    expect(new CardProps(json, theme).raw('fillCustom', 'fillColor')).toEqual(measure('New Color'))
    writeCF(bag, t, undefined)
    expect(bag.fillCustom).toEqual([{ properties: { show: lit('true') }, selector: { id: 'default' } }])
  })
})

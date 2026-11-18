import { describe, expect, it } from 'vitest'
import { entryGroupKey, primaryEntry, readEntryProp, sameEntryGroup, writeEntryProp } from '../entries'
import { makePropContext, rawProp, setObjectProp, type ObjectsBag } from '../props'
import { resolveTheme } from '../theme'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })

describe('objects-bag entry groups', () => {
  it('`id: "default"` is the default entry; other ids, series and data selectors are their own groups', () => {
    expect(entryGroupKey(undefined)).toBe('')
    expect(entryGroupKey({})).toBe('')
    expect(entryGroupKey({ id: 'default' })).toBe('')
    expect(sameEntryGroup({ metadata: 'm', id: 'default' }, { metadata: 'm' })).toBe(true)
    expect(sameEntryGroup({ id: 'interaction:hover' }, undefined)).toBe(false)
    expect(sameEntryGroup({ metadata: 'm' }, undefined)).toBe(false)
    expect(sameEntryGroup({ data: [{ dataViewWildcard: { matchingOption: 1 } }] }, undefined)).toBe(false)
  })

  it('writes go to the first entry of the group; later copies are folded in; new entries keep the requested selector', () => {
    const bag: ObjectsBag = {
      labels: [
        { properties: { a: lit('1L') }, selector: { id: 'default' } },
        { properties: { a: lit('2L'), b: lit('3L') } }
      ]
    }
    expect(readEntryProp(bag, 'labels', 'a')).toEqual(lit('1L'))
    writeEntryProp(bag, 'labels', 'b', lit('4L'))
    expect(bag.labels).toEqual([{ properties: { a: lit('1L'), b: lit('4L') }, selector: { id: 'default' } }, { properties: { a: lit('2L') } }])
    writeEntryProp(bag, 'labels', 'a', lit('5L'))
    expect(bag.labels).toEqual([{ properties: { a: lit('5L'), b: lit('4L') }, selector: { id: 'default' } }])
    writeEntryProp(bag, 'labels', 'a', lit('6L'), { metadata: 'm' })
    expect(bag.labels[1]).toEqual({ properties: { a: lit('6L') }, selector: { metadata: 'm' } })
    expect(primaryEntry(bag, 'labels', { id: 'default' })).toBe(bag.labels[0])
  })

  it('clearing removes the property from every entry of the group, dropping empty entries and objects', () => {
    const bag: ObjectsBag = { labels: [{ properties: { a: lit('1L') }, selector: { id: 'default' } }, { properties: { a: lit('2L') } }] }
    writeEntryProp(bag, 'labels', 'a', undefined)
    expect(bag.labels).toBeUndefined()
  })

  it('setObjectProp (visual state persisted by visuals) follows the same rule', () => {
    const json: any = { visual: { visualType: 'slicer', objects: { data: [{ properties: { mode: lit("'Basic'") }, selector: { id: 'default' } }] } } }
    setObjectProp(json, 'data', 'mode', 'Dropdown')
    expect(json.visual.objects.data).toHaveLength(1)
    expect(rawProp(makePropContext(json, resolveTheme()), 'data', 'mode')).toEqual(lit("'Dropdown'"))
  })
})

import { describe, expect, it } from 'vitest'
import { ICON_SETS, curatedAll, curatedIcons, BUSINESS_GROUPS, listIcons, loadIconSet, searchIcons, setCategories, variantsOf } from '../registry'
import { ICON_SET_IDS, type IconSetData, type IconSetId } from '../types'
import { iconBody } from '../svg'

const sets = {} as Record<IconSetId, IconSetData>

describe('icon registry', () => {
  it('loads every set on demand', async () => {
    for (const id of ICON_SET_IDS) {
      sets[id] = await loadIconSet(id)
      expect(sets[id].set).toBe(id)
      expect(Object.keys(sets[id].icons).length).toBeGreaterThan(1000)
    }
    // the same object on a second load (cached)
    expect(await loadIconSet('tabler')).toBe(sets.tabler)
  })

  it('reports counts per set and variant', () => {
    const counts: Record<string, number> = {}
    for (const id of ICON_SET_IDS) {
      counts[id] = listIcons(sets[id]).length
      for (const v of ICON_SETS[id].variants) counts[`${id}/${v.id}`] = listIcons(sets[id], v.id).length
    }
    // the artwork of each library as packaged (lower bounds, so upstream additions do not fail the test)
    expect(counts['fluent/regular']).toBeGreaterThan(2500)
    expect(counts['fluent/filled']).toBeGreaterThan(2500)
    expect(counts['fluent/color']).toBeGreaterThan(150)
    for (const w of ['thin', 'light', 'regular', 'bold', 'fill', 'duotone']) expect(counts[`phosphor/${w}`]).toBeGreaterThan(1400)
    expect(counts['tabler/outline']).toBeGreaterThan(5000)
    expect(counts['tabler/filled']).toBeGreaterThan(1000)
    for (const t of ['outline', 'filled', 'two-tone', 'multi-color']) expect(counts[`iconpark/${t}`]).toBeGreaterThan(2500)
    console.info('[icons] counts', JSON.stringify(counts))
  })

  it('ids are stable set:name pairs, every listed icon has a body in each of its variants', () => {
    for (const id of ICON_SET_IDS) {
      const items = listIcons(sets[id])
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
      for (const it of items.slice(0, 500)) {
        expect(it.id).toBe(`${id}:${it.name}`)
        expect(it.name).toMatch(/^[a-z0-9][a-z0-9-]*$/)
        for (const v of variantsOf(sets[id], it.name)) expect(iconBody(sets[id], it.name, v)).toBeTruthy()
      }
    }
    // well-known names keep their id across releases
    expect(sets.tabler.icons['chart-bar']).toBeDefined()
    expect(sets.phosphor.icons['chart-line-up']).toBeDefined()
    expect(sets.fluent.icons['data-bar-vertical']).toBeDefined()
    expect(sets.iconpark.icons['wallet']).toBeDefined()
    expect(variantsOf(sets.phosphor, 'chart-line-up')).toEqual(['thin', 'light', 'regular', 'bold', 'fill', 'duotone'])
    expect(variantsOf(sets.tabler, 'chart-pie')).toEqual(['outline', 'filled'])
  })

  it('searches by name, keyword (synonym) and category', () => {
    expect(searchIcons(sets.tabler, 'chart bar')[0]).toBe('chart-bar')
    expect(searchIcons(sets.tabler, 'currency-dollar')[0]).toBe('currency-dollar')
    // "money" finds currency / cash icons by synonym
    const money = searchIcons(sets.phosphor, 'money')
    expect(money.some((n) => n.includes('currency') || n.includes('coin'))).toBe(true)
    // IconPark categories are searchable
    expect(searchIcons(sets.iconpark, 'charts').length).toBeGreaterThan(20)
    // variant filter
    expect(searchIcons(sets.fluent, 'data bar', { variant: 'color' }).every((n) => variantsOf(sets.fluent, n).includes('color'))).toBe(true)
    expect(searchIcons(sets.tabler, 'zzqqxx')).toEqual([])
  })

  it('curated Business & dashboards groups are non-empty in every set and resolve to icons', () => {
    const sizes: Record<string, number> = {}
    for (const id of ICON_SET_IDS) {
      const cur = curatedIcons(sets[id])
      for (const g of BUSINESS_GROUPS) {
        expect(cur[g.id].length, `${id}/${g.id}`).toBeGreaterThan(0)
        for (const name of cur[g.id]) expect(sets[id].icons[name], `${id}:${name}`).toBeDefined()
      }
      sizes[id] = curatedAll(sets[id]).length
    }
    console.info('[icons] curated', JSON.stringify(sizes), 'total', Object.values(sizes).reduce((a, b) => a + b, 0))
    // spot checks of the reviewed keyword lists
    expect(curatedIcons(sets.tabler).charts).toContain('chart-bar')
    expect(curatedIcons(sets.tabler).money).toContain('currency-dollar')
    expect(curatedIcons(sets.tabler).charts).not.toContain('chart-bar-off')
    expect(curatedIcons(sets.fluent).charts).toContain('data-bar-vertical')
    expect(curatedIcons(sets.iconpark).money).toContain('wallet')
  })

  it('IconPark exposes its own categories', () => {
    const cats = setCategories(sets.iconpark)
    expect(cats.map((c) => c.label)).toContain('Charts')
    expect(cats.every((c) => c.names.length > 0)).toBe(true)
  })
})

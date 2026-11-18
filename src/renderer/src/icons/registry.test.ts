import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUSINESS_GROUPS, curatedAll, curatedIcons } from '@core/icons/curated'
import { ICON_SETS } from '@core/icons/sets'
import { ICON_SET_IDS, type IconSetId } from '@core/icons/types'
import { getLoadedIconSet, iconComponent, loadIconSet, searchIcons, setFromModule, type LoadedIconSet } from './registry'
// @ts-expect-error plain JS build script
import { BARREL_PATH, fluentColorBarrel } from '../../../../scripts/icons/gen-fluent-color.mjs'

const sets = {} as Record<IconSetId, LoadedIconSet>

describe('icon registry (React component sets)', () => {
  it('loads every set on demand, once', async () => {
    for (const id of ICON_SET_IDS) {
      expect(getLoadedIconSet(id)).toBeUndefined()
      sets[id] = await loadIconSet(id)
      expect(sets[id].id).toBe(id)
      expect(await loadIconSet(id)).toBe(sets[id])
    }
    expect(sets.lucide.kind).toBe('react-icons')
    expect(sets['fluent-color'].kind).toBe('fluent')
  })

  it('counts: every Lucide component of react-icons/lu, every unsized Fluent *Color component', () => {
    const counts = Object.fromEntries(ICON_SET_IDS.map((id) => [id, sets[id].names.length]))
    // lower bounds, so upstream additions do not fail the test
    expect(counts.lucide).toBeGreaterThan(1500)
    expect(counts['fluent-color']).toBeGreaterThan(190)
    const curated = Object.fromEntries(ICON_SET_IDS.map((id) => [id, curatedAll(sets[id].names).length]))
    console.info('[icons] counts', JSON.stringify(counts), 'curated', JSON.stringify(curated))
  })

  it('ids are stable set:name pairs: unique, kebab-case, and known names resolve to the library components', async () => {
    for (const id of ICON_SET_IDS) {
      const names = sets[id].names
      expect(new Set(names).size).toBe(names.length)
      for (const n of names) expect(n).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect([...names]).toEqual([...names].sort())
    }
    const lu = await import('react-icons/lu')
    expect(iconComponent('lucide', 'chart-column')).toBe(lu.LuChartColumn)
    expect(iconComponent('lucide', 'trending-up')).toBe(lu.LuTrendingUp)
    expect(iconComponent('lucide', 'circle-dollar-sign')).toBe(lu.LuCircleDollarSign)
    const fc = await import('@fluentui/react-icons/svg/data-pie')
    expect(iconComponent('fluent-color', 'data-pie')).toBe(fc.DataPieColor)
    // only the *Color components: no Regular / Filled / sized variants
    expect(iconComponent('fluent-color', 'data-pie-24')).toBeUndefined()
    expect(sets['fluent-color'].names.some((n) => /-(regular|filled|\d+)$/.test(n))).toBe(false)
    // non-component exports are ignored
    expect(setFromModule('lucide', { LuX: () => null, default: {}, helper: 1 }).names).toEqual(['x'])
  })

  it('every curated id resolves to a component; every group has icons in Lucide', () => {
    for (const id of ICON_SET_IDS) {
      const groups = curatedIcons(sets[id].names)
      for (const names of Object.values(groups)) for (const n of names) expect(iconComponent(id, n), `${id}:${n}`).toBeDefined()
    }
    const lu = curatedIcons(sets.lucide.names)
    for (const g of BUSINESS_GROUPS) expect(lu[g.id].length, g.id).toBeGreaterThan(5)
    const fc = curatedIcons(sets['fluent-color'].names)
    expect(fc.charts).toEqual(expect.arrayContaining(['data-bar-vertical-ascending', 'data-pie', 'data-trending']))
  })

  it('search finds business words in both sets', () => {
    expect(searchIcons(sets.lucide, 'trending up')[0]).toBe('trending-up')
    expect(searchIcons(sets.lucide, 'money')).toEqual(expect.arrayContaining(['banknote', 'wallet']))
    expect(searchIcons(sets['fluent-color'], 'people')).toContain('people-team')
    expect(searchIcons(sets['fluent-color'], 'chart')).toEqual(expect.arrayContaining(['chart-multiple', 'data-pie']))
  })

  it('metadata exists for every set', () => {
    for (const id of ICON_SET_IDS) expect(ICON_SETS[id].label).toBeTruthy()
    expect(ICON_SETS.lucide.colorable && ICON_SETS.lucide.stroke).toBeTruthy()
    expect(ICON_SETS['fluent-color'].colorable).toBe(false)
  })

  it('the generated Fluent Color barrel matches the installed @fluentui/react-icons (node scripts/icons/gen-fluent-color.mjs)', () => {
    expect(readFileSync(BARREL_PATH, 'utf8')).toBe(fluentColorBarrel())
  })
})

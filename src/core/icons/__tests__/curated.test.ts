import { describe, expect, it } from 'vitest'
import { BUSINESS_GROUPS, curatedAll, curatedGroupsOf, curatedIcons, curatedInGroupOrder } from '../curated'
import { searchIconNames } from '../search'
import { componentIconName, iconTitle } from '../ref'

describe('curated "Business & dashboards" (pure, over names)', () => {
  it('matches whole token sequences, anchored keywords at the start, and honours exclusions', () => {
    expect(curatedGroupsOf('chart-column-increasing')).toEqual(['charts', 'trends'])
    expect(curatedGroupsOf('trending-up')).toEqual(['trends'])
    expect(curatedGroupsOf('arrow-up-right')).toEqual(['trends'])
    // sort-order and edge arrows are not trends
    expect(curatedGroupsOf('arrow-down-az')).toEqual(['settings'])
    expect(curatedGroupsOf('arrow-up-from-line')).toEqual([])
    // anchored: an arrow inside another name is not a trend
    expect(curatedGroupsOf('cloud-arrow-up')).not.toContain('trends')
    // weather is not data, git graphs are not charts, a doughnut is food
    expect(curatedGroupsOf('cloud-rain')).toEqual([])
    expect(curatedGroupsOf('git-graph')).toEqual([])
    expect(curatedGroupsOf('donut')).toEqual([])
    // off variants, brands and Lucide's numbered alternates are left out
    expect(curatedGroupsOf('bell-off')).toEqual([])
    expect(curatedGroupsOf('github')).toEqual([])
    expect(curatedGroupsOf('clock-3')).toEqual([])
    expect(curatedGroupsOf('file-check-2')).toEqual([])
    // Fluent Color names
    expect(curatedGroupsOf('data-bar-vertical-ascending')).toEqual(['charts'])
    expect(curatedGroupsOf('people-team')).toEqual(['people'])
    expect(curatedGroupsOf('weather-sunny-low')).toEqual([])
  })

  it('groups a name list (sorted, union without duplicates)', () => {
    const names = ['users', 'chart-pie', 'wallet', 'calendar', 'zap', 'chart-column-increasing']
    const g = curatedIcons(names)
    expect(Object.keys(g)).toEqual(BUSINESS_GROUPS.map((x) => x.id))
    expect(g.charts).toEqual(['chart-column-increasing', 'chart-pie'])
    expect(curatedAll(names)).toEqual(['calendar', 'chart-column-increasing', 'chart-pie', 'users', 'wallet'])
    // the picker shows them group by group, charts first, each once
    expect(curatedInGroupOrder(names)).toEqual(['chart-column-increasing', 'chart-pie', 'wallet', 'users', 'calendar'])
  })
})

describe('icon search (pure, over names)', () => {
  const names = ['chart-bar', 'chart-column', 'bar-chart-ish', 'wallet', 'circle-dollar-sign', 'users', 'user', 'calendar-days', 'target', 'database']
  it('exact and prefix matches first, synonyms, every word must match', () => {
    expect(searchIconNames(names, 'chart')[0]).toBe('chart-bar')
    expect(searchIconNames(names, 'chart bar')[0]).toBe('chart-bar')
    expect(searchIconNames(names, 'user')[0]).toBe('user')
    expect(searchIconNames(names, 'money')).toEqual(expect.arrayContaining(['wallet', 'circle-dollar-sign']))
    expect(searchIconNames(names, 'kpi')).toEqual(['target'])
    expect(searchIconNames(names, 'date')).toEqual(['calendar-days'])
    expect(searchIconNames(names, 'chart wallet')).toEqual([])
    expect(searchIconNames(names, '')).toEqual(names)
    expect(searchIconNames(names, 'chart', { limit: 1 })).toHaveLength(1)
  })
})

describe('icon names from component names', () => {
  it('kebab-cases export names without the library prefix / suffix', () => {
    expect(componentIconName('LuChartBar', 'Lu')).toBe('chart-bar')
    expect(componentIconName('LuArrowDown01', 'Lu')).toBe('arrow-down-01')
    expect(componentIconName('LuCalendarX2', 'Lu')).toBe('calendar-x-2')
    expect(componentIconName('LuAxis3D', 'Lu')).toBe('axis-3-d')
    expect(componentIconName('DataBarVerticalAscendingColor', '', 'Color')).toBe('data-bar-vertical-ascending')
    expect(iconTitle('data-bar-vertical-ascending')).toBe('Data bar vertical ascending')
  })
})

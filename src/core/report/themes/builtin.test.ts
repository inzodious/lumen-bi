import { describe, expect, it } from 'vitest'
import { builtinTheme } from './builtin'
import { resolveThemes } from '../../pbir/pbir'

describe('built-in themes by name', () => {
  it('resolve case- and space-insensitively', () => {
    expect(builtinTheme('Concourse')?.dataColors[0]).toBe('#01B8AA')
    expect(builtinTheme('CityPark')?.name).toBe('City park')
    expect(builtinTheme('executive.json')?.dataColors.length).toBe(32)
    expect(builtinTheme('High Contrast')?.name).toBe('High contrast')
    expect(builtinTheme('nope')).toBeUndefined()
  })
  it('are used when a referenced theme is not embedded', () => {
    const diagnostics: string[] = []
    const r = resolveThemes({ report: { themeCollection: { customTheme: { name: 'Concourse', type: 'RegisteredResources' } } }, resources: {} }, diagnostics)
    expect(r.custom?.name).toBe('Concourse')
    expect(diagnostics).toEqual([])
  })
})

describe('legacy reports without a theme', () => {
  it('default to the Classic palette; PBIR and themed reports do not', () => {
    const legacy = resolveThemes({ origin: 'pbix-legacy', report: {}, resources: {} })
    expect(legacy.base?.dataColors.slice(0, 4)).toEqual(['#01B8AA', '#374649', '#FD625E', '#F2C80F'])
    expect(legacy.base?.visualStyles).toBeDefined()
    expect(resolveThemes({ origin: 'pbir', report: {}, resources: {} }).base).toBeUndefined()
    const withCustom = resolveThemes({ origin: 'pbix-legacy', report: { themeCollection: { customTheme: { name: 'Concourse', type: 'RegisteredResources' } } }, resources: {} })
    expect(withCustom.base?.name).toBe('Classic')
  })
})

describe('legacy default base theme', () => {
  it('turns axis titles off (pre-2019 default) while keeping the Classic palette', async () => {
    const { legacyDefaultBaseTheme } = await import('./builtin')
    const t = legacyDefaultBaseTheme()
    expect(t.visualStyles['*']['*'].categoryAxis[0].showAxisTitle).toBe(false)
    expect(t.visualStyles['*']['*'].valueAxis[0].showAxisTitle).toBe(false)
    expect(t.visualStyles['*']['*'].title[0].titleWrap).toBe(false)
    expect(t.dataColors[0].toUpperCase()).toBe('#01B8AA')
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { emptyReport } from '@core/report/types'
import { resolveTheme } from '@core/report/theme'
import { BUILTIN_THEMES, setReportTheme, validateThemeJson, themeFileName, defaultThemeFor, builtinThemeByName } from '../index'
import { buildCustomTheme, getStyle, resolvedStyle, setStyle } from '../../../dialogs/CustomizeThemeDialog'

describe('built-in themes', () => {
  it('are valid themes with 8+ hex data colors and unique names', () => {
    expect(BUILTIN_THEMES[0]).toMatchObject({ name: 'Default', json: null })
    expect(new Set(BUILTIN_THEMES.map((t) => t.name)).size).toBe(BUILTIN_THEMES.length)
    for (const t of BUILTIN_THEMES.slice(1)) {
      expect(validateThemeJson(t.json)).toBeUndefined()
      expect(t.json.dataColors.length).toBeGreaterThanOrEqual(8)
      expect(resolveTheme(undefined, t.json).dataColors[0]).toBe(t.json.dataColors[0])
    }
  })
  it('match the published PBI gallery (order, names, palettes)', () => {
    expect(BUILTIN_THEMES.map((t) => t.name)).toEqual([
      'Default', 'Highrise', 'Executive', 'Frontier', 'Innovate', 'Bloom', 'Tidal', 'Temperature', 'Solar', 'Divergent', 'Storm', 'Classic',
      'City park', 'Classroom', 'Colorblind safe', 'Electric', 'High contrast', 'Sunset', 'Twilight',
      'Accessible default', 'Accessible city park', 'Accessible tidal', 'Accessible neutral', 'Accessible orchid'
    ])
    const first = (n: string) => builtinThemeByName(n)!.json.dataColors.slice(0, 3)
    expect(first('Executive')).toEqual(['#3257A8', '#37A794', '#8B3D88'])
    expect(builtinThemeByName('Executive')!.json.dataColors).toHaveLength(32)
    expect(builtinThemeByName('Executive')!.json).toMatchObject({ tableAccent: '#3257A8', maximum: '#3257A8', center: '#DD6B7F', minimum: '#D1DBF1' })
    expect(first('Tidal')).toEqual(['#094782', '#0B72D7', '#098BF5'])
    expect(first('Divergent')).toEqual(['#B73A3A', '#EC5656', '#F28A90'])
    expect(first('City park')).toEqual(['#73B761', '#4A588A', '#ECC846'])
    expect(first('Classic')).toEqual(['#01B8AA', '#374649', '#FD625E'])
    // palettes are distinct, and every theme's table accent is its first color unless published otherwise
    expect(new Set(BUILTIN_THEMES.map((t) => t.preview.join())).size).toBe(BUILTIN_THEMES.length)
    for (const t of BUILTIN_THEMES.slice(1)) expect(t.json.tableAccent).toBe(t.json.dataColors[0])
  })
  it('resolves gallery names tolerantly (Options default theme)', () => {
    expect(defaultThemeFor('Color-blind safe')?.name).toBe('Colorblind safe')
    expect(defaultThemeFor('default')).toBeNull()
    expect(defaultThemeFor('nope')).toBeNull()
  })
  it('rejects invalid theme files', () => {
    expect(validateThemeJson([])).toBeTruthy()
    expect(validateThemeJson({ name: 'x', dataColors: ['red'] })).toMatch(/invalid color/)
    expect(validateThemeJson({ foo: 1 })).toBeTruthy()
    expect(validateThemeJson({ name: 'ok', dataColors: ['#112233'] })).toBeUndefined()
  })
})

describe('setReportTheme', () => {
  it('writes the custom theme like PBIR and removes it for Default', () => {
    const r = emptyReport()
    const json = BUILTIN_THEMES.find((t) => t.name === 'Executive')!.json
    setReportTheme(r, json, 'Executive12345678.json')
    expect(r.theme.custom).toBe(json)
    expect(r.report.themeCollection.customTheme).toEqual({ name: 'Executive12345678.json', reportVersionAtImport: { visual: '2.4.0', report: '3.0.0', page: '2.3.0' }, type: 'RegisteredResources' })
    const res = r.resources['StaticResources/RegisteredResources/Executive12345678.json']
    expect(JSON.parse(new TextDecoder().decode(res.bytes)).name).toBe('Executive')
    const pkg = r.report.resourcePackages.find((p: any) => p.name === 'RegisteredResources')
    expect(pkg.items).toEqual([{ name: 'Executive12345678.json', path: 'Executive12345678.json', type: 'CustomTheme' }])
    // replacing removes the previous file
    setReportTheme(r, BUILTIN_THEMES.find((t) => t.name === 'Tidal')!.json, 'Tidal1.json')
    expect(r.resources['StaticResources/RegisteredResources/Executive12345678.json']).toBeUndefined()
    expect(r.report.resourcePackages[0].items).toHaveLength(1)
    setReportTheme(r, null)
    expect(r.theme.custom).toBeUndefined()
    expect(r.report.themeCollection.customTheme).toBeUndefined()
    expect(r.report.themeCollection.baseTheme).toBeDefined()
    expect(Object.keys(r.resources)).toHaveLength(0)
  })
  it('file names are PBI-like', () => {
    expect(themeFileName('City park')).toMatch(/^Citypark\d{8}\.json$/)
  })
})

describe('customize theme helpers', () => {
  it('reads/writes visualStyles bags with $id selectors', () => {
    const t: any = { name: 'x', dataColors: [] }
    setStyle(t, 'page', 'filterCard', 'backgroundColor', { solid: { color: '#ffffff' } }, 'Applied')
    setStyle(t, '*', 'background', 'transparency', 20)
    expect(t.visualStyles.page['*'].filterCard).toEqual([{ $id: 'Applied', backgroundColor: { solid: { color: '#ffffff' } } }])
    expect(getStyle(t, '*', 'background', 'transparency')).toBe(20)
    expect(getStyle(t, 'page', 'filterCard', 'backgroundColor', 'Applied')).toEqual({ solid: { color: '#ffffff' } })
    setStyle(t, '*', 'background', 'transparency', undefined)
    expect(getStyle(t, '*', 'background', 'transparency')).toBeUndefined()
  })
})

describe('customize theme output', () => {
  it('falls back to the base theme for unset visualStyles (filter cards live under *)', () => {
    const base = resolveTheme()
    expect(resolvedStyle(base, '*', 'filterCard', 'border', 'Applied')).toBe(true)
    expect(resolvedStyle(base, 'page', 'background', 'transparency')).toBe(100)
    expect(resolvedStyle(base, 'page', 'outspacePane', 'transparency')).toBe(0)
  })
  it('builds a clean theme JSON and applies it through setReportTheme', () => {
    const draft: any = {
      name: '  My theme ',
      dataColors: ['#112233', '#445566'],
      good: undefined,
      textClasses: { title: { fontFace: 'Georgia', fontSize: 14, color: '#000000' }, label: {} },
      visualStyles: {}
    }
    setStyle(draft, '*', 'outspacePane', 'backgroundColor', { solid: { color: '#EEEEEE' } })
    setStyle(draft, '*', 'filterCard', 'transparency', 10, 'Available')
    setStyle(draft, '*', 'border', 'show', true)
    setStyle(draft, '*', 'border', 'show', undefined) // left empty → pruned
    setStyle(draft, 'page', 'outspace', 'color', { solid: { color: '#F0F0F0' } })
    const out = buildCustomTheme(draft)
    expect(out.name).toBe('My theme')
    expect('good' in out).toBe(false)
    expect(out.textClasses).toEqual({ title: { fontFace: 'Georgia', fontSize: 14, color: '#000000' } })
    expect(out.visualStyles!['*']['*'].border).toBeUndefined()
    expect(out.visualStyles!['*']['*'].filterCard).toEqual([{ $id: 'Available', transparency: 10 }])
    expect(draft.name).toBe('  My theme ') // input untouched
    const r = emptyReport()
    setReportTheme(r, out, 'Mytheme1.json')
    const th = resolveTheme(r.theme.base, r.theme.custom)
    expect(th.dataColors.slice(0, 2)).toEqual(['#112233', '#445566'])
    expect(th.textClasses.title.fontFace).toBe('Georgia')
    expect(th.textClasses.label.fontFace).toBe('Segoe UI') // base kept
    expect(resolvedStyle(th, '*', 'outspacePane', 'backgroundColor')).toEqual({ solid: { color: '#EEEEEE' } })
    expect(resolvedStyle(th, '*', 'outspacePane', 'border')).toBe(true) // base merged in
    expect(resolvedStyle(th, '*', 'filterCard', 'transparency', 'Available')).toBe(10)
    expect(resolvedStyle(th, '*', 'filterCard', 'transparency', 'Applied')).toBe(0)
  })
})

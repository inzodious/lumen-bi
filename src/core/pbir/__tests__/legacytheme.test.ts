import { emptyReport } from '../../report/types'
import { legacyDefaultBaseTheme } from '../../report/themes/builtin'
import { pbirToFiles, readPbirFiles, resolveThemes } from '../pbir'
import { DEFAULT_REPORT_VERSION_AT_IMPORT } from '../themeResources'

describe('legacy layouts without a base theme', () => {
  it('persist the Classic palette as an explicit base theme when saved as PBIR', () => {
    const doc = emptyReport()
    doc.origin = 'pbix-legacy'
    delete doc.report.themeCollection
    const classic = legacyDefaultBaseTheme().dataColors

    expect(resolveThemes(doc).base?.dataColors).toEqual(classic)

    const files = pbirToFiles(doc)
    expect(files['StaticResources/SharedResources/BaseThemes/Classic.json']).toBeDefined()
    const enc = new TextEncoder()
    const bytes: Record<string, Uint8Array> = {}
    for (const [p, c] of Object.entries(files)) bytes[p] = typeof c === 'string' ? enc.encode(c) : c
    const reopened = readPbirFiles(bytes, 'pbir')
    expect(reopened.report.themeCollection.baseTheme).toEqual({ name: 'Classic', reportVersionAtImport: DEFAULT_REPORT_VERSION_AT_IMPORT, type: 'SharedResources' })
    expect(reopened.report.resourcePackages).toEqual([{ name: 'SharedResources', type: 'SharedResources', items: [{ name: 'Classic', path: 'BaseThemes/Classic.json', type: 'BaseTheme' }] }])
    expect(reopened.theme.base?.dataColors).toEqual(classic)
    // the in-memory document is not mutated by saving
    expect(doc.report.themeCollection).toBeUndefined()
  })
})

describe('base theme reference of a saved report (Power BI writes all three parts)', () => {
  const enc = new TextEncoder()
  const reopen = (files: Record<string, string | Uint8Array>) => {
    const bytes: Record<string, Uint8Array> = {}
    for (const [p, c] of Object.entries(files)) bytes[p] = typeof c === 'string' ? enc.encode(c) : c
    return readPbirFiles(bytes, 'pbir')
  }

  it('a new report gets reportVersionAtImport, the CY24SU10 file and its resourcePackages item', () => {
    const doc = emptyReport()
    delete doc.report.themeCollection.baseTheme.reportVersionAtImport
    const files = pbirToFiles(doc)
    const report = JSON.parse(files['definition/report.json'] as string)
    expect(Object.keys(report.themeCollection.baseTheme)).toEqual(['name', 'reportVersionAtImport', 'type'])
    expect(report.themeCollection.baseTheme.reportVersionAtImport).toEqual(DEFAULT_REPORT_VERSION_AT_IMPORT)
    expect(report.resourcePackages).toEqual([{ name: 'SharedResources', type: 'SharedResources', items: [{ name: 'CY24SU10', path: 'BaseThemes/CY24SU10.json', type: 'BaseTheme' }] }])
    const theme = files['StaticResources/SharedResources/BaseThemes/CY24SU10.json'] as Uint8Array
    expect(JSON.parse(new TextDecoder().decode(theme)).name).toBe('CY24SU10')
    // reopening finds the theme in the resources (no "not found" diagnostic)
    const again = reopen(files)
    expect(again.diagnostics.filter((d) => d.includes('not found'))).toEqual([])
    expect(again.theme.base?.name).toBe('CY24SU10')
  })

  it('a report that already carries its theme is written unchanged', () => {
    const doc = emptyReport()
    const first = reopen(pbirToFiles(doc))
    const second = pbirToFiles(first)
    expect(JSON.parse(second['definition/report.json'] as string)).toEqual(first.report)
    expect(Object.keys(second).filter((p) => p.startsWith('StaticResources/'))).toEqual(['StaticResources/SharedResources/BaseThemes/CY24SU10.json'])
  })
})

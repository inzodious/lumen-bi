import { emptyReport } from '../../report/types'
import { legacyDefaultBaseTheme } from '../../report/themes/builtin'
import { pbirToFiles, readPbirFiles, resolveThemes } from '../pbir'

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
    expect(reopened.report.themeCollection.baseTheme).toEqual({ name: 'Classic', type: 'SharedResources' })
    expect(reopened.theme.base?.dataColors).toEqual(classic)
    // the in-memory document is not mutated by saving
    expect(doc.report.themeCollection).toBeUndefined()
  })
})

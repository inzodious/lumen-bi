import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openProject } from '../open'
import { nodeFs } from '../nodefs'

describe('PBIP data cache guard', () => {
  it('never decodes .pbi/cache.abf during tests, even with loadData left on', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumen-guard-'))
    try {
      const dir = join(root, 'Guard.SemanticModel')
      await mkdir(join(dir, 'definition', 'tables'), { recursive: true })
      await mkdir(join(dir, '.pbi'), { recursive: true })
      await writeFile(join(dir, 'definition.pbism'), JSON.stringify({ version: '4.2', settings: {} }))
      await writeFile(join(dir, 'definition', 'model.tmdl'), 'model Model\n\tculture: en-US\n\nref table Sales\n')
      await writeFile(join(dir, 'definition', 'tables', 'Sales.tmdl'), 'table Sales\n\n\tcolumn Amount\n\t\tdataType: double\n\t\tsourceColumn: Amount\n')
      await writeFile(join(dir, '.pbi', 'cache.abf'), new Uint8Array([1, 2, 3, 4]))
      const doc = await openProject(dir, nodeFs)
      const messages = doc.diagnostics.map((d) => d.message)
      expect(messages.some((m) => m.includes('not read: blocked'))).toBe(true)
      expect(messages.some((m) => m.includes('Could not read the data cache'))).toBe(false)
      expect(doc.data.tables.size).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

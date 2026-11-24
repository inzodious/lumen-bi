/**
 * Where Save writes (defects fixed with the PBIX writer):
 *  - saving a PBIP project in place keeps its folders: a report bound to a model folder with another name keeps it,
 *    and a `.pbip` listing several reports keeps all of them;
 *  - a model opened from a standalone `.bim` is saved back to that file, not to `model.bim.pbip`.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFs } from '../nodefs'
import { defaultSaveTarget, openProject, saveProject } from '../open'
import { pbipJson } from '../pbip'
import { emptyModel } from '../../model/types'
import { emptyDataStore } from '../../model/data'
import { emptyReport } from '../../report/types'
import { writeTmsl } from '../../tmdl/tmsl'
import type { ProjectDocument } from '../../project'

function project(name: string): ProjectDocument {
  const model = emptyModel()
  model.tables.push({ name: 'T', columns: [{ name: 'A', kind: 'data', dataType: 'int64', sourceColumn: 'A' }], measures: [{ name: 'M', expression: 'SUM(T[A])' }], hierarchies: [], partitions: [{ name: 'T', mode: 'import', sourceType: 'm', expression: 'let\n    Source = #table({"A"}, {{1}})\nin\n    Source' }] })
  return { id: 'p', name, source: { kind: 'new' }, model, data: emptyDataStore(), report: emptyReport(), diagnostics: [], dirty: false }
}

function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-save-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

describe('PBIP save in place', () => {
  it('keeps a model folder with another name and the other artifacts of the .pbip', () =>
    withDir(async (dir) => {
      await saveProject(project('Sales'), join(dir, 'Sales.pbip'), nodeFs, { format: 'pbip' })
      // as a shared-model layout: the model folder is renamed and the .pbip lists a second report
      const { renameSync } = await import('node:fs')
      renameSync(join(dir, 'Sales.SemanticModel'), join(dir, 'Shared.SemanticModel'))
      const pbir = JSON.parse(readFileSync(join(dir, 'Sales.Report', 'definition.pbir'), 'utf8'))
      pbir.datasetReference.byPath.path = '../Shared.SemanticModel'
      writeFileSync(join(dir, 'Sales.Report', 'definition.pbir'), JSON.stringify(pbir, null, 2))
      const pbip = JSON.parse(readFileSync(join(dir, 'Sales.pbip'), 'utf8'))
      pbip.artifacts.push({ report: { path: 'Other.Report' } })
      writeFileSync(join(dir, 'Sales.pbip'), JSON.stringify(pbip, null, 2))

      const doc = await openProject(join(dir, 'Sales.pbip'), nodeFs)
      expect(doc.model.tables.map((t) => t.name)).toEqual(['T'])
      doc.model.tables[0].measures[0].expression = 'SUM(T[A]) + 1'
      const home = defaultSaveTarget(doc)!
      expect(home).toEqual({ format: 'pbip', target: join(dir, 'Sales.pbip') })
      await saveProject(doc, home.target, nodeFs, { format: home.format as 'pbip' })
      expect(readdirSync(dir).sort()).toEqual(['Sales.Report', 'Sales.pbip', 'Shared.SemanticModel'])
      expect(JSON.parse(readFileSync(join(dir, 'Sales.Report', 'definition.pbir'), 'utf8')).datasetReference.byPath.path).toBe('../Shared.SemanticModel')
      expect(JSON.parse(readFileSync(join(dir, 'Sales.pbip'), 'utf8')).artifacts).toEqual([{ report: { path: 'Sales.Report' } }, { report: { path: 'Other.Report' } }])
      const again = await openProject(join(dir, 'Sales.pbip'), nodeFs)
      expect(again.model.tables[0].measures[0].expression).toBe('SUM(T[A]) + 1')
    }))

  it('Save as under a new name still writes new folders named after it', () =>
    withDir(async (dir) => {
      await saveProject(project('Sales'), join(dir, 'Sales.pbip'), nodeFs, { format: 'pbip' })
      const doc = await openProject(join(dir, 'Sales.pbip'), nodeFs)
      await saveProject(doc, join(dir, 'Copy.pbip'), nodeFs, { format: 'pbip' })
      expect(existsSync(join(dir, 'Copy.Report'))).toBe(true)
      expect(existsSync(join(dir, 'Copy.SemanticModel'))).toBe(true)
      expect(JSON.parse(readFileSync(join(dir, 'Copy.Report', 'definition.pbir'), 'utf8')).datasetReference.byPath.path).toBe('../Copy.SemanticModel')
    }))

  it('pbipJson replaces only its own report artifact', () => {
    const existing = { version: '1.0', artifacts: [{ report: { path: 'A.Report' } }, { report: { path: 'B.Report' } }], settings: { enableAutoRecovery: true } }
    expect(JSON.parse(pbipJson(existing, 'B.Report')).artifacts).toEqual(existing.artifacts)
    expect(JSON.parse(pbipJson(existing, 'C.Report', 'B.Report')).artifacts).toEqual([{ report: { path: 'A.Report' } }, { report: { path: 'C.Report' } }])
    expect(JSON.parse(pbipJson(existing, 'D.Report')).artifacts).toEqual([...existing.artifacts, { report: { path: 'D.Report' } }])
    expect(JSON.parse(pbipJson(undefined, 'X.Report')).artifacts).toEqual([{ report: { path: 'X.Report' } }])
  })
})

describe('standalone .bim', () => {
  it('is saved back to the .bim file, not to model.bim.pbip', () =>
    withDir(async (dir) => {
      const bim = join(dir, 'model.bim')
      writeFileSync(bim, JSON.stringify(writeTmsl(project('x').model).json, null, 2))
      const doc = await openProject(bim, nodeFs)
      const home = defaultSaveTarget(doc)!
      expect(home).toEqual({ format: 'bim', target: bim })
      doc.model.tables[0].measures.push({ name: 'N', expression: 'COUNTROWS(T)' })
      await saveProject(doc, home.target, nodeFs, { format: 'bim' })
      expect(readdirSync(dir)).toEqual(['model.bim'])
      const again = await openProject(bim, nodeFs)
      expect(again.model.tables[0].measures.map((m) => m.name)).toEqual(['M', 'N'])
    }))

  it('a .SemanticModel folder still saves as a PBIP project next to it', () =>
    withDir(async (dir) => {
      mkdirSync(join(dir, 'x'))
      await saveProject(project('Sales'), join(dir, 'x', 'Sales.pbip'), nodeFs, { format: 'pbip' })
      const doc = await openProject(join(dir, 'x', 'Sales.SemanticModel'), nodeFs)
      const slash = (p: string | undefined) => p?.replace(/\\/g, '/')
      const t = defaultSaveTarget(doc)
      expect({ ...t, target: slash(t?.target) }).toEqual({ format: 'pbip', target: slash(join(dir, 'x', 'Sales.pbip')) })
    }))
})

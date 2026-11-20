/**
 * `.pbit` / `.pbix` writer (package.ts) end to end through Lumen's reader:
 *  - always: the built-in sample as a template; the MIT-licensed `data-profiling-demo.pbix` fixture (a Power BI Desktop
 *    2018 file) saved with an edited report (original DataModel bytes kept) and with measure edits (stage D);
 *  - with LUMEN_SAMPLES_DIR: the same for every Microsoft sample, plus part-by-part comparisons with the source.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inflateSync } from 'fflate'
import { nodeFs } from '../../nodefs'
import { openProject, planPackageSave, saveProject } from '../../open'
import { createSampleProject } from '../../../data/sample'
import { writeTmsl } from '../../../tmdl/tmsl'
import type { ProjectDocument } from '../../../project'
import { abfFileBytes, parseAbf } from '../datamodel/abf'
import { decompressDataModel } from '../datamodel/container'
import { getSqlJs } from '../datamodel/sqlite'
import { fromUtf16le, readZipEntries, type ZipEntry } from './opc'
import { CANNOT_WRITE_DATA, VERIFIED_IN_DESKTOP, writePackage } from './package'

const FIXTURE = join(__dirname, '../datamodel/__fixtures__/data-profiling-demo.pbix')
const DATE = new Date(2026, 0, 2, 3, 4, 6)

function part(entries: ZipEntry[], name: string): Uint8Array | undefined {
  const e = entries.find((x) => x.name === name)
  if (!e) return undefined
  return e.method === 0 ? e.data : inflateSync(e.data, { out: new Uint8Array(e.size) })
}

/** Model as TMSL with the template upgrade (V3 / 1550) normalised away. */
function tmsl(doc: ProjectDocument): any {
  const j = writeTmsl(doc.model).json
  delete j.compatibilityLevel
  delete j.model.defaultPowerBIDataSourceVersion
  return j
}

/** Pages and visuals (visual order is irrelevant: a legacy layout is read back sorted by name, z-order is in position). */
function visualsOf(doc: ProjectDocument): unknown {
  return doc.report!.pages.map((p) => ({ page: p.json, visuals: [...p.visuals].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }))
}

function tableHash(doc: ProjectDocument): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [n, t] of doc.data.tables) out[n] = `${t.rowCount}:${JSON.stringify(t.columns.map((c) => [c.name, c.values.length, c.values.slice(0, 50), c.values.slice(-50)]))}`
  return out
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-pbix-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function setTitle(doc: ProjectDocument, title: string): string {
  const page = doc.report!.pages.find((p) => p.visuals.some((v) => v.json.visual))
  if (!page) {
    // a report without visuals gets one (a card), so the edit is a real report change
    const p = doc.report!.pages[0]
    p.visuals.push({ name: 'lumenEdited', json: { name: 'lumenEdited', position: { x: 10, y: 10, z: 0, width: 200, height: 100 }, visual: { visualType: 'textbox', objects: {} } } })
    return 'lumenEdited'
  }
  const v = page.visuals.find((x) => x.json.visual)!
  v.json.visual.visualContainerObjects ??= {}
  v.json.visual.visualContainerObjects.title = [{ properties: { show: { expr: { Literal: { Value: 'true' } } }, text: { expr: { Literal: { Value: `'${title}'` } } } } }]
  return v.name
}

function titleOf(doc: ProjectDocument, name: string): string | undefined {
  for (const p of doc.report!.pages) for (const v of p.visuals) if (v.name === name) return v.json.visual?.visualContainerObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value
  return undefined
}

describe('package paths', () => {
  it('are all labelled experimental until confirmed in Power BI Desktop', () => {
    expect(Object.values(VERIFIED_IN_DESKTOP).every((v) => v === false)).toBe(true)
  })
})

describe('.pbit from the built-in sample', () => {
  it('writes Desktop-shaped parts and reopens with the same model and report', async () => {
    const doc = createSampleProject()
    const r = await writePackage('pbit', { project: doc }, { date: DATE })
    expect(r.plan.path).toBe('pbit')
    expect(r.plan.experimental).toBe(true)
    const entries = readZipEntries(r.bytes)
    const names = entries.map((e) => e.name)
    expect(names.slice(0, 3)).toEqual(['Version', '[Content_Types].xml', 'DataModelSchema'])
    expect(names).toContain('Report/Layout')
    expect(names).toContain('Settings')
    expect(names).toContain('Metadata')
    expect(names).toContain('Report/StaticResources/SharedResources/BaseThemes/CY24SU10.json')
    for (const n of ['DataModel', 'DataMashup', 'SecurityBindings']) expect(names).not.toContain(n)
    expect(entries.every((e) => e.method === 8 && e.flags === 0)).toBe(true)
    // UTF-16LE text parts without BOM, Content_Types UTF-8 with BOM
    expect(fromUtf16le(part(entries, 'Version')!)).toBe('1.28')
    expect(part(entries, 'Version')![1]).toBe(0)
    const schemaBytes = part(entries, 'DataModelSchema')!
    expect([schemaBytes[0], schemaBytes[1]]).toEqual([0x7b, 0])
    const schema = JSON.parse(fromUtf16le(schemaBytes))
    expect(schema.model.defaultPowerBIDataSourceVersion).toBe('powerBI_V3')
    expect(schema.compatibilityLevel).toBeGreaterThanOrEqual(1550)
    const ct = part(entries, '[Content_Types].xml')!
    expect([ct[0], ct[1], ct[2]]).toEqual([0xef, 0xbb, 0xbf])
    const ctText = new TextDecoder().decode(ct)
    expect(ctText).toContain('<Override PartName="/DataModelSchema" ContentType="" />')
    expect(ctText).toContain('<Override PartName="/Settings" ContentType="application/json" />')
    expect(ctText).toContain('<Default Extension="json" ContentType="" />')

    await withTmp(async (dir) => {
      const out = join(dir, 'Sample.pbit')
      writeFileSync(out, r.bytes)
      const again = await openProject(out, nodeFs)
      expect(again.source.kind).toBe('pbit')
      expect(tmsl(again)).toEqual(tmsl(doc))
      expect(again.model.expressions).toEqual(doc.model.expressions)
      expect(again.report!.pages.map((p) => p.name)).toEqual(doc.report!.pages.map((p) => p.name))
      expect(visualsOf(again)).toEqual(visualsOf(doc))
      expect(again.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    })
  })

  it('is written deterministically', async () => {
    const a = await writePackage('pbit', { project: createSampleProject() }, { date: DATE })
    const b = await writePackage('pbit', { project: createSampleProject() }, { date: DATE })
    expect(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes))).toBe(0)
  })

  it('becomes a .pbix with the data model written by Lumen (stage E), which reopens with the same model, data and report', async () => {
    const doc = createSampleProject()
    await withTmp(async (dir) => {
      const plan = await planPackageSave(doc, 'pbix', nodeFs)
      expect(plan.path, plan.blockers.join('; ')).toBe('pbix-lumen-data')
      expect(plan.experimental).toBe(!VERIFIED_IN_DESKTOP['pbix-lumen-data'])
      const before = tableHash(doc)
      const visuals = visualsOf(doc)
      const out = join(dir, 'Sample.pbix')
      await saveProject(doc, out, nodeFs, { format: 'pbix' })
      const back = await openProject(out, nodeFs)
      expect(tableHash(back)).toEqual(before)
      expect(visualsOf(back)).toEqual(visuals)
      expect(back.model.tables.map((t) => [t.name, t.measures.length, t.columns.filter((c) => c.kind !== 'rowNumber').length])).toEqual(
        doc.model.tables.map((t) => [t.name, t.measures.length, t.columns.filter((c) => c.kind !== 'rowNumber').length])
      )
      const names = readZipEntries(new Uint8Array(readFileSync(out))).map((e) => e.name)
      expect(names.slice(0, 2)).toEqual(['Version', '[Content_Types].xml'])
      expect(names[names.length - 1]).toBe('DataModel')
      expect(names).not.toContain('SecurityBindings')
    })
  })

  it('cannot become a .pbix when the model has a feature the data model writer lacks: the plan names it', async () => {
    const doc = createSampleProject()
    const r = doc.model.relationships[0]
    r.fromCardinality = 'many'
    r.toCardinality = 'many'
    await withTmp(async (dir) => {
      const plan = await planPackageSave(doc, 'pbix', nodeFs)
      expect(plan.path).toBeUndefined()
      expect(plan.detail).toBe(CANNOT_WRITE_DATA)
      expect(plan.blockers.join('\n')).toMatch(/many-to-many/)
      await expect(saveProject(doc, join(dir, 'x.pbix'), nodeFs, { format: 'pbix' })).rejects.toThrow(/can't write this model's data/)
    })
  })
})

async function checkPbixKeepingModel(src: string): Promise<void> {
  await withTmp(async (dir) => {
    const doc = await openProject(src, nodeFs)
    const before = tableHash(doc)
    const visual = setTitle(doc, 'Edited by Lumen')
    const plan = await planPackageSave(doc, 'pbix', nodeFs)
    expect(plan.path, plan.blockers.join('; ')).toBe('pbix-original-model')
    const out = join(dir, 'Edited.pbix')
    await saveProject(doc, out, nodeFs, { format: 'pbix' })
    expect(doc.source).toEqual({ kind: 'pbix', path: out })
    const srcEntries = readZipEntries(new Uint8Array(readFileSync(src)))
    const outEntries = readZipEntries(new Uint8Array(readFileSync(out)))
    // DataModel byte for byte; every part that is not part of the report (or Content_Types) copied unchanged
    expect(Buffer.compare(Buffer.from(part(outEntries, 'DataModel')!), Buffer.from(part(srcEntries, 'DataModel')!))).toBe(0)
    for (const e of srcEntries) {
      if (e.name === 'SecurityBindings') {
        expect(outEntries.some((o) => o.name === e.name)).toBe(false)
        continue
      }
      if (e.name === 'Report/Layout' || e.name === '[Content_Types].xml' || e.name.startsWith('Report/definition/')) continue
      const o = outEntries.find((x) => x.name === e.name)
      expect(o, e.name).toBeDefined()
      expect(Buffer.compare(Buffer.from(o!.data), Buffer.from(e.data)), e.name).toBe(0)
      expect([o!.crc, o!.dosDate, o!.dosTime]).toEqual([e.crc, e.dosDate, e.dosTime])
    }
    const ct = new TextDecoder().decode(part(outEntries, '[Content_Types].xml')!)
    expect(ct).not.toContain('/SecurityBindings')
    const again = await openProject(out, nodeFs)
    expect(again.source.kind).toBe('pbix')
    expect(writeTmsl(again.model).json).toEqual(writeTmsl(doc.model).json)
    expect(tableHash(again)).toEqual(before)
    expect(titleOf(again, visual)).toBe(titleOf(doc, visual))
    // saving again from the saved file (now the document's source) still keeps the model
    const plan2 = await planPackageSave(doc, 'pbix', nodeFs)
    expect(plan2.path).toBe('pbix-original-model')
  })
}

async function checkUnchangedReport(src: string): Promise<void> {
  await withTmp(async (dir) => {
    const doc = await openProject(src, nodeFs)
    const out = join(dir, 'Same.pbix')
    await saveProject(doc, out, nodeFs, { format: 'pbix' })
    const a = readZipEntries(new Uint8Array(readFileSync(src)))
    const b = readZipEntries(new Uint8Array(readFileSync(out)))
    for (const e of a) {
      if (e.name === 'SecurityBindings' || e.name === '[Content_Types].xml') continue
      const o = b.find((x) => x.name === e.name)
      expect(o && Buffer.compare(Buffer.from(o.data), Buffer.from(e.data)), e.name).toBe(0)
    }
  })
}

async function metadataRows(pbix: string): Promise<{ schema: unknown; integrity: unknown; measures: number }> {
  const entries = readZipEntries(new Uint8Array(readFileSync(pbix)))
  const abf = parseAbf(decompressDataModel(part(entries, 'DataModel')!))
  const SQL = await getSqlJs()
  const db = new SQL.Database(abfFileBytes(abf, 'metadata.sqlitedb'))
  try {
    return {
      schema: db.exec('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name')[0].values,
      integrity: db.exec('PRAGMA integrity_check')[0].values[0][0],
      measures: Number(db.exec('SELECT COUNT(*) FROM Measure')[0].values[0][0])
    }
  } finally {
    db.close()
  }
}

async function checkMeasureEdits(src: string): Promise<void> {
  await withTmp(async (dir) => {
    const doc = await openProject(src, nodeFs)
    const before = tableHash(doc)
    const t = doc.model.tables.find((x) => x.measures.length) ?? doc.model.tables.find((x) => x.columns.length)!
    const edited = t.measures[0]
    if (edited) {
      edited.formatString = '#,0.00'
      edited.description = 'Edited by Lumen'
      edited.displayFolder = 'Lumen'
      edited.expression = `${edited.expression} + 0`
    }
    const removed = t.measures.length > 1 ? t.measures.pop() : undefined
    t.measures.push({ name: 'Lumen Added', expression: 'COUNTROWS ( VALUES ( ' + `'${t.name.replace(/'/g, "''")}'` + ' ) )', formatString: '0', displayFolder: 'Lumen', isHidden: true, annotations: { PBI_FormatHint: '{"isGeneralNumber":true}' } })
    const plan = await planPackageSave(doc, 'pbix', nodeFs)
    expect(plan.path, plan.blockers.join('; ')).toBe('pbix-metadata')
    const out = join(dir, 'Measures.pbix')
    await saveProject(doc, out, nodeFs, { format: 'pbix' })
    const again = await openProject(out, nodeFs)
    expect(writeTmsl(again.model).json).toEqual(writeTmsl(doc.model).json)
    expect(tableHash(again)).toEqual(before)
    const a = await metadataRows(src)
    const b = await metadataRows(out)
    expect(b.integrity).toBe('ok')
    expect(b.schema).toEqual(a.schema)
    expect(b.measures).toBe(a.measures + 1 - (removed ? 1 : 0))
    // the edited file is now the source: a further unchanged save keeps its DataModel byte for byte
    const plan2 = await planPackageSave(doc, 'pbix', nodeFs)
    expect(plan2.path).toBe('pbix-original-model')
  })
}

describe('.pbix from a Power BI Desktop file (MIT fixture)', () => {
  it('keeps the original DataModel and every untouched part when only the report changed', () => checkPbixKeepingModel(FIXTURE))
  it('reproduces every source part of an unchanged report', () => checkUnchangedReport(FIXTURE))
  it('writes added, changed and deleted measures into metadata.sqlitedb', () => checkMeasureEdits(FIXTURE))

  it('refuses when the data changed (e.g. a refresh replaced a table)', async () => {
    const doc = await openProject(FIXTURE, nodeFs)
    const [name, td] = [...doc.data.tables].find(([n]) => doc.model.tables.find((t) => t.name === n)?.partitions.some((p) => p.sourceType === 'm' || p.sourceType === 'query'))!
    doc.data.tables.set(name, { ...td })
    const plan = await planPackageSave(doc, 'pbix', nodeFs)
    expect(plan.path).toBeUndefined()
    expect(plan.blockers.join(' ')).toMatch(/Data changed/)
  })

  it('refuses model changes it cannot write (a new calculated column)', async () => {
    const doc = await openProject(FIXTURE, nodeFs)
    const t = doc.model.tables.find((x) => x.columns.length)!
    t.columns.push({ name: 'Lumen Calc', kind: 'calculated', dataType: 'int64', expression: '1' })
    const plan = await planPackageSave(doc, 'pbix', nodeFs)
    expect(plan.path).toBeUndefined()
    expect(plan.detail).toBe(CANNOT_WRITE_DATA)
    expect(plan.blockers.join(' ')).toMatch(/columns changed/)
  })

  it('also writes a template of the file', async () => {
    const doc = await openProject(FIXTURE, nodeFs)
    await withTmp(async (dir) => {
      const out = join(dir, 'Fixture.pbit')
      await saveProject(doc, out, nodeFs, { format: 'pbit' })
      expect(doc.source.kind).toBe('pbix')
      const again = await openProject(out, nodeFs)
      expect(tmsl(again)).toEqual(tmsl(doc))
      expect(visualsOf(again)).toEqual(visualsOf(doc))
    })
  })
})

const DIR = process.env.LUMEN_SAMPLES_DIR
const samples = DIR && existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.pbix$/i.test(f)).sort() : []

describe.skipIf(!samples.length)('.pbix / .pbit from the Microsoft samples', () => {
  for (const f of samples) {
    const src = (): string => join(DIR!, f)
    it(`${f}: template reopens with the same model, queries and report`, async () => {
      const doc = await openProject(src(), nodeFs)
      await withTmp(async (dir) => {
        const out = join(dir, 'T.pbit')
        await saveProject(doc, out, nodeFs, { format: 'pbit' })
        const again = await openProject(out, nodeFs)
        expect(tmsl(again)).toEqual(tmsl(doc))
        expect(again.model.expressions).toEqual(doc.model.expressions)
        expect(visualsOf(again)).toEqual(visualsOf(doc))
        expect(again.report!.report).toEqual(doc.report!.report)
        expect(again.report!.bookmarks).toEqual(doc.report!.bookmarks)
        const entries = readZipEntries(new Uint8Array(readFileSync(out)))
        const names = entries.map((e) => e.name)
        expect(names).not.toContain('DataModel')
        // every import partition carries its Power Query (2017 files' legacy query partitions are upgraded)
        const schema = JSON.parse(fromUtf16le(part(entries, 'DataModelSchema')!))
        const types = schema.model.tables.flatMap((t: any) => (t.partitions ?? []).map((p: any) => p.source.type))
        expect(types.filter((t: string) => t === 'query')).toEqual([])
        expect(names).not.toContain('SecurityBindings')
      })
    }, 60000)
    it(`${f}: .pbix with an edited visual keeps the DataModel byte for byte`, () => checkPbixKeepingModel(src()), 60000)
    it(`${f}: .pbix of an unchanged report reproduces every part`, () => checkUnchangedReport(src()), 60000)
    it(`${f}: .pbix with measure edits`, () => checkMeasureEdits(src()), 120000)
  }
})

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'
import { nodeFs } from '../nodefs'
import { openProject, saveProject } from '../open'
import { decodeDataStore, encodeDataStore, readWbi, writeWbi } from '../wbi'
import { readMashup, splitSection } from '../pbix/mashup'
import { applyMashup, readPbix } from '../pbix/container'
import { emptyDataStore, makeDate, tableFromRows } from '../../model/data'
import { emptyModel, type SemanticModel } from '../../model/types'
import { emptyReport } from '../../report/types'
import type { ProjectDocument } from '../../project'
import type { FileMap } from '../../pbir/pbir'

function sampleModel(): SemanticModel {
  const m = emptyModel()
  m.compatibilityLevel = 1600
  m.tables.push({
    name: 'Sales',
    columns: [
      { name: 'Product', dataType: 'string', kind: 'data', sourceColumn: 'Product', summarizeBy: 'none' },
      { name: 'Qty', dataType: 'int64', kind: 'data', sourceColumn: 'Qty', summarizeBy: 'sum' },
      { name: 'Price', dataType: 'double', kind: 'data', sourceColumn: 'Price', summarizeBy: 'sum' },
      { name: 'Date', dataType: 'dateTime', kind: 'data', sourceColumn: 'Date', summarizeBy: 'none' },
      { name: 'Promo', dataType: 'boolean', kind: 'data', sourceColumn: 'Promo', summarizeBy: 'none' }
    ],
    measures: [{ name: 'Total Qty', expression: 'SUM(Sales[Qty])', formatString: '#,0' }],
    hierarchies: [],
    partitions: [{ name: 'Sales', sourceType: 'm', mode: 'import', expression: 'let\n    Source = #table({"Product"}, {{"A"}})\nin\n    Source' }]
  })
  return m
}

function sampleData() {
  const data = emptyDataStore()
  const rows = [
    ['A', 1, 1.5, makeDate(2024, 1, 31), true],
    ['B', null, 2.25, makeDate(2024, 2, 1, 13, 30), false],
    [null, 3, null, null, null],
    ['A', -7, 1e10, makeDate(1999, 12, 31), true]
  ]
  data.tables.set('Sales', tableFromRows(['Product', 'Qty', 'Price', 'Date', 'Promo'], ['string', 'int64', 'double', 'dateTime', 'boolean'], rows))
  data.status.set('Sales', { state: 'loaded', source: 'import', rowCount: 4 })
  data.status.set('Empty', { state: 'empty', reason: 'DirectQuery' })
  return data
}

function newProject(): ProjectDocument {
  return {
    id: 'p1',
    name: 'Demo',
    source: { kind: 'new' },
    model: sampleModel(),
    data: sampleData(),
    report: emptyReport(),
    diagnostics: [],
    dirty: true
  }
}

describe('.wbi data encoding', () => {
  it('round-trips every value type', () => {
    const data = sampleData()
    data.tables.set(
      'Mixed',
      tableFromRows(['V', 'Bin', 'Big'], ['variant', 'binary', 'int64'], [
        [1, new Uint8Array([1, 2, 3]), 2 ** 40],
        ['x', null, -1],
        [makeDate(2020, 5, 6), new Uint8Array([]), null]
      ])
    )
    const enc = encodeDataStore(data)
    const files: FileMap = {}
    for (const [p, c] of Object.entries(enc)) files[p] = typeof c === 'string' ? strToU8(c) : c
    const back = decodeDataStore(files)
    expect(back.tables.get('Sales')).toEqual(data.tables.get('Sales'))
    expect(back.tables.get('Mixed')).toEqual(data.tables.get('Mixed'))
    expect(back.status).toEqual(data.status)
  })
  it('bundles project files and data', () => {
    const bytes = writeWbi('Demo', { 'Demo.pbip': '{}' }, sampleData())
    const w = readWbi(bytes)
    expect(w.manifest).toMatchObject({ format: 'wbi', name: 'Demo' })
    expect(Object.keys(w.project)).toEqual(['Demo.pbip'])
    expect(w.data.tables.get('Sales')?.rowCount).toBe(4)
  })
})

describe('DataMashup', () => {
  const section = [
    'section Section1;',
    '',
    'shared Sales = let',
    '    Source = Csv.Document(File.Contents(Folder & "sales.csv"), [Delimiter=";"]),',
    '    #"Promoted" = Table.PromoteHeaders(Source)',
    'in',
    '    #"Promoted";',
    '',
    'shared Folder = "C:\\data\\" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true];',
    '',
    'shared #"Helper query" = { 1, 2, 3 };'
  ].join('\r\n')

  it('splits Section1.m into queries', () => {
    const q = splitSection(section)
    expect(q.map((x) => x.name)).toEqual(['Sales', 'Folder', 'Helper query'])
    expect(q[0].expression.startsWith('let')).toBe(true)
    expect(q[0].expression.endsWith('#"Promoted"')).toBe(true)
    expect(q[1].expression).toBe('"C:\\data\\" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]')
  })

  it('reads the package and upgrades legacy query partitions', () => {
    const pkg = zipSync({ 'Formulas/Section1.m': strToU8(section), '[Content_Types].xml': strToU8('<x/>') })
    const blob = new Uint8Array(8 + pkg.length + 4)
    const dv = new DataView(blob.buffer)
    dv.setUint32(0, 0, true)
    dv.setUint32(4, pkg.length, true)
    blob.set(pkg, 8)
    const mashup = readMashup(blob)
    const model = sampleModel()
    model.tables[0].partitions = [{ name: 'Sales-1', sourceType: 'query', expression: 'SELECT * FROM [Sales]', extra: { mashupQueryName: 'Sales' } }]
    const diags: Array<{ level: 'info' | 'warning' | 'error'; message: string }> = []
    applyMashup(model, mashup, diags)
    expect(model.tables[0].partitions[0]).toEqual({ name: 'Sales-1', sourceType: 'm', expression: mashup.queries[0].expression })
    expect(model.expressions.map((e) => e.name)).toEqual(['Folder', 'Helper query'])
  })
})

describe('PBIX container', () => {
  it('reads a template with DataModelSchema and a legacy layout', async () => {
    const utf16 = (s: string): Uint8Array => {
      const out = new Uint8Array(s.length * 2)
      for (let i = 0; i < s.length; i++) {
        out[2 * i] = s.charCodeAt(i) & 0xff
        out[2 * i + 1] = s.charCodeAt(i) >> 8
      }
      return out
    }
    const schema = { name: 'x', compatibilityLevel: 1550, model: { culture: 'en-US', tables: [{ name: 'T', columns: [{ name: 'A', dataType: 'string', sourceColumn: 'A' }], partitions: [{ name: 'T', source: { type: 'm', expression: ['let', '    a = 1', 'in', '    a'] } }] }] } }
    const layout = { sections: [{ name: 'S1', displayName: 'Page 1', displayOption: 1, width: 1280, height: 720, config: '{}', filters: '[]', visualContainers: [] }], config: '{}' }
    const zip = zipSync({ Version: utf16('1.28'), DataModelSchema: utf16(JSON.stringify(schema)), 'Report/Layout': utf16(JSON.stringify(layout)) })
    const r = await readPbix(zip)
    expect(r.kind).toBe('pbit')
    expect(r.version).toBe('1.28')
    expect(r.model.tables[0].partitions[0].expression).toBe('let\n    a = 1\nin\n    a')
    expect(r.report?.origin).toBe('pbix-legacy')
    expect(r.report?.pages[0].json.displayName).toBe('Page 1')
  })
  it('reports live-connection files', async () => {
    const zip = zipSync({
      Connections: strToU8(JSON.stringify({ Version: 1, Connections: [{ Name: 'EntityDataSource', ConnectionString: 'Data Source=x', ConnectionType: 'pbiServiceLive', PbiModelDatabaseName: 'abc' }] })),
      'Report/Layout': strToU8(JSON.stringify({ sections: [], config: '{}' }))
    })
    const r = await readPbix(zip)
    expect(r.liveConnection).toBe(true)
    expect(r.report?.pbir?.datasetReference?.byConnection?.connectionString).toBe('Data Source=x')
    expect(r.diagnostics.some((d) => /live connection/.test(d.message))).toBe(true)
  })
})

describe('PBIP save / open', () => {
  it('writes a fresh PBIP project and reopens it', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wbi-pbip-'))
    try {
      const doc = newProject()
      await saveProject(doc, tmp, nodeFs, { format: 'pbip' })
      expect(readdirSync(tmp).sort()).toEqual(['Demo.Report', 'Demo.SemanticModel', 'Demo.pbip'])
      const pbip = JSON.parse(readFileSync(join(tmp, 'Demo.pbip'), 'utf8'))
      expect(pbip.artifacts).toEqual([{ report: { path: 'Demo.Report' } }])
      const pbir = JSON.parse(readFileSync(join(tmp, 'Demo.Report/definition.pbir'), 'utf8'))
      expect(pbir.datasetReference).toEqual({ byPath: { path: '../Demo.SemanticModel' } })
      const plat = JSON.parse(readFileSync(join(tmp, 'Demo.SemanticModel/.platform'), 'utf8'))
      expect(plat.metadata).toEqual({ type: 'SemanticModel', displayName: 'Demo' })
      expect(plat.config.logicalId).toMatch(/^[0-9a-f-]{36}$/)
      expect(JSON.parse(readFileSync(join(tmp, 'Demo.SemanticModel/definition.pbism'), 'utf8')).version).toBe('4.2')
      expect(existsSync(join(tmp, 'Demo.SemanticModel/definition/tables/Sales.tmdl'))).toBe(true)
      expect(doc.source.kind).toBe('pbip')
      expect(doc.dirty).toBe(false)

      const again = await openProject(join(tmp, 'Demo.pbip'), nodeFs)
      expect(again.model.tables).toEqual(doc.model.tables)
      expect(again.report?.pages).toEqual(doc.report?.pages)
      expect(again.data.tables.size).toBe(0) // data never goes into PBIP

      // remove a page and a table; save in place deletes their files
      again.report!.pages[0].visuals.push({ name: 'v1', json: { name: 'v1', position: { x: 0, y: 0, width: 10, height: 10 }, visual: { visualType: 'card' } } })
      await saveProject(again, join(tmp, 'Demo.pbip'), nodeFs, { format: 'pbip' })
      expect(existsSync(join(tmp, 'Demo.Report/definition/pages/ReportSection/visuals/v1/visual.json'))).toBe(true)
      again.report!.pages[0].visuals = []
      again.model.tables[0].name = 'Orders'
      await saveProject(again, join(tmp, 'Demo.pbip'), nodeFs, { format: 'pbip' })
      expect(existsSync(join(tmp, 'Demo.Report/definition/pages/ReportSection/visuals/v1'))).toBe(false)
      expect(existsSync(join(tmp, 'Demo.SemanticModel/definition/tables/Sales.tmdl'))).toBe(false)
      expect(existsSync(join(tmp, 'Demo.SemanticModel/definition/tables/Orders.tmdl'))).toBe(true)
      // logicalId is stable across saves
      expect(JSON.parse(readFileSync(join(tmp, 'Demo.SemanticModel/.platform'), 'utf8')).config.logicalId).toBe(plat.config.logicalId)

      // opening the folders directly
      expect((await openProject(join(tmp, 'Demo.Report'), nodeFs)).source.kind).toBe('pbir-folder')
      expect((await openProject(join(tmp, 'Demo.SemanticModel'), nodeFs)).report).toBeUndefined()
      expect((await openProject(tmp, nodeFs)).source.kind).toBe('pbip')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('saves and reopens a .wbi bundle with data', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wbi-bundle-'))
    try {
      const doc = newProject()
      await saveProject(doc, join(tmp, 'Demo.wbi'), nodeFs, { format: 'wbi' })
      const again = await openProject(join(tmp, 'Demo.wbi'), nodeFs)
      expect(again.source.kind).toBe('wbi')
      expect(again.model.tables).toEqual(sampleModel().tables)
      expect(again.data.tables.get('Sales')).toEqual(sampleData().tables.get('Sales'))
      expect(again.report?.pages).toEqual(doc.report?.pages)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('reads and keeps model.bim semantic models', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wbi-bim-'))
    try {
      const dir = join(tmp, 'M.SemanticModel')
      mkdirSync(dir)
      writeFileSync(join(dir, 'definition.pbism'), JSON.stringify({ version: '1.0' }))
      writeFileSync(join(dir, 'model.bim'), JSON.stringify({ name: 'M', compatibilityLevel: 1550, model: { tables: [{ name: 'T', columns: [{ name: 'A', dataType: 'int64', sourceColumn: 'A' }] }] } }))
      const doc = await openProject(dir, nodeFs)
      expect(doc.model.tables[0].columns[0].name).toBe('A')
      await saveProject(doc, join(tmp, 'out'), nodeFs, { format: 'pbip' })
      expect(existsSync(join(tmp, 'out/M.SemanticModel/model.bim'))).toBe(true)
      await saveProject(doc, join(tmp, 'out2'), nodeFs, { format: 'pbip', modelFormat: 'tmdl' })
      expect(existsSync(join(tmp, 'out2/M.SemanticModel/definition/tables/T.tmdl'))).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

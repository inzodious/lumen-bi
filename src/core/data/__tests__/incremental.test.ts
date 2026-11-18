import { describe, expect, it } from 'vitest'
import type { DirEntry, FileSystem } from '../../io/fs'
import type { ProjectDocument } from '../../project'
import type { TableDef } from '../../model/types'
import { emptyDataStore } from '../../model/data'
import type { RefreshHost } from '../fetcher'
import { incrementalPolicy, policyWindows, rangeColumn, refreshProject, tableQuery } from '../refresh'

const enc = new TextEncoder()

function memFs(files: Record<string, string>): FileSystem {
  return {
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT: no such file '${p}'`)
      return enc.encode(files[p]!)
    },
    readText: async (p) => files[p]!,
    writeFile: async () => undefined,
    list: async () => [] as DirEntry[],
    exists: async (p) => p in files,
    stat: async () => null,
    mkdirp: async () => undefined,
    remove: async () => undefined
  }
}

const SOURCE = `let
    Source = Csv.Document(File.Contents("/sales.csv"), [Delimiter=","]),
    Promoted = Table.PromoteHeaders(Source),
    Typed = Table.TransformColumnTypes(Promoted, {{"OrderDate", type datetime}, {"Amount", type number}}),
    Filtered = Table.SelectRows(Typed, each [OrderDate] >= RangeStart and [OrderDate] < RangeEnd)
in
    Filtered`

function salesTable(policy: Record<string, unknown> | undefined): TableDef {
  return {
    name: 'Sales',
    columns: [
      { name: 'OrderDate', dataType: 'dateTime', kind: 'data', sourceColumn: 'OrderDate' },
      { name: 'Amount', dataType: 'double', kind: 'data', sourceColumn: 'Amount' }
    ],
    measures: [],
    hierarchies: [],
    partitions: [{ name: 'Sales', mode: 'import', sourceType: 'm', expression: SOURCE }],
    refreshPolicy: policy
  }
}

const POLICY = { policyType: 'basic', rollingWindowGranularity: 'month', rollingWindowPeriods: 2, incrementalGranularity: 'day', incrementalPeriods: 3 }

function project(policy: Record<string, unknown> | null = POLICY): ProjectDocument {
  return {
    id: 't',
    name: 't',
    source: { kind: 'new' },
    model: {
      name: 'm',
      tables: [salesTable(policy ?? undefined)],
      relationships: [],
      roles: [],
      expressions: [
        { name: 'RangeStart', kind: 'm', expression: '#datetime(2020, 1, 1, 0, 0, 0) meta [IsParameterQuery=true, Type="DateTime", IsParameterQueryRequired=true]' },
        { name: 'RangeEnd', kind: 'm', expression: '#datetime(2020, 2, 1, 0, 0, 0) meta [IsParameterQuery=true, Type="DateTime", IsParameterQueryRequired=true]' }
      ]
    },
    data: emptyDataStore(),
    diagnostics: [],
    dirty: false
  }
}

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

function rows(p: ProjectDocument): Array<[string, number]> {
  const t = p.data.tables.get('Sales')!
  const dates = t.columns[0]!.values as Date[]
  const amounts = t.columns[1]!.values as number[]
  return dates.map((d, i) => [d.toISOString().slice(0, 10), amounts[i]!] as [string, number]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

describe('incremental refresh', () => {
  it('reads the policy and computes the windows', () => {
    const p = incrementalPolicy(salesTable(POLICY))!
    expect(p).toMatchObject({ incrementalGranularity: 'day', incrementalPeriods: 3, rollingWindowGranularity: 'month', rollingWindowPeriods: 2 })
    expect(policyWindows(p, Date.UTC(2026, 10, 17, 9))).toEqual({ rollingStart: day(2026, 9, 1), incrementalStart: day(2026, 11, 15), end: day(2026, 11, 18) })
    const q = policyWindows({ ...p, incrementalGranularity: 'quarter', incrementalPeriods: 1, rollingWindowGranularity: 'year', rollingWindowPeriods: 3 }, Date.UTC(2026, 10, 17))
    expect(q).toEqual({ rollingStart: day(2023, 1, 1), incrementalStart: day(2026, 10, 1), end: day(2027, 1, 1) })
    expect(incrementalPolicy(salesTable({ incrementalGranularity: 'week' }))).toBeNull()
    expect(rangeColumn(SOURCE)).toBe('OrderDate')
    expect(rangeColumn('each RangeStart <= [#"Order Date"] and [x] < RangeEnd')).toBe('#"Order Date"'.replace(/^#"(.*)"$/, '$1'))
  })

  it('loads the rolling window first, then refreshes only the incremental window', async () => {
    const files: Record<string, string> = {
      '/sales.csv': ['OrderDate,Amount', '2026-08-31T10:00:00,1', '2026-09-01T00:00:00,2', '2026-10-10T12:00:00,3', '2026-11-14T23:00:00,4', '2026-11-15T08:00:00,5', '2026-11-17T08:00:00,6', '2026-11-18T00:00:00,7'].join('\n')
    }
    const host: RefreshHost = { fs: memFs(files), connectors: {} as RefreshHost['connectors'], now: () => new Date(Date.UTC(2026, 10, 17, 9)), localOffsetMinutes: 0 }
    const p = project()
    const first = await refreshProject(p, host)
    expect(first.tables[0]).toMatchObject({ ok: true, rows: 5, incremental: 'rolling window 2026-09-01 – 2026-11-17 loaded' })
    expect(rows(p)).toEqual([
      ['2026-09-01', 2],
      ['2026-10-10', 3],
      ['2026-11-14', 4],
      ['2026-11-15', 5],
      ['2026-11-17', 6]
    ])
    // the source changes everywhere; only the last 3 days are reloaded
    files['/sales.csv'] = ['OrderDate,Amount', '2026-09-01T00:00:00,20', '2026-10-10T12:00:00,30', '2026-11-14T23:00:00,40', '2026-11-15T08:00:00,50', '2026-11-16T09:00:00,55', '2026-11-17T08:00:00,60'].join('\n')
    const second = await refreshProject(p, host)
    expect(second.tables[0]!.incremental).toBe('incremental: 2026-11-15 – 2026-11-17 refreshed (3 rows), 3 archived rows kept')
    expect(rows(p)).toEqual([
      ['2026-09-01', 2],
      ['2026-10-10', 3],
      ['2026-11-14', 4],
      ['2026-11-15', 50],
      ['2026-11-16', 55],
      ['2026-11-17', 60]
    ])
    // a full reload on request
    await refreshProject(p, host, { incremental: false })
    expect(rows(p)).toEqual([])
  })

  it('ignores tables without a usable policy and refreshes published policy tables from the source expression', async () => {
    const files = { '/sales.csv': 'OrderDate,Amount\n2020-01-05T00:00:00,1\n2026-11-17T00:00:00,2' }
    const host: RefreshHost = { fs: memFs(files), connectors: {} as RefreshHost['connectors'], now: () => new Date(Date.UTC(2026, 10, 17, 9)), localOffsetMinutes: 0 }
    const p = project(null)
    await refreshProject(p, host)
    // no policy: the parameters' own values (January 2020) apply, as in Power BI Desktop
    expect(rows(p)).toEqual([['2020-01-05', 1]])
    const published = project({ ...POLICY, sourceExpression: SOURCE })
    published.model.tables[0]!.partitions = [{ name: 'Sales-2026', sourceType: 'policyRange' }]
    expect(tableQuery(published.model, published.model.tables[0]!)).toEqual({ source: SOURCE })
    await refreshProject(published, host)
    expect(rows(published)).toEqual([['2026-11-17', 2]])
  })
})

import { describe, expect, it } from 'vitest'
import type { SemanticModel } from '../../model/types'
import { MError, evaluateQuery, runWithData, toJs, type DataRequest } from '../../m/index.ts'
import { privacyPlan, sourcesOfQuery } from '../fetcher'
import type { DataSourceRef } from '../queries'

const model = (expressions: Array<[string, string]>): SemanticModel => ({ name: 'm', tables: [], relationships: [], roles: [], expressions: expressions.map(([name, expression]) => ({ name, kind: 'm', expression })) })

describe('privacy levels', () => {
  const m = model([
    ['Ids', 'let s = Csv.Document(File.Contents("/secret/ids.csv")) in s[Column1]'],
    ['Limit', '5 meta [IsParameterQuery=true, Type="Number"]']
  ])
  const query = 'let t = PostgreSQL.Database("pg", "shop"){[Schema="public",Item="orders"]}[Data] in Table.SelectRows(t, each List.Contains(Ids, [id]))'

  it('finds the sources a query reads through other queries', () => {
    const s = sourcesOfQuery(m, query)
    expect(s.map((x) => x.kind).sort()).toEqual(['file', 'postgresql'])
  })

  it('keeps Private and Organizational→Public values from being folded into another source', () => {
    const level = (map: Record<string, string>) => (s: DataSourceRef) => map[s.kind] as 'Private' | 'Public' | 'Organizational' | undefined
    const sources = sourcesOfQuery(m, query)
    expect(privacyPlan(sources, level({ file: 'Private', postgresql: 'Organizational' }))).toMatchObject({ foldComputed: false, warnings: [expect.stringMatching(/\/secret\/ids.csv is Private/)] })
    expect(privacyPlan(sources, level({ file: 'Organizational', postgresql: 'Public' }))).toMatchObject({ foldComputed: false })
    // the flow direction isn't tracked: Public + Organizational is handled conservatively (local filters, same numbers)
    expect(privacyPlan(sources, level({ file: 'Public', postgresql: 'Organizational' }))).toMatchObject({ foldComputed: false })
    expect(privacyPlan(sources, level({ file: 'Organizational', postgresql: 'Organizational' }))).toEqual({ foldComputed: true, warnings: [] })
    expect(privacyPlan(sources, level({ file: 'Public', postgresql: 'Public' }))).toEqual({ foldComputed: true, warnings: [] })
    expect(privacyPlan(sources, level({}))).toEqual({ foldComputed: true, warnings: [] })
    expect(privacyPlan([sources[0]!], level({ file: 'Private' }))).toEqual({ foldComputed: true, warnings: [] })
  })

  it('evaluates filters with computed values locally when told to', async () => {
    const run = async (foldComputed: boolean) => {
      const log: DataRequest[] = []
      const v = await runWithData(
        (host) => {
          const ev = evaluateQuery(`let ids = {1, 3}, t = PostgreSQL.Database("pg", "shop"){[Schema="public",Item="t"]}[Data] in Table.SelectRows(t, each List.Contains(ids, [id]) and [id] > 0)`, { host, previewSteps: false })
          if (!ev.result.ok) throw new MError(ev.result.error.reason, ev.result.error.message)
          return toJs(ev.result.value)
        },
        async (req) => {
          log.push(req)
          if (req.kind !== 'db') throw new Error(req.kind)
          return { columns: [{ name: 'id', type: 'integer' }], rows: / LIMIT 0$/.test(req.query) ? [] : [[1], [2], [3]] }
        },
        { foldComputed }
      )
      return { v, sql: (log.at(-1) as { query: string }).query }
    }
    const folded = await run(true)
    expect(folded.sql).toBe(`SELECT * FROM "public"."t" WHERE ("id" IN (1, 3) AND "id" > 0)`)
    const local = await run(false)
    expect(local.sql).toBe(`SELECT * FROM "public"."t"`)
    expect(local.v).toEqual([{ id: 1 }, { id: 3 }])
  })
})

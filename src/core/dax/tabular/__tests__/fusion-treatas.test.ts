/**
 * TREATAS row-value fusion (fusion.ts treatasFusion): the "population per org per date" pattern —
 *   AVERAGEX ( VALUES ( Calendar[Date] ), SUMX ( <orgs>, CALCULATE ( [Headcount], CROSSFILTER ( ..., NONE ),
 *   TREATAS ( { Org[Id] }, Census[OrgId] ) ) ) )
 * must give exactly the per-row results (fusion disabled) and run in one grouped scan per outer row.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildModel, processCalculated, runQuery, setFusionEnabled } from '../index.ts'
import { build, d } from './build.ts'

const ORGS = 60
const DAYS = 120

function model() {
  const orgs: Array<[number, number | null, string]> = []
  for (let i = 1; i <= ORGS; i++) orgs.push([i, i > 10 ? ((i - 1) % 10) + 1 : null, i % 7 === 0 ? 'skip' : 'use'])
  const days: Array<[Date, string]> = []
  for (let k = 0; k < DAYS; k++) {
    const dt = d(2024, 1, 1 + k)
    days.push([dt, 'Q' + (Math.floor(dt.getUTCMonth() / 3) + 1)])
  }
  const pop: Array<[number, Date, number | null]> = []
  for (let i = 1; i <= ORGS; i++)
    for (let k = 0; k < DAYS; k += 1 + (i % 3)) pop.push([i, days[k][0], (i * 37 + k * 11) % 500 === 0 ? null : ((i * 37 + k * 11) % 500) + 1])
  const { model: sm, data } = build({
    tables: {
      Calendar: { columns: { Date: 'dateTime', Quarter: 'string' }, rows: days },
      Org: { columns: { Id: 'int64', Parent: 'int64', Kind: 'string' }, rows: orgs },
      Census: {
        columns: { OrgId: 'int64', Date: 'dateTime', Persons: 'double' },
        rows: pop,
        measures: {
          Headcount: 'AVERAGE ( Census[Persons] )',
          'Headcount Agg': `
            VAR Ctx = VALUES ( Org[Id] )
            VAR Orgs = FILTER ( ALL ( Org ), Org[Kind] = "use" && ( Org[Id] IN Ctx || Org[Parent] IN Ctx ) )
            RETURN AVERAGEX ( VALUES ( Calendar[Date] ),
              SUMX ( Orgs, CALCULATE ( [Headcount], CROSSFILTER ( Org[Id], Census[OrgId], NONE ), TREATAS ( { Org[Id] }, Census[OrgId] ) ) ) )`,
          // the row's transition reaches Census here (no CROSSFILTER): fusion must not apply
          'Headcount Related': `SUMX ( FILTER ( ALL ( Org ), Org[Kind] = "use" ), CALCULATE ( [Headcount], TREATAS ( { Org[Id] }, Census[OrgId] ) ) )`,
          'Headcount Max': `SUMX ( ALL ( Org ), CALCULATE ( MAX ( Census[Persons] ), CROSSFILTER ( Org[Id], Census[OrgId], NONE ), TREATAS ( { Org[Parent] }, Census[OrgId] ) ) )`
        }
      }
    },
    relationships: [
      { from: 'Census.OrgId', to: 'Org.Id' },
      { from: 'Census.Date', to: 'Calendar.Date' }
    ]
  })
  const m = buildModel(sm, data)
  processCalculated(m)
  return m
}

const query = (measure: string) => `EVALUATE SUMMARIZECOLUMNS ( Calendar[Quarter], Org[Kind], "v", [${measure}] ) ORDER BY Calendar[Quarter], Org[Kind]`
const round = (rows: unknown[][]) => rows.map((r) => r.map((v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)))

describe('TREATAS row-value fusion', () => {
  afterEach(() => setFusionEnabled(true))
  for (const measure of ['Headcount Agg', 'Headcount Related', 'Headcount Max']) {
    it(`${measure}: same results as per-row evaluation`, () => {
      const fused = round(runQuery(model(), query(measure))[0].rows)
      setFusionEnabled(false)
      const plain = round(runQuery(model(), query(measure))[0].rows)
      expect(fused.length).toBeGreaterThan(0)
      expect(fused).toEqual(plain)
    })
  }
  it('per-org per-date CALCULATE inside iterators runs in grouped scans', () => {
    const m = model()
    const t0 = performance.now()
    runQuery(m, query('Headcount Agg'))
    const fused = performance.now() - t0
    setFusionEnabled(false)
    const m2 = model()
    const t1 = performance.now()
    runQuery(m2, query('Headcount Agg'))
    const plain = performance.now() - t1
    // generous ratio (parallel test load): the fused path skips ~ORGS transitions per date
    expect(fused).toBeLessThan(plain / 2)
  })
})

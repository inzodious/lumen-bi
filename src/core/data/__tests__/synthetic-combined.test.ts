/**
 * Sample data for a model whose fact is a *calculated* table combining several imported feeds
 * (UNION of SELECTCOLUMNS), with the relationships, measures and filters all pointing at the calculated
 * table — an invented survey model. Covers: key consistency through calculated-table lineage, unique
 * "one"-side keys, realistic survey scores, feed sizing, a calendar that ends today, the privacy rule
 * for identifying literals, and regeneration.
 */
import { describe, expect, it } from 'vitest'
import { emptyDataStore, makeDate, type Scalar, type TableData } from '../../model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '../../model/types'
import type { ProjectDocument } from '../../project'
import type { ReportDocument } from '../../report/types'
import { createEngine } from '../../engine/engine'
import { readWbi, writeWbi } from '../../io/wbi'
import { columnSemantics, generateSyntheticData, isIdentifyingColumn } from '../synthetic'
import { isPlaceholderLabel, normalCdf, npsBandOf, sentimentOf, surveyWeights } from '../synthetic-values'

const TODAY = makeDate(2026, 11, 17)

function col(name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}
function imported(name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef {
  return { name, columns, measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', expression: `let Source = Sql.Database("server", "db"), T = Source{[Schema="dbo",Item="${name}"]}[Data] in T` }], ...extra }
}
function rel(from: string, to: string, extra: Partial<RelationshipDef> = {}): RelationshipDef {
  const [ft, fc] = from.split('.')
  const [tt, tc] = to.split('.')
  return { name: `${from}->${to}`, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc, fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true, ...extra }
}

const COMBINED = `
UNION (
    SELECTCOLUMNS ( web_responses,
        "response_id", web_responses[id], "answered_on", web_responses[answered_on], "feed", "Web",
        "recommend", web_responses[recommend_score], "promoter_group", web_responses[promoter_group], "clinic_id", web_responses[clinic_id],
        "rating_staff", web_responses[rating_staff], "rating_wait", web_responses[rating_wait], "rating_facility", web_responses[rating_facility],
        "visit_reason", web_responses[visit_reason], "comment", web_responses[comment], "age_band", web_responses[age_band] ),
    SELECTCOLUMNS ( kiosk_responses,
        "response_id", "n/a", "answered_on", kiosk_responses[answered_on], "feed", "Kiosk",
        "recommend", kiosk_responses[recommend_score], "promoter_group", kiosk_responses[promoter_group], "clinic_id", "None",
        "rating_staff", kiosk_responses[rating_staff], "rating_wait", kiosk_responses[rating_wait], "rating_facility", BLANK (),
        "visit_reason", kiosk_responses[visit_reason], "comment", BLANK (), "age_band", BLANK () ),
    SELECTCOLUMNS ( phone_responses,
        "response_id", phone_responses[id], "answered_on", phone_responses[called_on], "feed", "Phone",
        "recommend", phone_responses[recommend_score] * 2, "promoter_group", phone_responses[promoter_group], "clinic_id", "None",
        "rating_staff", BLANK (), "rating_wait", BLANK (), "rating_facility", BLANK (),
        "visit_reason", BLANK (), "comment", BLANK (), "age_band", BLANK () )
)`
const COMBINED_COLUMNS = ['response_id', 'answered_on', 'feed', 'recommend', 'promoter_group', 'clinic_id', 'rating_staff', 'rating_wait', 'rating_facility', 'visit_reason', 'comment', 'age_band']

function surveyProject(): ProjectDocument {
  const measures = imported('_measures', [col('Column1', 'string')], {
    partitions: [{ name: '_measures', sourceType: 'm', expression: 'let Source = Table.FromRows({}, type table [Column1 = text]) in Source' }],
    measures: [
      { name: 'Responses', expression: 'COUNTROWS ( responses )' },
      { name: 'Promoters %', expression: 'CALCULATE ( COUNTROWS ( responses ), responses[promoter_group] = "Promoter" ) / COUNTROWS ( responses )' },
      { name: 'Detractors %', expression: 'CALCULATE ( COUNTROWS ( responses ), responses[promoter_group] = "Detractor" ) / COUNTROWS ( responses )' },
      { name: 'NPS', expression: '( [Promoters %] - [Detractors %] ) * 100' },
      { name: 'Satisfied %', expression: 'DIVIDE ( CALCULATE ( COUNTROWS ( responses ), responses[rating_staff] >= 4 ), COUNTROWS ( responses ) )' },
      { name: 'Web Promoters', expression: 'CALCULATE ( [Responses], responses[feed] = "Web", responses[promoter_group] = "Promoter" )' },
      { name: 'Named Clinic', expression: 'CALCULATE ( [Responses], clinics[clinic_name] = "Riverbend Family Practice" )' },
      { name: 'Walk Ins', expression: 'CALCULATE ( [Responses], responses[visit_reason] = "Walk-in" )' },
      { name: 'NPS LY', expression: 'CALCULATE ( [NPS], SAMEPERIODLASTYEAR ( calendar[date] ) )' }
    ]
  })
  const calendar = imported('calendar', [col('date', 'dateTime', { isKey: true }), col('year', 'int64'), col('month', 'int64'), col('year_month', 'string'), col('month_name', 'string')], {
    dataCategory: 'Time',
    partitions: [{ name: 'calendar', sourceType: 'm', expression: 'let Source = Sql.Database("server", "db"), T = Source{[Schema="dbo",Item="calendar"]}[Data], Kept = Table.SelectRows(T, each [date] <= Date.From(DateTime.LocalNow())) in Kept' }]
  })
  const clinics = imported('clinics', [col('clinic_guid', 'string'), col('clinic_name', 'string'), col('parent_clinic', 'string'), col('manager_email', 'string'), col('region', 'string')])
  const web = imported('web_responses', [
    col('id', 'string'),
    col('clinic_id', 'string'),
    col('answered_on', 'dateTime'),
    col('recommend_score', 'int64'),
    col('promoter_group', 'string'),
    col('rating_staff', 'int64'),
    col('rating_wait', 'int64'),
    col('rating_facility', 'int64'),
    col('visit_reason', 'string'),
    col('comment', 'string'),
    col('age_band', 'string')
  ])
  const kiosk = imported('kiosk_responses', [col('answered_on', 'dateTime'), col('recommend_score', 'int64'), col('promoter_group', 'string'), col('rating_staff', 'int64'), col('rating_wait', 'int64'), col('visit_reason', 'string')])
  const phone = imported('phone_responses', [col('id', 'string'), col('called_on', 'dateTime'), col('recommend_score', 'int64'), col('promoter_group', 'string')])
  const responses: TableDef = {
    name: 'responses',
    // Power BI writes inferred calculated-table columns without a data type
    columns: COMBINED_COLUMNS.map((c) => ({ name: c, dataType: 'unknown', kind: 'calculatedTableColumn', sourceColumn: `[${c}]` })),
    measures: [],
    hierarchies: [],
    partitions: [{ name: 'responses', sourceType: 'calculated', expression: COMBINED }]
  }
  const model: SemanticModel = {
    name: 'Survey',
    tables: [measures, calendar, clinics, web, kiosk, phone, responses],
    relationships: [rel('responses.answered_on', 'calendar.date'), rel('responses.clinic_id', 'clinics.clinic_guid')],
    expressions: [],
    roles: []
  }
  const sqIn = (alias: string, entity: string, column: string, literals: string[]) => ({
    Version: 2,
    From: [{ Name: alias, Entity: entity, Type: 0 }],
    Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: alias } }, Property: column } }], Values: literals.map((l) => [{ Literal: { Value: l } }]) } } }]
  })
  const report: ReportDocument = {
    origin: 'pbir',
    report: { filterConfig: { filters: [{ name: 'f1', filter: sqIn('c', 'clinics', 'clinic_guid', ["'0f3b6c1e-aaaa-4bbb-8ccc-1234567890ab'"]) }] } },
    pagesMeta: { pageOrder: ['p1'] },
    pages: [{ name: 'p1', json: { filterConfig: { filters: [{ name: 'f2', filter: sqIn('c', 'clinics', 'manager_email', ["'dana.reyes@riverbend.example'"]) }] } }, visuals: [] }],
    bookmarks: [],
    theme: {},
    resources: []
  } as unknown as ReportDocument
  return { id: 'survey', name: 'Survey', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

function values(p: ProjectDocument, table: string, column: string): Scalar[] {
  const c = p.data.tables.get(table)?.columns.find((x) => x.name === column)
  if (!c) throw new Error(`missing ${table}[${column}]`)
  return c.values
}
const key = (v: Scalar): string => (v instanceof Date ? `d${v.getTime()}` : typeof v === 'string' ? `s${v.toLowerCase()}` : `${typeof v}${String(v)}`)
const share = (vs: Scalar[], test: (v: Scalar) => boolean): number => vs.filter(test).length / Math.max(1, vs.length)

function generate(opts: Parameters<typeof generateSyntheticData>[1] = {}) {
  const p = surveyProject()
  const res = generateSyntheticData(p, { seed: 7, today: TODAY, factRows: 6000, ...opts })
  const engine = createEngine(p.model, p.data)
  engine.processCalculated()
  const scalar = (dax: string): number => Number(engine.evaluateScalar(dax).value)
  const rows = (dax: string): Scalar[][] => engine.runDaxQuery(dax).tables[0].rows
  return { p, res, engine, scalar, rows }
}

describe('sample data for a calculated fact that combines several feeds', () => {
  const g = generate()

  it('fills every imported table and says why the others have no generated rows', () => {
    for (const t of ['calendar', 'clinics', 'web_responses', 'kiosk_responses', 'phone_responses']) expect(g.p.data.tables.get(t)!.rowCount, t).toBeGreaterThan(0)
    expect(g.res.skipped).toEqual([
      { table: '_measures', reason: 'measureTable' },
      { table: 'responses', reason: 'calculated' }
    ])
    // the calculated table is computed by the engine from the generated rows
    const feeds = ['web_responses', 'kiosk_responses', 'phone_responses'].reduce((n, t) => n + g.p.data.tables.get(t)!.rowCount, 0)
    expect(g.p.data.tables.get('responses')!.rowCount).toBe(feeds)
    expect(g.p.data.status.get('responses')).toMatchObject({ state: 'loaded', source: 'calculated' })
  })

  it('keeps the "one" side of each relationship unique although its many side is the calculated table', () => {
    const guids = values(g.p, 'clinics', 'clinic_guid')
    expect(new Set(guids.map(key)).size).toBe(guids.length)
    expect(guids.every((v) => typeof v === 'string' && v.length > 0)).toBe(true)
    const dates = values(g.p, 'calendar', 'date')
    expect(new Set(dates.map(key)).size).toBe(dates.length)
  })

  it('draws the feeds\' foreign keys from the dimension the calculated table is related to', () => {
    const guids = new Set(values(g.p, 'clinics', 'clinic_guid').map(key))
    expect(values(g.p, 'web_responses', 'clinic_id').every((v) => v !== null && guids.has(key(v)))).toBe(true)
    const days = new Set(values(g.p, 'calendar', 'date').map(key))
    for (const [t, c] of [['web_responses', 'answered_on'], ['kiosk_responses', 'answered_on'], ['phone_responses', 'called_on']] as const) {
      expect(values(g.p, t, c).every((v) => v !== null && days.has(key(v))), `${t}[${c}]`).toBe(true)
    }
    // in the engine: only the feeds whose key is the literal "None" land on the blank dimension row
    const byClinic = g.rows('EVALUATE SUMMARIZECOLUMNS ( clinics[clinic_name], "n", [Responses] )')
    const blank = byClinic.find((r) => r[0] === null)
    const others = g.p.data.tables.get('kiosk_responses')!.rowCount + g.p.data.tables.get('phone_responses')!.rowCount
    expect(blank?.[1]).toBe(others)
    expect(byClinic.length).toBeGreaterThan(20)
  })

  it('ends a calendar whose query stops at the current date today, with fact rows up to it', () => {
    const dates = values(g.p, 'calendar', 'date') as Date[]
    expect(dates[dates.length - 1].getTime()).toBe(TODAY.getTime())
    expect(dates[0].getTime()).toBe(makeDate(2024, 1, 1).getTime())
    const last = Math.max(...(values(g.p, 'web_responses', 'answered_on') as Date[]).map((d) => d.getTime()))
    expect(last).toBeLessThanOrEqual(TODAY.getTime())
    expect(TODAY.getTime() - last).toBeLessThan(10 * 86400000)
  })

  it('keeps whole calendar years when the query runs to the end of a period or does not look at the clock', () => {
    for (const m of [
      'let T = Source{[Item="calendar"]}[Data], Kept = Table.SelectRows(T, each [date] <= Date.EndOfYear(Date.From(DateTime.LocalNow()))) in Kept',
      'let T = Source{[Item="calendar"]}[Data] in T'
    ]) {
      const p = surveyProject()
      p.model.tables.find((t) => t.name === 'calendar')!.partitions[0].expression = m
      generateSyntheticData(p, { seed: 7, today: TODAY, factRows: 500 })
      const dates = values(p, 'calendar', 'date') as Date[]
      expect(dates[dates.length - 1].getTime(), m).toBe(makeDate(2026, 12, 31).getTime())
      expect(new Set(dates.map(key)).size).toBe(dates.length)
    }
  })

  it('skews likelihood-to-recommend and ratings to the top, like real survey answers', () => {
    const scores = values(g.p, 'web_responses', 'recommend_score') as number[]
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...scores)).toBe(10)
    expect(share(scores, (v) => (v as number) >= 9)).toBeGreaterThan(0.5)
    expect(share(scores, (v) => (v as number) <= 6)).toBeLessThan(0.25)
    for (const c of ['rating_staff', 'rating_wait', 'rating_facility']) {
      const r = values(g.p, 'web_responses', c) as number[]
      expect(new Set(r).size, c).toBe(5)
      expect(share(r, (v) => (v as number) >= 4), c).toBeGreaterThan(0.75)
      expect(share(r, (v) => (v as number) <= 2), c).toBeLessThan(0.12)
    }
    // one respondent's answers go together: ratings correlate within a row
    const a = values(g.p, 'web_responses', 'rating_staff') as number[]
    const b = values(g.p, 'web_responses', 'rating_wait') as number[]
    const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length
    const ma = mean(a)
    const mb = mean(b)
    const cov = mean(a.map((v, i) => (v - ma) * (b[i] - mb)))
    const corr = cov / Math.sqrt(mean(a.map((v) => (v - ma) ** 2)) * mean(b.map((v) => (v - mb) ** 2)))
    expect(corr).toBeGreaterThan(0.15)
  })

  it('derives the promoter / passive / detractor group from the score of the same row', () => {
    for (const t of ['web_responses', 'kiosk_responses']) {
      const s = values(g.p, t, 'recommend_score') as number[]
      const grp = values(g.p, t, 'promoter_group') as string[]
      expect(new Set(grp)).toEqual(new Set(['Promoter', 'Passive', 'Detractor']))
      grp.forEach((label, i) => expect(label, `${t} row ${i} score ${s[i]}`).toBe(s[i] >= 9 ? 'Promoter' : s[i] >= 7 ? 'Passive' : 'Detractor'))
    }
  })

  it('stores a feed that the calculated table doubles on a scale half as wide', () => {
    const s = values(g.p, 'phone_responses', 'recommend_score') as number[]
    const grp = values(g.p, 'phone_responses', 'promoter_group') as string[]
    expect(Math.max(...s)).toBe(5)
    expect(Math.min(...s)).toBeGreaterThanOrEqual(0)
    grp.forEach((label, i) => expect(label).toBe(s[i] >= 5 ? 'Promoter' : s[i] >= 4 ? 'Passive' : 'Detractor'))
    expect(g.scalar('MAXX ( responses, responses[recommend] )')).toBe(10)
  })

  it('gives a positive, plausible net promoter score overall and per feed', () => {
    const nps = g.scalar('[NPS]')
    expect(nps).toBeGreaterThan(30)
    expect(nps).toBeLessThan(70)
    expect(g.scalar('[Promoters %]')).toBeGreaterThan(g.scalar('[Detractors %]') * 2)
    for (const r of g.rows('EVALUATE SUMMARIZECOLUMNS ( responses[feed], "nps", [NPS], "n", [Responses] )')) {
      expect(r[1] as number, String(r[0])).toBeGreaterThan(25)
      expect(r[1] as number, String(r[0])).toBeLessThan(75)
    }
    expect(g.scalar('[Web Promoters]')).toBeGreaterThan(100)
  })

  it('sizes a feed by how much of the combined table it fills, so totals stay close to their parts', () => {
    const n = (t: string) => g.p.data.tables.get(t)!.rowCount
    expect(n('web_responses')).toBeGreaterThan(n('kiosk_responses'))
    expect(n('kiosk_responses')).toBeGreaterThan(n('phone_responses'))
    expect(n('phone_responses')).toBeLessThan(n('web_responses') * 0.2)
    // "Satisfied %" divides by every response; feeds without that rating only lower the total a little
    const total = g.scalar('[Satisfied %]')
    const parts = g.rows('EVALUATE SUMMARIZECOLUMNS ( responses[feed], "s", [Satisfied %] )').filter((r) => r[1] !== null)
    expect(parts.length).toBe(2)
    for (const r of parts) expect(Math.abs((r[1] as number) - total), String(r[0])).toBeLessThan(0.12)
    expect(total).toBeGreaterThan(0.7)
  })

  it('keeps month-over-month and year-over-year comparisons sane', () => {
    const months = g.rows('EVALUATE SUMMARIZECOLUMNS ( calendar[year_month], "n", [Responses], "nps", [NPS], "ly", [NPS LY] ) ORDER BY calendar[year_month]')
    expect(months.length).toBeGreaterThanOrEqual(30)
    for (const [ym, n, nps, ly] of months as Array<[string, number, number, number | null]>) {
      expect(n, ym).toBeGreaterThan(40)
      expect(nps, ym).toBeGreaterThan(15)
      if (ly !== null) expect(Math.abs((nps - ly) / Math.abs(ly)), ym).toBeLessThan(0.8)
    }
    // …and not flat either
    const series = months.map((m) => m[2] as number)
    expect(Math.max(...series) - Math.min(...series)).toBeGreaterThan(3)
  })

  it('never copies names, ids, e-mail addresses or free text from formulas and filters into the data', () => {
    const all = (t: string): string[] => g.p.data.tables.get(t)!.columns.flatMap((c) => c.values.filter((v): v is string => typeof v === 'string'))
    const haystack = ['clinics', 'web_responses', 'kiosk_responses', 'phone_responses'].flatMap(all).map((s) => s.toLowerCase())
    for (const literal of ['riverbend family practice', '0f3b6c1e-aaaa-4bbb-8ccc-1234567890ab', 'dana.reyes@riverbend.example']) expect(haystack, literal).not.toContain(literal)
    // the run reports what it withheld (columns and counts only, never the literals)
    expect(g.res.withheld).toEqual(
      expect.arrayContaining([
        { table: 'clinics', column: 'clinic_guid', literals: 1, kind: 'id' },
        { table: 'clinics', column: 'clinic_name', literals: 1, kind: 'name' },
        { table: 'clinics', column: 'manager_email', literals: 1, kind: 'name' }
      ])
    )
    expect(JSON.stringify(g.res.withheld).toLowerCase()).not.toContain('riverbend')
    // categories, constants of the definition and placeholders are still reused: filtered measures hit
    expect(values(g.p, 'web_responses', 'visit_reason')).toContain('Walk-in')
    expect(g.scalar('[Walk Ins]')).toBeGreaterThan(0)
    expect(g.scalar('[Named Clinic]') || 0).toBe(0)
  })

  it('reuses identifying literals only when asked to', () => {
    const r = generate({ identifyingLiterals: 'reuse' })
    expect(values(r.p, 'clinics', 'clinic_name')).toContain('Riverbend Family Practice')
    expect(values(r.p, 'clinics', 'clinic_guid')).toContain('0f3b6c1e-aaaa-4bbb-8ccc-1234567890ab')
    expect(r.res.withheld).toEqual([])
    expect(r.scalar('[Named Clinic]')).toBeGreaterThan(0)
  })

  it('invents organisation hierarchies that roll up', () => {
    const names = values(g.p, 'clinics', 'clinic_name') as string[]
    const parents = values(g.p, 'clinics', 'parent_clinic') as string[]
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(parents).size).toBeLessThan(names.length / 2)
    expect(parents.some((p, i) => p === names[i])).toBe(false)
  })
})

describe('regenerating sample data', () => {
  const snapshot = (p: ProjectDocument, t: string): string => JSON.stringify(p.data.tables.get(t))

  it('is deterministic per seed and different across seeds, with the same guarantees', () => {
    const a = generate({ seed: 7 })
    const b = generate({ seed: 7 })
    const c = generate({ seed: 8 })
    for (const t of ['clinics', 'web_responses', 'phone_responses']) {
      expect(snapshot(b.p, t), t).toBe(snapshot(a.p, t))
      expect(snapshot(c.p, t), t).not.toBe(snapshot(a.p, t))
    }
    expect(c.res.seed).toBe(8)
    const guids = new Set(values(c.p, 'clinics', 'clinic_guid').map(key))
    expect(values(c.p, 'web_responses', 'clinic_id').every((v) => guids.has(key(v)))).toBe(true)
    expect(c.scalar('[NPS]')).toBeGreaterThan(30)
  })

  it("replace: 'empty' keeps what is there; 'synthetic' regenerates sample tables but never real data; 'all' replaces everything", () => {
    const p = surveyProject()
    const real: TableData = {
      rowCount: 2,
      columns: [
        { name: 'clinic_guid', type: 'string', values: ['real-1', 'real-2'] },
        { name: 'clinic_name', type: 'string', values: ['Loaded A', 'Loaded B'] },
        { name: 'parent_clinic', type: 'string', values: [null, null] },
        { name: 'manager_email', type: 'string', values: [null, null] },
        { name: 'region', type: 'string', values: ['North', 'South'] }
      ]
    }
    p.data.tables.set('clinics', real)
    p.data.status.set('clinics', { state: 'loaded', source: 'query', rowCount: 2 })

    const first = generateSyntheticData(p, { seed: 1, today: TODAY, factRows: 2000 })
    expect(first.tables).not.toContain('clinics')
    expect(first.skipped).toContainEqual({ table: 'clinics', reason: 'hasData' })
    // the feeds reference the loaded dimension's real keys
    expect(new Set(values(p, 'web_responses', 'clinic_id'))).toEqual(new Set(['real-1', 'real-2']))
    const before = snapshot(p, 'web_responses')

    const again = generateSyntheticData(p, { seed: 2, today: TODAY, factRows: 2000 })
    expect(again.tables.filter((t) => (p.data.tables.get(t)?.rowCount ?? 0) > 0)).toEqual([])
    expect(snapshot(p, 'web_responses')).toBe(before)

    const regen = generateSyntheticData(p, { seed: 2, today: TODAY, factRows: 2000, replace: 'synthetic' })
    expect(regen.tables).toEqual(expect.arrayContaining(['calendar', 'web_responses', 'kiosk_responses', 'phone_responses']))
    expect(regen.tables).not.toContain('clinics')
    expect(snapshot(p, 'web_responses')).not.toBe(before)
    expect(p.data.tables.get('clinics')).toBe(real)
    expect(new Set(values(p, 'web_responses', 'clinic_id'))).toEqual(new Set(['real-1', 'real-2']))

    const all = generateSyntheticData(p, { seed: 3, today: TODAY, factRows: 2000, replace: 'all' })
    expect(all.tables).toContain('clinics')
    expect(p.data.tables.get('clinics')).not.toBe(real)
    expect(p.data.status.get('clinics')).toMatchObject({ source: 'synthetic' })
    expect(values(p, 'clinics', 'clinic_name')).not.toContain('Loaded A')
  })

  it('recomputes calculated tables from the regenerated rows', () => {
    const p = surveyProject()
    generateSyntheticData(p, { seed: 1, today: TODAY, factRows: 2000 })
    const e1 = createEngine(p.model, p.data)
    e1.processCalculated()
    const first = snapshot(p, 'responses')
    generateSyntheticData(p, { seed: 99, today: TODAY, factRows: 2000, replace: 'synthetic' })
    const e2 = createEngine(p.model, p.data)
    e2.processCalculated()
    expect(snapshot(p, 'responses')).not.toBe(first)
    const feeds = ['web_responses', 'kiosk_responses', 'phone_responses'].reduce((n, t) => n + p.data.tables.get(t)!.rowCount, 0)
    expect(p.data.tables.get('responses')!.rowCount).toBe(feeds)
  })
})

describe('showcasing: a .wbi bundle keeps the sample data', () => {
  it('round-trips every generated and calculated table, value types and the "sample data" status', () => {
    const { p } = generate({ factRows: 1500 })
    const back = readWbi(writeWbi('Survey', {}, p.data)).data
    expect([...back.tables.keys()].sort()).toEqual([...p.data.tables.keys()].sort())
    for (const [name, t] of p.data.tables) {
      const b = back.tables.get(name)!
      expect(b.rowCount, name).toBe(t.rowCount)
      expect(b.columns.map((c) => [c.name, c.type]), name).toEqual(t.columns.map((c) => [c.name, c.type]))
      for (const c of t.columns) expect(b.columns.find((x) => x.name === c.name)!.values, `${name}[${c.name}]`).toEqual(c.values)
      expect(back.status.get(name), name).toEqual(p.data.status.get(name))
    }
    expect(back.status.get('web_responses')).toMatchObject({ state: 'loaded', source: 'synthetic' })
    expect(back.status.get('responses')).toMatchObject({ state: 'loaded', source: 'calculated' })
    // reopened: the engine accepts the stored calculated table and measures give the same numbers
    const reopened: ProjectDocument = { ...surveyProject(), data: back }
    const engine = createEngine(reopened.model, reopened.data)
    engine.processCalculated()
    const first = createEngine(p.model, p.data)
    first.processCalculated()
    expect(engine.evaluateScalar('[NPS]').value).toBe(first.evaluateScalar('[NPS]').value)
    // nothing is regenerated when sample data is requested again: every table already has rows
    const again = generateSyntheticData(reopened, { seed: 123, today: TODAY })
    expect(again.tables.filter((t) => (reopened.data.tables.get(t)?.rowCount ?? 0) > 0)).toEqual([])
    expect(reopened.data.tables.get('web_responses')).toBe(back.tables.get('web_responses'))
  })
})

describe('survey realism helpers', () => {
  it('normalCdf matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5)
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 5)
  })

  it('surveyWeights are normalised, increasing at the top, and give a net promoter score near +50 on 0–10', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 10, 11]) {
      const w = surveyWeights(n)
      expect(w.length).toBe(n)
      expect([...w].reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6)
      expect(w[n - 1]).toBeGreaterThan(w[0] * 4)
    }
    const w = surveyWeights(11)
    const nps = (w[9] + w[10] - [...w].slice(0, 7).reduce((s, x) => s + x, 0)) * 100
    expect(nps).toBeGreaterThan(40)
    expect(nps).toBeLessThan(60)
    const five = surveyWeights(5)
    expect(five[3] + five[4]).toBeGreaterThan(0.8)
  })

  it('recognises sentiment labels and net-promoter bands', () => {
    expect(sentimentOf('Very Satisfied')).toBe(2)
    expect(sentimentOf('Promoter')).toBe(2)
    expect(sentimentOf('satisfied')).toBe(1)
    expect(sentimentOf('Neutral')).toBe(0)
    expect(sentimentOf('Dissatisfied')).toBe(-1)
    expect(sentimentOf('Strongly disagree')).toBe(-2)
    expect(sentimentOf('Enterprise')).toBeUndefined()
    expect(npsBandOf('Promoters')).toBe('promoter')
    expect(npsBandOf('passive')).toBe('passive')
    expect(npsBandOf('Detractor')).toBe('detractor')
    expect(npsBandOf('Gold')).toBeUndefined()
  })

  it('weights mined sentiment labels towards the positive end', () => {
    const fact = imported('fact_tickets', [col('id', 'int64'), col('opened_on', 'dateTime'), col('csat_answer', 'string'), col('amount', 'double')], {
      measures: [
        { name: 'Happy', expression: 'CALCULATE ( COUNTROWS ( fact_tickets ), fact_tickets[csat_answer] = "Satisfied" )' },
        { name: 'Unhappy', expression: 'CALCULATE ( COUNTROWS ( fact_tickets ), fact_tickets[csat_answer] IN { "Dissatisfied", "Neutral" } )' }
      ]
    })
    const p: ProjectDocument = { id: 't', name: 't', source: { kind: 'new' }, model: { name: 't', tables: [fact], relationships: [], expressions: [], roles: [] }, data: emptyDataStore(), report: undefined, diagnostics: [], dirty: false } as unknown as ProjectDocument
    generateSyntheticData(p, { seed: 3, today: TODAY, factRows: 4000 })
    const v = values(p, 'fact_tickets', 'csat_answer')
    const s = share(v, (x) => x === 'Satisfied')
    const d = share(v, (x) => x === 'Dissatisfied')
    expect(s).toBeGreaterThan(0.5)
    expect(d).toBeLessThan(0.2)
    expect(d).toBeGreaterThan(0.03)
    expect(share(v, (x) => x === 'Neutral')).toBeGreaterThan(d)
  })

  it('classifies identifying columns and placeholders', () => {
    const t = imported('dim_customer', [])
    const sem = (name: string, type: DataType = 'string') => columnSemantics(col(name, type), t)
    for (const name of ['customer_name', 'email', 'phone_number', 'customer_id', 'account_guid', 'street_address', 'notes']) expect(isIdentifyingColumn(sem(name)), name).toBe(true)
    for (const name of ['segment', 'customer_class', 'status_name', 'account_tier', 'region', 'is_active']) expect(isIdentifyingColumn(sem(name)), name).toBe(false)
    // attribute / value tables: `name` holds attribute names, not somebody's name
    const eav = imported('fact_metrics', [col('name', 'string'), col('value', 'double')])
    expect(isIdentifyingColumn(columnSemantics(eav.columns[0], eav))).toBe(false)
    for (const ok of ['Unknown', 'N/A', 'None', '(Blank)', 'not provided', 'Other']) expect(isPlaceholderLabel(ok), ok).toBe(true)
    for (const no of ['Acme Clinic', 'Jordan Lee', 'North']) expect(isPlaceholderLabel(no), no).toBe(false)
  })
})

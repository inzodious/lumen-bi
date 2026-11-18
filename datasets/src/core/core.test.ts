import { describe, expect, it } from 'vitest'
import { parseTmdlText } from '../../../src/core/tmdl/parser.ts'
import {
  addDays, addMonths, dateDimRows, dateKey, fiscalMonth, fiscalQuarter, fiscalYear, GENERIC_HOLIDAYS, holidayDate, isoDow, isoWeek, timeDimRows, timeKey, ymd
} from './calendar.ts'
import {
  classifyDate, detectIssue, formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectNulls, injectOrphans,
  injectOutliers, injectSentinels, injectWhitespace, landingDay, parseAnyDate
} from './chaos.ts'
import { Rng, uuidFrom, weightedPicker, zipfWeights } from './prng.ts'
import { evolve, Scd2Index, scd2Rows } from './scd2.ts'
import { c, label, SCALES } from './schema.ts'
import type { BronzeFile, BronzeRow, IssueDoc, TableSpec } from './schema.ts'
import { rowsToTable } from './runner.ts'
import { modelToTmdlFiles, tmdlName } from './semantic/tmdl.ts'
import { layoutPage } from './semantic/pbip.ts'
import { scd2Errors } from './validate.ts'

describe('prng', () => {
  it('is deterministic per seed and label', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    const xs = Array.from({ length: 50 }, () => a.next())
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(xs)
    expect(new Rng(43).next()).not.toEqual(xs[0])
    expect(new Rng(42).fork('x').next()).toEqual(new Rng(42).fork('x').next())
    expect(new Rng(42).fork('x').next()).not.toEqual(new Rng(42).fork('y').next())
  })

  it('forks are independent of draws on the parent', () => {
    const p1 = new Rng('s')
    const p2 = new Rng('s')
    p2.next()
    p2.next()
    expect(p1.fork('child').int(0, 1_000_000)).toEqual(p2.fork('child').int(0, 1_000_000))
  })

  it('distributions have the expected centre', () => {
    const r = new Rng('dist')
    const n = 20_000
    let sum = 0
    let pois = 0
    const logs: number[] = []
    for (let i = 0; i < n; i++) {
      sum += r.normal(10, 2)
      pois += r.poisson(3.5)
      logs.push(r.logNormal(100, 0.8))
    }
    expect(sum / n).toBeCloseTo(10, 0)
    expect(pois / n).toBeGreaterThan(3.3)
    expect(pois / n).toBeLessThan(3.7)
    logs.sort((x, y) => x - y)
    expect(logs[n / 2]).toBeGreaterThan(90)
    expect(logs[n / 2]).toBeLessThan(110)
    const big = Array.from({ length: 2000 }, () => r.poisson(120))
    expect(big.reduce((x, y) => x + y, 0) / big.length).toBeCloseTo(120, -1)
    const beta = Array.from({ length: 5000 }, () => r.betaMean(0.3, 20))
    expect(beta.reduce((x, y) => x + y, 0) / beta.length).toBeCloseTo(0.3, 1)
    for (const b of beta) expect(b).toBeGreaterThan(0)
  })

  it('int / pick / sample / weighted stay in range', () => {
    const r = new Rng(1)
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
    }
    const s = r.sample([1, 2, 3, 4, 5, 6], 4)
    expect(new Set(s).size).toBe(4)
    const pick = weightedPicker(['a', 'b', 'c'], [0, 1, 0])
    for (let i = 0; i < 100; i++) expect(pick(r)).toBe('b')
    expect(r.weighted(['x', 'y'], [1, 0])).toBe('x')
    expect(zipfWeights(3)).toEqual([1, 0.5, 1 / 3])
  })

  it('uuidFrom is stable and RFC-4122 shaped', () => {
    expect(uuidFrom('a')).toBe(uuidFrom('a'))
    expect(uuidFrom('a')).not.toBe(uuidFrom('b'))
    expect(uuidFrom('anything')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('calendar', () => {
  it('computes ISO weeks, weekdays and keys', () => {
    expect(isoWeek(ymd(2026, 1, 1))).toEqual({ year: 2026, week: 1 })
    expect(isoWeek(ymd(2021, 1, 3))).toEqual({ year: 2020, week: 53 })
    expect(isoDow(ymd(2026, 11, 30))).toBe(1)
    expect(dateKey(ymd(2026, 3, 9))).toBe(20260309)
    expect(timeKey(ymd(2026, 1, 1, 13, 52))).toBe(1345)
    expect(addMonths(ymd(2026, 1, 31), 1)).toEqual(ymd(2026, 2, 28))
  })

  it('handles fiscal calendars', () => {
    expect(fiscalYear(ymd(2026, 9, 30), 10)).toBe(2026)
    expect(fiscalYear(ymd(2026, 10, 1), 10)).toBe(2027)
    expect(fiscalMonth(ymd(2026, 10, 1), 10)).toBe(1)
    expect(fiscalQuarter(ymd(2027, 3, 31), 4)).toBe(4)
    expect(fiscalYear(ymd(2026, 6, 1), 1)).toBe(2026)
  })

  it('resolves holiday rules', () => {
    const thanksgiving = GENERIC_HOLIDAYS.find((h) => h.name === 'Thanksgiving')!
    expect(holidayDate(thanksgiving, 2026)).toEqual(ymd(2026, 11, 26))
    expect(holidayDate({ name: 'Last Monday of May', month: 5, weekday: 1, nth: -1 }, 2026)).toEqual(ymd(2026, 5, 25))
  })

  it('builds a contiguous date dimension with offsets', () => {
    const rows = dateDimRows({ start: ymd(2025, 1, 1), end: ymd(2026, 12, 31), today: ymd(2026, 11, 30), fiscalStartMonth: 7, holidays: GENERIC_HOLIDAYS })
    expect(rows).toHaveLength(730)
    const today = rows.find((r) => r.date_key === 20261130)!
    expect(today.day_offset).toBe(0)
    expect(today.month_offset).toBe(0)
    expect(today.fiscal_year).toBe(2027)
    expect(rows.find((r) => r.date_key === 20251225)!.is_holiday).toBe(true)
    expect(rows.filter((r) => r.is_past).length).toBe(699)
    for (let i = 1; i < rows.length; i++) expect((rows[i].date as Date).getTime() - (rows[i - 1].date as Date).getTime()).toBe(86_400_000)
    expect(timeDimRows(15)).toHaveLength(96)
  })
})

describe('scd2', () => {
  const entities = [
    { businessKey: 'E1', versions: [{ from: ymd(2024, 1, 1), attrs: { role: 'A' } }, { from: ymd(2024, 6, 1), attrs: { role: 'B' } }, { from: ymd(2025, 2, 1), attrs: { role: 'C' } }] },
    { businessKey: 'E2', versions: [{ from: ymd(2024, 3, 1), attrs: { role: 'A' } }, { from: ymd(2024, 3, 1), attrs: { role: 'Z' } }] }
  ]
  const spec: TableSpec = {
    name: 't', layer: 'gold', kind: 'dim', description: '', grain: '', key: ['sk'],
    scd2: { businessKey: 'bk', from: 'valid_from', to: 'valid_to', current: 'is_current' },
    columns: [c('sk', 'int', ''), c('bk', 'string', ''), c('role', 'string', ''), c('valid_from', 'date', ''), c('valid_to', 'date', ''), c('is_current', 'bool', ''), c('version', 'int', '')]
  }

  it('assigns non-overlapping validity ranges and one current row', () => {
    const rows = scd2Rows(entities, { skColumn: 'sk', bkColumn: 'bk' })
    expect(rows).toHaveLength(4)
    expect(rows[0].valid_to).toEqual(ymd(2024, 5, 31))
    expect(rows[2].valid_to).toEqual(ymd(9999, 12, 31))
    expect(rows[3].role).toBe('Z')
    expect(rows[3].version).toBe(1)
    expect(scd2Errors(spec, rowsToTable(spec, rows))).toEqual([])
    const idx = new Scd2Index(rows, 'sk', 'bk')
    expect(idx.lookup('E1', ymd(2024, 7, 1))).toBe(2)
    expect(idx.lookup('E1', ymd(2023, 1, 1))).toBe(1)
    expect(idx.lookup('E1', ymd(2030, 1, 1))).toBe(3)
    expect(idx.lookup('nope', ymd(2024, 1, 1))).toBeNull()
  })

  it('detects overlaps and multiple current rows', () => {
    const rows = scd2Rows(entities, { skColumn: 'sk', bkColumn: 'bk' })
    rows[0].valid_to = ymd(2024, 8, 1)
    rows[1].is_current = true
    const errors = scd2Errors(spec, rowsToTable(spec, rows))
    expect(errors.some((e) => e.includes('overlap'))).toBe(true)
    expect(errors.some((e) => e.includes('2 current rows'))).toBe(true)
  })

  it('evolve produces ordered versions', () => {
    const v = evolve(new Rng(3), ymd(2024, 1, 1), ymd(2026, 1, 1), { n: 0 }, 4, (p) => ({ ...p, n: (p.n as number) + 1 }))
    expect(v.length).toBeGreaterThan(2)
    for (let i = 1; i < v.length; i++) expect(v[i].from.getTime()).toBeGreaterThan(v[i - 1].from.getTime())
  })
})

describe('chaos injectors and detectors', () => {
  const sink = { counts: new Map<string, number>(), issue(code: string, n = 1) { this.counts.set(code, (this.counts.get(code) ?? 0) + n) } }
  const base = (): BronzeRow[] =>
    Array.from({ length: 200 }, (_, i) => ({ id: `K-${i}`, name: `Item ${i % 7}`, region: ['North', 'South'][i % 2], amount: 10 + (i % 13), when: addDays(ymd(2025, 3, 1), i % 5), ref: `R-${i % 9}` }))
  const file = (rows: BronzeRow[], path = 'src/2025/03/10/f.csv'): BronzeFile => ({ source: 's', path, format: 'csv', rows })
  const doc = (kind: IssueDoc['kind'], column?: string, extra: Partial<IssueDoc> = {}): IssueDoc => ({ code: kind, kind, source: 's', column, description: '', fix: '', ...extra })

  it('every injector plants what its detector finds', () => {
    const r = new Rng('chaos')
    const o = (code: string) => ({ rng: r, sink, code, rate: 0.05, atLeast: 1 })
    let rows = base()
    for (const kind of ['duplicates', 'nulls', 'whitespace', 'casing', 'mixed_date_formats', 'orphan_keys', 'outliers', 'sentinel_values', 'formatted_numbers'] as const) {
      expect(detectIssue(doc(kind, kind === 'duplicates' ? undefined : kind === 'casing' ? 'region' : kind === 'whitespace' ? 'name' : kind === 'mixed_date_formats' ? 'when' : kind === 'orphan_keys' ? 'ref' : 'amount', { ref: { table: 't', column: 'c' }, sentinels: ['-999'], rule: 'extreme' }), [file(base())], () => new Set(Array.from({ length: 9 }, (_, i) => `R-${i}`))).found).toBe(0)
    }
    rows = injectDuplicates(rows, o('dup'))
    expect(detectIssue(doc('duplicates'), [file(rows)]).found).toBe(sink.counts.get('dup'))
    injectNulls(rows, 'name', o('nul'))
    injectWhitespace(rows, 'name', o('ws'))
    injectCasing(rows, 'region', o('case'))
    injectDateFormats(rows, 'when', o('date'))
    injectOrphans(rows, 'ref', { ...o('orph'), make: () => 'R-999' })
    injectOutliers(rows, 'amount', { ...o('out'), mode: 'extreme', factor: 100 })
    const neg = base()
    injectOutliers(neg, 'amount', { ...o('neg'), mode: 'negative' })
    const sent = base()
    injectSentinels(sent, 'amount', { ...o('sent'), sentinels: [-999] })
    const fmt = base()
    injectFormattedNumbers(fmt, 'amount', { ...o('fmt') })
    const f = [file(rows)]
    expect(detectIssue(doc('nulls', 'name'), f).found).toBeGreaterThan(0)
    expect(detectIssue(doc('whitespace', 'name'), f).found).toBeGreaterThan(0)
    expect(detectIssue(doc('casing', 'region'), f).found).toBeGreaterThan(0)
    expect(detectIssue(doc('mixed_date_formats', 'when'), f).found).toBeGreaterThan(0)
    expect(detectIssue(doc('orphan_keys', 'ref', { ref: { table: 't', column: 'c' } }), f, () => new Set(Array.from({ length: 9 }, (_, i) => `R-${i}`))).found).toBeGreaterThan(0)
    expect(detectIssue(doc('outliers', 'amount', { rule: 'extreme' }), f).found).toBeGreaterThan(0)
    expect(detectIssue(doc('outliers', 'amount', { rule: 'negative' }), [file(neg)]).found).toBe(sink.counts.get('neg'))
    expect(detectIssue(doc('sentinel_values', 'amount', { sentinels: ['-999'] }), [file(sent)]).found).toBe(sink.counts.get('sent'))
    expect(detectIssue(doc('formatted_numbers', 'amount'), [file(fmt)]).found).toBe(sink.counts.get('fmt'))
  })

  it('detects late-arriving rows and schema drift', () => {
    const r = new Rng('late')
    const lateRows: BronzeRow[] = []
    for (let i = 0; i < 100; i++) {
      const ev = ymd(2025, 3, 1)
      const land = landingDay(ev, { rng: r, sink, code: 'late', rate: 0.2 })
      if (land.getTime() !== ev.getTime()) lateRows.push({ when: ev })
    }
    expect(lateRows.length).toBeGreaterThan(0)
    expect(detectIssue(doc('late_arriving', 'when', { dateColumn: 'when' }), [file(lateRows, 'src/2025/03/08/x.csv')]).found).toBe(lateRows.length)
    const drift = [file([{ a: 1, b: 2 }]), { ...file([{ a: 1, c: 2 }]), path: 'src/2025/04/01/f.csv' }]
    expect(detectIssue(doc('schema_drift'), drift).found).toBe(1)
  })

  it('formats and parses every planted date format', () => {
    const d = ymd(2025, 7, 4, 13, 5, 9)
    for (const f of ['iso', 'us', 'eu', 'slash_iso', 'long', 'iso_t', 'epoch'] as const) {
      const s = formatDate(d, f)
      expect(classifyDate(s)).toBe(f)
      expect(parseAnyDate(s)).toEqual(d)
    }
    expect(parseAnyDate(formatDate(ymd(2025, 12, 31), 'us'))).toEqual(ymd(2025, 12, 31))
  })
})

describe('schema helpers', () => {
  it('labels snake_case columns for the model', () => {
    expect(label('net_amount')).toBe('Net Amount')
    expect(label('nps_score')).toBe('NPS Score')
    expect(label('transaction_id')).toBe('Transaction ID')
    expect(label('margin_pct')).toBe('Margin %')
    expect(SCALES.tiny.years).toBe(1)
  })

  it('rowsToTable type-checks values', () => {
    const spec: TableSpec = { name: 't', layer: 'silver', kind: 'entity', description: '', grain: '', key: ['a'], columns: [c('a', 'int', ''), c('d', 'date', ''), c('m', 'decimal', '')] }
    const t = rowsToTable(spec, [{ a: 1, d: ymd(2025, 1, 1), m: 1.006 }])
    expect(t.columns[2].values[0]).toBe(1.01)
    expect(() => rowsToTable(spec, [{ a: 1.5 }])).toThrow(/integer/)
    expect(() => rowsToTable(spec, [{ a: 1, d: ymd(2025, 1, 1, 3) }])).toThrow(/without time/)
    expect(() => rowsToTable(spec, [{ zz: 1 }])).toThrow(/unknown column/)
  })
})

describe('tmdl writer & report layout', () => {
  it('quotes names and produces parseable TMDL', () => {
    expect(tmdlName('Sales')).toBe('Sales')
    expect(tmdlName('Store Day')).toBe("'Store Day'")
    expect(tmdlName("O'Brien")).toBe("'O''Brien'")
    const files = modelToTmdlFiles({
      name: 'Model',
      culture: 'en-US',
      tables: [
        {
          name: 'Sales',
          columns: [{ name: 'Amount', dataType: 'decimal', kind: 'data', sourceColumn: 'amount', summarizeBy: 'sum' }],
          measures: [{ name: 'Total', expression: 'VAR x = SUM ( Sales[Amount] )\nRETURN\n    x', formatString: '#,0', formatStringDefinition: { expression: '"#,0"' } }],
          hierarchies: [],
          partitions: [{ name: 'Sales', mode: 'import', sourceType: 'm', expression: 'let\n    Source = 1\nin\n    Source' }]
        }
      ],
      relationships: [],
      expressions: [],
      roles: []
    })
    for (const [path, text] of Object.entries(files)) expect(parseTmdlText(text, path).errors).toEqual([])
    expect(files['tables/Sales.tmdl']).toContain('\t\t\tVAR x = SUM ( Sales[Amount] )')
  })

  it('lays out visuals inside a 1280×720 page without overlap', () => {
    const boxes = layoutPage([
      { type: 'slicer', field: { table: 'a', column: 'b' } },
      { type: 'card', measure: 'm' },
      { type: 'card', measure: 'n' },
      { type: 'line', category: { table: 'a', column: 'b' }, measures: ['m'] },
      { type: 'column', category: { table: 'a', column: 'b' }, measures: ['m'] },
      { type: 'matrix', rows: [{ table: 'a', column: 'b' }], measures: ['m'] }
    ])
    for (const b of boxes) {
      expect(b.x + b.width).toBeLessThanOrEqual(1280)
      expect(b.y + b.height).toBeLessThanOrEqual(720)
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap).toBe(false)
      }
  })
})

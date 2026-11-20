import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPORT_TEMPLATES, projectFromTemplate } from './index'
import { refreshProject } from '../data/refresh'
import type { RefreshHost } from '../data/fetcher'
import { createEngine } from '../engine/engine'

function readTemplate(id: string): Record<string, Uint8Array> {
  const root = join(__dirname, id)
  const out: Record<string, Uint8Array> = {}
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else out[relative(root, p).split('\\').join('/')] = new Uint8Array(readFileSync(p))
    }
  }
  walk(root)
  return out
}

const offline: RefreshHost = {
  fs: { readFile: async () => new Uint8Array(), readText: async () => '', writeFile: async () => undefined, list: async () => [], exists: async () => false, stat: async () => null, mkdirp: async () => undefined, remove: async () => undefined },
  now: () => new Date(Date.UTC(2026, 10, 18, 15, 30)),
  localOffsetMinutes: 0,
  connectors: {} as RefreshHost['connectors']
}

describe('1st Edition template', () => {
  const tpl = REPORT_TEMPLATES.find((t) => t.id === 'first-edition')!

  it('loads without diagnostics: measure tables, calendar, last refresh; four pages', () => {
    const p = projectFromTemplate(tpl, readTemplate(tpl.id))
    expect(p.diagnostics).toEqual([])
    expect(p.source.kind).toBe('new')
    expect(p.model.tables.map((t) => t.name).sort()).toEqual(['_measures_format', '_measures_kpi', '_measures_time', 'dim_calendar', 'dim_last_refresh'])
    // Power BI measure tables keep one hidden placeholder column (like the enter-data "Column1")
    for (const t of p.model.tables.filter((t) => t.name.startsWith('_measures_'))) {
      expect(t.columns.map((c) => [c.name, c.isHidden])).toEqual([['Column1', true]])
    }
    const pages = p.report!.pages.map((pg) => pg.json.displayName)
    expect(pages).toEqual(['Overview', 'Detail', 'Export', 'Info'])
    for (const pg of p.report!.pages) {
      const slicers = pg.visuals.filter((v) => v.json.visual?.visualType === 'slicer')
      expect(slicers.length).toBe(pg.json.displayName === 'Info' ? 0 : 3)
      for (const s of slicers) expect(s.json.visual?.query).toBeUndefined()
    }
  })

  it('refreshes offline: Power Query calendar through yesterday, last refresh row', async () => {
    const p = projectFromTemplate(tpl, readTemplate(tpl.id))
    const r = await refreshProject(p, offline)
    expect(r.tables.filter((t) => !t.ok)).toEqual([])
    const cal = p.data.tables.get('dim_calendar')!
    const col = (n: string) => cal.columns.find((c) => c.name === n)!.values
    // 2023-01-01 .. 2026-11-17: 365 + 366 + 365 + 321 days
    expect(cal.rowCount).toBe(1417)
    const dates = col('date') as Date[]
    expect(dates[0]!.toISOString().slice(0, 10)).toBe('2026-11-17')
    expect(dates[dates.length - 1]!.toISOString().slice(0, 10)).toBe('2023-01-01')
    expect(col('sort_desc')[0]).toBe(1)
    expect(col('date_key')[0]).toBe(20261117)
    expect(col('month_name')[0]).toBe('November')
    expect(col('day_name')[0]).toBe('Tuesday')
    expect(col('is_weekend')[0]).toBe(false)
    expect(col('year_quarter')[0]).toBe('2026-Q4')
    expect(col('fiscal_year_period')[0]).toBe('FY2026-P11')
    const lr = p.data.tables.get('dim_last_refresh')!
    expect(lr.rowCount).toBe(1)
    // 15:30 UTC in November (standard time) = 10:30 Eastern
    expect((lr.columns[0]!.values[0] as Date).toISOString()).toBe('2026-11-18T10:30:00.000Z')
  })
})

describe('1st Edition header measures', () => {
  it('F_applied_filters renders the Applied Filters header with the report date pill', async () => {
    const tpl = REPORT_TEMPLATES.find((t) => t.id === 'first-edition')!
    const p = projectFromTemplate(tpl, readTemplate(tpl.id))
    await refreshProject(p, offline)
    const engine = createEngine(p.model, p.data)
    const html = String(engine.evaluateScalar('[F_applied_filters]').value)
    expect(html).toContain('Applied Filters:')
    expect(html).toContain('<strong style=\'margin-right:0.25rem;\'>Report Date:</strong><span>Tue, November 17, 2026</span>')
    expect(html).not.toContain('Year:')
    expect(String(engine.evaluateScalar('[F_Last_Updated]').value)).toBe('Last Refreshed: 2026-11-18 10:30 AM')
  })
})

describe('gallery templates', () => {
  const gallery = REPORT_TEMPLATES.filter((t) => t.id !== 'first-edition')
  const LUMEN_FONTS = /barlow|roboto condensed|open sans/gi

  it('ten designs, each with a style, a compatibility flag and Lumen-only features listed when they have any', () => {
    expect(gallery.length).toBe(10)
    expect(new Set(gallery.map((t) => t.style)).size).toBe(10)
    for (const t of gallery) {
      expect(t.compatibility === 'powerbi' || t.compatibility === 'lumen').toBe(true)
      expect((t.lumenFeatures?.length ?? 0) > 0).toBe(t.compatibility === 'lumen')
    }
    expect(gallery.filter((t) => t.compatibility === 'lumen').map((t) => t.id)).toEqual(['orbital', 'blacktop', 'aurora'])
  })

  for (const tpl of gallery) {
    describe(tpl.name, () => {
      it('loads without diagnostics and refreshes its sample data offline; every measure evaluates', async () => {
        const p = projectFromTemplate(tpl, readTemplate(tpl.id))
        expect(p.diagnostics).toEqual([])
        expect(p.source.kind).toBe('new')
        const r = await refreshProject(p, offline)
        expect(r.tables.filter((t) => !t.ok)).toEqual([])
        for (const t of p.model.tables) if (!t.name.startsWith('_')) expect(p.data.tables.get(t.name)?.rowCount ?? 0).toBeGreaterThan(0)
        const engine = createEngine(p.model, p.data)
        for (const t of p.model.tables)
          for (const ms of t.measures ?? []) {
            const v = engine.evaluateScalar(`[${ms.name}]`)
            expect(v.value, `${tpl.name} [${ms.name}]`).not.toBeNull()
          }
      })

      it('every visual field resolves in the model and every picture is in the report', () => {
        const p = projectFromTemplate(tpl, readTemplate(tpl.id))
        const fields = new Set<string>()
        for (const t of p.model.tables) {
          for (const c of t.columns) fields.add(`${t.name}.${c.name}`)
          for (const ms of t.measures ?? []) fields.add(`${t.name}.${ms.name}`)
        }
        const files = readTemplate(tpl.id)
        const res = Object.keys(files).filter((k) => k.includes('/RegisteredResources/')).map((k) => k.split('/').pop())
        for (const pg of p.report!.pages) {
          const pageImg = JSON.stringify(pg.json.objects ?? {}).match(/"ItemName":"([^"]+)"/g) ?? []
          for (const m of pageImg) expect(res).toContain(m.slice(12, -1))
          for (const v of pg.visuals) {
            const q = v.json.visual?.query?.queryState ?? {}
            for (const role of Object.values<any>(q))
              for (const pr of role.projections) {
                const f = pr.field.Column ?? pr.field.Measure
                expect(fields, `${tpl.name}: ${pr.queryRef}`).toContain(`${f.Expression.SourceRef.Entity}.${f.Property}`)
              }
            for (const m of JSON.stringify(v.json.visual?.objects ?? {}).match(/"ItemName":"([^"]+)"/g) ?? []) expect(res).toContain(m.slice(12, -1))
          }
        }
      })

      it(tpl.compatibility === 'powerbi' ? 'uses no Lumen-only effects or fonts (Power BI compatible)' : 'uses Lumen-only effects', () => {
        const p = projectFromTemplate(tpl, readTemplate(tpl.id))
        const styled = p.report!.pages.flatMap((pg) => pg.visuals).filter((v) => (v.json.annotations ?? []).some((a: any) => a.name === 'Lumen_Style'))
        const text = JSON.stringify(p.report!.pages.map((pg) => pg.visuals.map((v) => v.json)))
        const theme = JSON.stringify(p.report!.resources ? Object.values(p.report!.resources).filter((r) => r.path.endsWith(`${tpl.id}.json`)).map((r) => new TextDecoder().decode(r.bytes)) : [])
        expect(theme.length).toBeGreaterThan(500)
        if (tpl.compatibility === 'powerbi') {
          expect(styled).toEqual([])
          // fonts bundled with Lumen that Power BI Desktop does not offer
          expect(text.match(LUMEN_FONTS) ?? []).toEqual([])
          expect(theme.match(LUMEN_FONTS) ?? []).toEqual([])
        } else expect(styled.length).toBeGreaterThan(0)
      })
    })
  }
})

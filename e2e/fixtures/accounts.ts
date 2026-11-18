/**
 * An invented accounts model written as a PBIP project (no data) with one report page, for the "sample data is
 * interactive" journey: dropdown slicers on a dimension (one saved to a made-up account name, which the privacy
 * rule keeps out of the generated rows), a table of the facts by segment and a card.
 *
 * Shape under test: two facts share the account dimension and the calendar, so a quarter selection must not empty
 * the account slicer; the saved account selection reads as a generated stand-in.
 *
 * Page 2 ("By account"): a quarter slicer saved to the previous quarter, an account slicer, and a table of account
 * names with the Amount measure (rows whose measure is blank are dropped, as in Power BI): picking any account under
 * the saved quarter must leave the table with rows (sample data covers every account in every quarter).
 *
 * Page 3 ("Account list"): an account slicer and a table of accounts with a measure that only counts accounts whose
 * `counted` flag (a column no visual shows) holds a literal. Sample data must make the flag hold for every account, so
 * the table lists every account the slicer offers and keeps the row of any account picked alone.
 */
import { join } from 'node:path'
import { saveProject } from '../../src/core/io/open'
import { nodeFs } from '../../src/core/io/nodefs'
import { emptyDataStore } from '../../src/core/model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '../../src/core/model/types'
import { emptyReport } from '../../src/core/report/types'
import type { ProjectDocument } from '../../src/core/project'

/** The made-up account name the account slicer is saved to (never copied into sample data). */
export const PINNED_ACCOUNT = 'Harbor Point Wellness LLC'

const col = (name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef => ({ name, dataType, kind: 'data', sourceColumn: name, summarizeBy: 'none', ...extra })

function imported(name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef {
  return { name, columns, measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', mode: 'import', expression: `let\n    Source = Sql.Database("server.invalid", "db"),\n    T = Source{[Schema="dbo",Item="${name}"]}[Data]\nin\n    T` }], ...extra }
}

const rel = (from: string, to: string): RelationshipDef => {
  const [ft, fc] = from.split('.')
  const [tt, tc] = to.split('.')
  return { name: `${ft}-${tt}-${fc}`, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc, fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }
}

export function accountsModel(): SemanticModel {
  const calendar = imported('calendar', [col('date', 'dateTime', { isKey: true, formatString: 'Short Date' }), col('year', 'int64'), col('year_quarter', 'string')], { dataCategory: 'Time' })
  const accounts = imported('accounts', [col('account_id', 'string'), col('account_name', 'string'), col('segment', 'string'), col('active', 'boolean'), col('counted', 'string')])
  accounts.columns.push({ name: 'status_label', dataType: 'string', kind: 'calculated', expression: 'IF ( accounts[active] = FALSE (), "Inactive", "Active" )', summarizeBy: 'none' })
  const visits = imported('visits', [col('visit_id', 'string'), col('account_id', 'string'), col('visit_date', 'dateTime'), col('amount', 'double')], {
    measures: [
      { name: 'Amount', expression: 'SUM ( visits[amount] )', formatString: '#,0' },
      { name: 'Counted amount', expression: 'CALCULATE ( [Amount], FILTER ( accounts, accounts[counted] = "count_this_account" ) )', formatString: '#,0' }
    ]
  })
  const invoices = imported('invoices', [col('invoice_id', 'string'), col('account_id', 'string'), col('invoice_date', 'dateTime'), col('total', 'double')])
  return {
    name: 'Accounts',
    tables: [calendar, accounts, visits, invoices],
    relationships: [rel('visits.account_id', 'accounts.account_id'), rel('visits.visit_date', 'calendar.date'), rel('invoices.account_id', 'accounts.account_id'), rel('invoices.invoice_date', 'calendar.date')],
    expressions: [],
    roles: []
  } as SemanticModel
}

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const field = (entity: string, prop: string, measure = false) => (measure ? { Measure: { Expression: { SourceRef: { Entity: entity } }, Property: prop } } : { Column: { Expression: { SourceRef: { Entity: entity } }, Property: prop } })
const proj = (entity: string, prop: string, measure = false) => ({ field: field(entity, prop, measure), queryRef: `${entity}.${prop}`, nativeQueryRef: prop })

function visual(name: string, x: number, y: number, w: number, h: number, v: Record<string, unknown>) {
  return { name, json: { name, position: { x, y, z: 0, width: w, height: h, tabOrder: 0 }, visual: v } }
}

function dropdown(name: string, y: number, entity: string, prop: string, title: string, saved?: string) {
  const general = saved
    ? [{ properties: { filter: { filter: { Version: 2, From: [{ Name: 'a', Entity: entity, Type: 0 }], Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'a' } }, Property: prop } }], Values: [[{ Literal: { Value: `'${saved}'` } }]] } } }] } } } }]
    : undefined
  return visual(name, 20, y, 260, 64, {
    visualType: 'slicer',
    query: { queryState: { Values: { projections: [proj(entity, prop)] } } },
    objects: { data: [{ properties: { mode: lit("'Dropdown'") } }], header: [{ properties: { text: lit(`'${title}'`) } }], selection: [{ properties: { strictSingleSelect: lit('false'), singleSelect: lit('true') } }], ...(general ? { general } : {}) }
  })
}

/** The quarter before `today` as the calendar's `year_quarter` label ("2026-Q3"). */
export function previousQuarter(today = new Date()): string {
  const q = Math.floor(today.getMonth() / 3) // 0-based current quarter
  return q === 0 ? `${today.getFullYear() - 1}-Q4` : `${today.getFullYear()}-Q${q}`
}

export async function writeAccountsProject(dir: string): Promise<string> {
  const report = emptyReport()
  const page = report.pages[0]
  page.json.displayName = 'Accounts'
  page.visuals = [
    dropdown('slicerAccount', 20, 'accounts', 'account_name', 'Account', PINNED_ACCOUNT),
    dropdown('slicerStatus', 100, 'accounts', 'status_label', 'Status'),
    dropdown('slicerQuarter', 180, 'calendar', 'year_quarter', 'Quarter'),
    visual('tableBySegment', 320, 20, 420, 300, {
      visualType: 'tableEx',
      query: { queryState: { Values: { projections: [proj('accounts', 'segment'), proj('visits', 'Amount', true)] } } },
      visualContainerObjects: { title: [{ properties: { show: lit('true'), text: lit("'Amount by segment'") } }] }
    })
  ] as typeof page.visuals
  report.pages.push({
    name: 'ByAccount',
    json: { name: 'ByAccount', displayName: 'By account', displayOption: 'FitToPage', height: 720, width: 1280 },
    visuals: [
      dropdown('slicerQuarter2', 20, 'calendar', 'year_quarter', 'Quarter', previousQuarter()),
      dropdown('slicerAccount2', 100, 'accounts', 'account_name', 'Account'),
      visual('tableByAccount', 320, 20, 420, 300, {
        visualType: 'tableEx',
        query: { queryState: { Values: { projections: [proj('accounts', 'account_name'), proj('visits', 'Amount', true)] } } },
        visualContainerObjects: { title: [{ properties: { show: lit('true'), text: lit("'Amount by account'") } }] }
      })
    ]
  } as (typeof report.pages)[number])
  report.pagesMeta.pageOrder.push('ByAccount')
  report.pages.push({
    name: 'AccountList',
    json: { name: 'AccountList', displayName: 'Account list', displayOption: 'FitToPage', height: 720, width: 1280 },
    visuals: [
      dropdown('slicerAccount3', 20, 'accounts', 'account_name', 'Account'),
      visual('tableAccounts', 320, 20, 520, 640, {
        visualType: 'tableEx',
        query: { queryState: { Values: { projections: [proj('accounts', 'account_name'), proj('accounts', 'segment'), proj('visits', 'Counted amount', true)] } } },
        visualContainerObjects: { title: [{ properties: { show: lit('true'), text: lit("'Counted amount by account'") } }] }
      })
    ]
  } as (typeof report.pages)[number])
  report.pagesMeta.pageOrder.push('AccountList')
  const project: ProjectDocument = { id: 'accounts', name: 'Accounts', source: { kind: 'new' }, model: accountsModel(), data: emptyDataStore(), report, diagnostics: [], dirty: false }
  const target = join(dir, 'Accounts.pbip')
  await saveProject(project, target, nodeFs, { format: 'pbip' })
  return target
}

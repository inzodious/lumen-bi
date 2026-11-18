/**
 * An invented survey model written as a PBIP project (no data), for the sample-data journeys.
 *
 * Shape under test: the fact is a *calculated* table (`responses`) that combines two imported feeds with
 * UNION / SELECTCOLUMNS; relationships, measures and the report point at the calculated table, whose columns
 * are saved without a data type (as Power BI writes inferred ones); the feeds are hidden; the model lists a
 * measure-only table first.
 */
import { join } from 'node:path'
import { saveProject } from '../../src/core/io/open'
import { nodeFs } from '../../src/core/io/nodefs'
import { emptyDataStore } from '../../src/core/model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '../../src/core/model/types'
import { emptyReport } from '../../src/core/report/types'
import type { ProjectDocument } from '../../src/core/project'

const col = (name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef => ({ name, dataType, kind: 'data', sourceColumn: name, summarizeBy: 'none', ...extra })

function imported(name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef {
  return { name, columns, measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', mode: 'import', expression: `let\n    Source = Sql.Database("server.invalid", "db"),\n    T = Source{[Schema="dbo",Item="${name}"]}[Data]\nin\n    T` }], ...extra }
}

const rel = (name: string, from: string, to: string): RelationshipDef => {
  const [ft, fc] = from.split('.')
  const [tt, tc] = to.split('.')
  return { name, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc, fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }
}

const COMBINED = `
UNION (
    SELECTCOLUMNS ( web_responses,
        "response_id", web_responses[id], "answered_on", web_responses[answered_on], "feed", "Web",
        "recommend", web_responses[recommend_score], "promoter_group", web_responses[promoter_group], "clinic_id", web_responses[clinic_id],
        "rating_staff", web_responses[rating_staff] ),
    SELECTCOLUMNS ( kiosk_responses,
        "response_id", "n/a", "answered_on", kiosk_responses[answered_on], "feed", "Kiosk",
        "recommend", kiosk_responses[recommend_score], "promoter_group", kiosk_responses[promoter_group], "clinic_id", "None",
        "rating_staff", BLANK () )
)`

export const SURVEY_TABLES = { measures: '_Measures', calendar: 'calendar', clinics: 'clinics', web: 'web_responses', kiosk: 'kiosk_responses', combined: 'responses' } as const

export function surveyModel(): SemanticModel {
  const measures = imported('_Measures', [col('Column1', 'string', { isHidden: true })], {
    partitions: [{ name: '_Measures', sourceType: 'm', mode: 'import', expression: 'let\n    Source = Table.FromRows({}, type table [Column1 = text])\nin\n    Source' }],
    measures: [
      { name: 'Responses', expression: 'COUNTROWS ( responses )', formatString: '#,0' },
      { name: 'Promoters %', expression: 'CALCULATE ( COUNTROWS ( responses ), responses[promoter_group] = "Promoter" ) / COUNTROWS ( responses )', formatString: '0.0%' },
      { name: 'Detractors %', expression: 'CALCULATE ( COUNTROWS ( responses ), responses[promoter_group] = "Detractor" ) / COUNTROWS ( responses )', formatString: '0.0%' },
      { name: 'NPS', expression: '( [Promoters %] - [Detractors %] ) * 100', formatString: '0' }
    ]
  })
  const calendar = imported('calendar', [col('date', 'dateTime', { isKey: true, formatString: 'Short Date' }), col('year', 'int64'), col('month', 'int64'), col('year_month', 'string')], { dataCategory: 'Time' })
  const clinics = imported('clinics', [col('clinic_guid', 'string'), col('clinic_name', 'string'), col('region', 'string')])
  const web = imported(
    'web_responses',
    [col('id', 'string'), col('clinic_id', 'string'), col('answered_on', 'dateTime'), col('recommend_score', 'int64'), col('promoter_group', 'string'), col('rating_staff', 'int64')],
    { isHidden: true }
  )
  const kiosk = imported('kiosk_responses', [col('answered_on', 'dateTime'), col('recommend_score', 'int64'), col('promoter_group', 'string')], { isHidden: true })
  const responses: TableDef = {
    name: 'responses',
    // no data types: Power BI does not write the ones it infers for calculated-table columns
    columns: ['response_id', 'answered_on', 'feed', 'recommend', 'promoter_group', 'clinic_id', 'rating_staff'].map((c) => ({ name: c, dataType: 'unknown', kind: 'calculatedTableColumn', sourceColumn: `[${c}]`, summarizeBy: 'none' })),
    measures: [],
    hierarchies: [],
    partitions: [{ name: 'responses', sourceType: 'calculated', mode: 'import', expression: COMBINED }]
  }
  return {
    name: 'Survey',
    tables: [measures, calendar, clinics, web, kiosk, responses],
    relationships: [rel('responses-calendar', 'responses.answered_on', 'calendar.date'), rel('responses-clinics', 'responses.clinic_id', 'clinics.clinic_guid')],
    expressions: [],
    roles: []
  } as SemanticModel
}

/** Write the project into `dir` and return the path of its .pbip file. */
export async function writeSurveyProject(dir: string): Promise<string> {
  const project: ProjectDocument = { id: 'survey', name: 'Survey', source: { kind: 'new' }, model: surveyModel(), data: emptyDataStore(), report: emptyReport(), diagnostics: [], dirty: false }
  const target = join(dir, 'Survey.pbip')
  await saveProject(project, target, nodeFs, { format: 'pbip' })
  return target
}

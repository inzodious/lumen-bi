/**
 * Semantic model files (TMDL) for the live dashboards: star-schema tables whose rows are embedded the way Power BI
 * Desktop's "Enter data" stores them (deflated JSON in the M partition), a Power Query calendar, relationships and the
 * two measure tables. Everything is deterministic: lineage tags are hashes of the dashboard id and the object's name.
 */
import { deflateRawSync } from 'node:zlib'
import { uuid } from '../templates/lib.mjs'

const TMDL_TYPE = { int64: 'int64', double: 'double', currency: 'decimal', string: 'string', date: 'dateTime', bool: 'boolean' }
const M_TYPE = { int64: 'Int64.Type', double: 'type number', currency: 'Currency.Type', string: 'type text', date: 'type date', bool: 'type logical' }
const DEFAULT_FORMAT = { int64: '0', double: '#,0.00', currency: '\\$#,0.00;(\\$#,0.00);\\$#,0.00', date: 'Short Date', bool: '"TRUE";"TRUE";"FALSE"' }

/** TMDL property value: quoted (with doubled quotes) when it holds a quote or starts with a character TMDL reads specially. */
function tmdlValue(v) {
  return /["']|^[\s=]|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function tmdlName(n) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`
}

/** One measure: single-line DAX stays on the measure line, multi-line DAX goes below it (Desktop's layout). */
function measureLines(seed, table, ms) {
  const out = []
  if (ms.description) for (const l of ms.description.split('\n')) out.push(`\t/// ${l}`)
  const dax = ms.dax.trim()
  if (dax.includes('\n')) {
    out.push(`\tmeasure ${tmdlName(ms.name)} =`)
    for (const l of dax.split('\n')) out.push(`\t\t\t${l}`)
  } else out.push(`\tmeasure ${tmdlName(ms.name)} = ${dax}`)
  if (ms.format) out.push(`\t\tformatString: ${tmdlValue(ms.format)}`)
  if (ms.folder) out.push(`\t\tdisplayFolder: ${tmdlValue(ms.folder)}`)
  out.push(`\t\tlineageTag: ${uuid(`${seed}/measure/${table}/${ms.name}`)}`, '')
  return out
}

function columnLines(seed, table, col) {
  const out = [`\tcolumn ${tmdlName(col.name)}`, `\t\tdataType: ${TMDL_TYPE[col.type]}`]
  if (col.hidden) out.push('\t\tisHidden')
  if (col.key) out.push('\t\tisKey')
  const format = col.format ?? DEFAULT_FORMAT[col.type]
  if (format) out.push(`\t\tformatString: ${tmdlValue(format)}`)
  out.push(`\t\tlineageTag: ${uuid(`${seed}/column/${table}/${col.name}`)}`)
  if (col.category) out.push(`\t\tdataCategory: ${col.category}`)
  const numeric = col.type === 'int64' || col.type === 'double' || col.type === 'currency'
  out.push(`\t\tsummarizeBy: ${col.summarize ?? (numeric && !col.name.endsWith('_key') ? 'sum' : 'none')}`)
  out.push(`\t\tsourceColumn: ${col.name}`)
  if (col.sortBy) out.push(`\t\tsortByColumn: ${col.sortBy}`, '', '\t\tchangedProperty = SortByColumn')
  out.push('', '\t\tannotation SummarizationSetBy = Automatic')
  if (col.type === 'date') out.push('', '\t\tannotation UnderlyingDateTimeDataType = Date')
  out.push('')
  return out
}

/** Cell text as Enter data keeps it: numbers in invariant form, dates as ISO dates, blanks as null. */
function cellText(v, type) {
  if (v === null || v === undefined) return null
  if (type === 'date') return v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  if (type === 'bool') return v ? 'true' : 'false'
  if (type === 'double' || type === 'currency') return String(Math.round(v * 10000) / 10000)
  if (type === 'int64') return String(Math.round(v))
  return String(v)
}

/** The M of an "Enter data" table: the rows deflated into the query, then typed. */
export function enterDataM(table) {
  const rows = table.rows.map((r) => r.map((v, i) => cellText(v, table.columns[i].type)))
  const b64 = deflateRawSync(Buffer.from(JSON.stringify(rows)), { level: 9 }).toString('base64')
  const cols = table.columns.map((c) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name) ? c.name : `#"${c.name}"`} = _t`).join(', ')
  const types = table.columns.map((c) => `{"${c.name}", ${M_TYPE[c.type]}}`).join(', ')
  return [
    'let',
    `    Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("${b64}", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [${cols}]),`,
    `    #"Changed Type" = Table.TransformColumnTypes(Source,{${types}})`,
    'in',
    '    #"Changed Type"'
  ]
}

/** A daily calendar built in Power Query over a fixed range. */
export function calendarTable(start, end) {
  const d = (s) => `#date(${s.split('-').map(Number).join(', ')})`
  const columns = [
    { name: 'date', type: 'date', key: true },
    { name: 'year', type: 'int64', summarize: 'none' },
    { name: 'quarter', type: 'string' },
    { name: 'month', type: 'int64', hidden: true, summarize: 'none' },
    { name: 'month_name', type: 'string', sortBy: 'month' },
    { name: 'month_abbr', type: 'string', sortBy: 'month' },
    { name: 'month_start', type: 'date' },
    { name: 'month_label', type: 'string', sortBy: 'month_start' },
    { name: 'week_start', type: 'date' },
    { name: 'day_of_week', type: 'int64', hidden: true, summarize: 'none' },
    { name: 'day_name', type: 'string', sortBy: 'day_of_week' },
    { name: 'day_abbr', type: 'string', sortBy: 'day_of_week' },
    { name: 'is_weekend', type: 'bool' }
  ]
  const m = [
    'let',
    `    Source = List.Dates(${d(start)}, Duration.Days(${d(end)} - ${d(start)}) + 1, #duration(1, 0, 0, 0)),`,
    '    #"Converted to Table" = Table.FromList(Source, Splitter.SplitByNothing(), {"date"}),',
    '    #"Changed Type" = Table.TransformColumnTypes(#"Converted to Table", {{"date", type date}}),',
    '    #"Added Year" = Table.AddColumn(#"Changed Type", "year", each Date.Year([date]), Int64.Type),',
    '    #"Added Quarter" = Table.AddColumn(#"Added Year", "quarter", each "Q" & Text.From(Date.QuarterOfYear([date])), type text),',
    '    #"Added Month" = Table.AddColumn(#"Added Quarter", "month", each Date.Month([date]), Int64.Type),',
    '    #"Added Month Name" = Table.AddColumn(#"Added Month", "month_name", each Date.MonthName([date], "en-US"), type text),',
    '    #"Added Month Abbr" = Table.AddColumn(#"Added Month Name", "month_abbr", each Text.Start([month_name], 3), type text),',
    '    #"Added Month Start" = Table.AddColumn(#"Added Month Abbr", "month_start", each Date.StartOfMonth([date]), type date),',
    '    #"Added Month Label" = Table.AddColumn(#"Added Month Start", "month_label", each [month_abbr] & " " & Text.End(Text.From([year]), 2), type text),',
    '    #"Added Week Start" = Table.AddColumn(#"Added Month Label", "week_start", each Date.StartOfWeek([date], Day.Monday), type date),',
    '    #"Added Day of Week" = Table.AddColumn(#"Added Week Start", "day_of_week", each Date.DayOfWeek([date], Day.Monday) + 1, Int64.Type),',
    '    #"Added Day Name" = Table.AddColumn(#"Added Day of Week", "day_name", each Date.DayOfWeekName([date], "en-US"), type text),',
    '    #"Added Day Abbr" = Table.AddColumn(#"Added Day Name", "day_abbr", each Text.Start([day_name], 3), type text),',
    '    #"Added Weekend Flag" = Table.AddColumn(#"Added Day Abbr", "is_weekend", each [day_of_week] > 5, type logical)',
    'in',
    '    #"Added Weekend Flag"'
  ]
  return { name: 'dim_calendar', group: 'Dimension', dataCategory: 'Time', columns, m }
}

function tableTmdl(seed, t) {
  const out = [`table ${tmdlName(t.name)}`, `\tlineageTag: ${uuid(`${seed}/table/${t.name}`)}`]
  if (t.dataCategory) out.push(`\tdataCategory: ${t.dataCategory}`)
  out.push('')
  for (const ms of t.measures ?? []) out.push(...measureLines(seed, t.name, ms))
  for (const col of t.columns) out.push(...columnLines(seed, t.name, col))
  const m = t.m ?? enterDataM(t)
  out.push(`\tpartition ${tmdlName(t.name)} = m`, '\t\tmode: import', `\t\tqueryGroup: ${t.group}`, '\t\tsource =')
  for (const l of m) out.push(`\t\t\t\t${l}`)
  out.push('', '\tannotation PBI_NavigationStepName = Navigation', '', '\tannotation PBI_ResultType = Table', '')
  return out.join('\n')
}

/** A measure table: its measures and the hidden Column1 of an empty "Enter data" table. */
function measureTableTmdl(seed, name, measures) {
  return tableTmdl(seed, { name, group: 'Measures', measures, columns: [{ name: 'Column1', type: 'string', hidden: true }], rows: [] })
}

/**
 * All the model files of a dashboard, as path (relative to `definition/`) → text.
 * design: { id, calendar: { start, end }, tables, relationships: [{ from: 't.c', to: 't.c' }], measures: { kpi, format } }
 */
export function modelFiles(design) {
  const seed = design.id
  const files = {}
  const tables = [calendarTable(design.calendar.start, design.calendar.end), ...design.tables]
  files['database.tmdl'] = 'database\n\tcompatibilityLevel: 1606\n\n'
  files['tables/_measures_kpi.tmdl'] = measureTableTmdl(seed, '_measures_kpi', design.measures.kpi)
  files['tables/_measures_format.tmdl'] = measureTableTmdl(seed, '_measures_format', design.measures.format)
  for (const t of tables) files[`tables/${t.name}.tmdl`] = tableTmdl(seed, t)
  files['relationships.tmdl'] = design.relationships
    .map((r) => [`relationship ${uuid(`${seed}/relationship/${r.from}/${r.to}`)}`, ...(r.inactive ? ['\tisActive: false'] : []), `\tfromColumn: ${r.from}`, `\ttoColumn: ${r.to}`, ''].join('\n'))
    .join('\n')
  const order = ['_measures_kpi', '_measures_format', ...tables.map((t) => t.name)]
  const groups = ['Measures', 'Dimension', 'Fact']
  files['model.tmdl'] = [
    'model Model',
    '\tculture: en-US',
    '\tdefaultPowerBIDataSourceVersion: powerBI_V3',
    '\tsourceQueryCulture: en-US',
    '\tdataAccessOptions',
    '\t\tlegacyRedirects',
    '\t\treturnErrorValuesAsNull',
    '',
    ...groups.flatMap((g, i) => [`queryGroup ${g}`, '', `\tannotation PBI_QueryGroupOrder = ${i}`, '']),
    `annotation PBI_QueryOrder = ${JSON.stringify(order)}`,
    '',
    'annotation __PBI_TimeIntelligenceEnabled = 0',
    '',
    ...order.map((t) => `ref table ${t}`),
    ''
  ].join('\n')
  return files
}

/**
 * Regolith, live: operations of the space mining mock organisation (the asteroid and moon mining operator of the
 * sample_pbix `space_mining` projects), 2069 and 2070. The facts are that star schema aggregated to the month
 * (scripts/dashboards/data/space-mining.json): extraction by site and material, downtime events by site, event type
 * and asset type, haul trips by origin and material, sales by material and customer, month-end stock.
 *
 * It is Lumen's motion showcase: a page navigator rail on every page, and each page enters with a different
 * transition (circle reveal, morph with the KPI tiles gliding, push, depth, wipe), drill-through from a site zooms
 * out of the visual clicked, and two bookmarks on Extraction swap views with a morph.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kit, themeOf } from '../../templates/kit.mjs'
import { as, c, col, hex } from '../../templates/lib.mjs'
import { bookmarkId } from '../../templates/pbir.mjs'
import { PIN, T, X0, X1, backdrop, chrome, framed, logo, rail, railSlicer, tile } from '../../templates/designs/regolith.mjs'
import { cal, columnColor, fmt, growToFit, kpi, legend, yearSlicer } from '../kit.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = JSON.parse(readFileSync(join(here, '..', 'data', 'space-mining.json'), 'utf8'))
const ID = 'regolith'
const YEAR = 2070

// ---------------------------------------------------------------- tables
const tables = [
  {
    name: 'dim_location',
    group: 'Dimension',
    columns: [
      { name: 'location_key', type: 'int64', hidden: true },
      { name: 'celestial_body', type: 'string' },
      { name: 'site', type: 'string' },
      { name: 'region', type: 'string' },
      { name: 'site_type', type: 'string' }
    ],
    rows: SRC.location
  },
  {
    name: 'dim_material',
    group: 'Dimension',
    columns: [
      { name: 'material_key', type: 'int64', hidden: true },
      { name: 'material', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'value_per_ton', type: 'double', format: '\\$#,0', summarize: 'none' }
    ],
    rows: SRC.material
  },
  {
    name: 'dim_event_type',
    group: 'Dimension',
    columns: [
      { name: 'event_type_key', type: 'int64', hidden: true },
      { name: 'event', type: 'string' },
      { name: 'event_category', type: 'string' },
      { name: 'severity', type: 'string' }
    ],
    rows: SRC.event_type
  },
  {
    name: 'dim_customer',
    group: 'Dimension',
    columns: [
      { name: 'customer_key', type: 'int64', hidden: true },
      { name: 'customer', type: 'string' },
      { name: 'sector', type: 'string' },
      { name: 'customer_location', type: 'string' }
    ],
    rows: SRC.customer
  },
  {
    name: 'fact_extraction',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'location_key', type: 'int64', hidden: true },
      { name: 'material_key', type: 'int64', hidden: true },
      { name: 'tons', type: 'double', format: '#,0' },
      { name: 'operating_hours', type: 'double', format: '#,0' },
      { name: 'downtime_hours', type: 'double', format: '#,0' },
      { name: 'asset_days', type: 'int64', format: '#,0' }
    ],
    rows: SRC.extraction
  },
  {
    name: 'fact_downtime',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'location_key', type: 'int64', hidden: true },
      { name: 'event_type_key', type: 'int64', hidden: true },
      { name: 'asset_type', type: 'string' },
      { name: 'downtime_hours', type: 'double', format: '#,0' },
      { name: 'events', type: 'int64', format: '#,0' }
    ],
    rows: SRC.downtime
  },
  {
    name: 'fact_shipment',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'location_key', type: 'int64', hidden: true },
      { name: 'material_key', type: 'int64', hidden: true },
      { name: 'tons_shipped', type: 'double', format: '#,0' },
      { name: 'shipping_cost', type: 'double', format: '\\$#,0' },
      { name: 'trips', type: 'int64', format: '#,0' },
      { name: 'transit_days', type: 'int64', format: '#,0' }
    ],
    rows: SRC.shipment
  },
  {
    name: 'fact_sales',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'material_key', type: 'int64', hidden: true },
      { name: 'customer_key', type: 'int64', hidden: true },
      { name: 'tons_sold', type: 'double', format: '#,0' },
      { name: 'revenue', type: 'double', format: '\\$#,0' },
      { name: 'profit', type: 'double', format: '\\$#,0' }
    ],
    rows: SRC.sales
  },
  {
    name: 'fact_inventory',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'location_key', type: 'int64', hidden: true },
      { name: 'material_key', type: 'int64', hidden: true },
      { name: 'on_hand_tons', type: 'double', format: '#,0', summarize: 'none' }
    ],
    rows: SRC.inventory
  }
]

const relationships = [
  ...['fact_extraction', 'fact_downtime', 'fact_shipment', 'fact_sales', 'fact_inventory'].map((t) => ({ from: `${t}.month_start`, to: 'dim_calendar.date' })),
  ...['fact_extraction', 'fact_downtime', 'fact_shipment', 'fact_inventory'].map((t) => ({ from: `${t}.location_key`, to: 'dim_location.location_key' })),
  ...['fact_extraction', 'fact_shipment', 'fact_sales', 'fact_inventory'].map((t) => ({ from: `${t}.material_key`, to: 'dim_material.material_key' })),
  { from: 'fact_downtime.event_type_key', to: 'dim_event_type.event_type_key' },
  { from: 'fact_sales.customer_key', to: 'dim_customer.customer_key' }
]

// ---------------------------------------------------------------- measures
const py = (name, format, folder) => ({
  folder,
  name: `${name}_py`,
  dax: `CALCULATE(
	[${name}],
	SAMEPERIODLASTYEAR(dim_calendar[date])
)`,
  format
})
const yoy = (name, folder) => ({ folder, name: `${name}_yoy_pct`, dax: `DIVIDE([${name}] - [${name}_py], [${name}_py])`, format: '+0.0%;-0.0%;0.0%' })

const KPI = [
  { folder: 'Extraction', name: 'kpi_ore_t', dax: 'SUM(fact_extraction[tons])', format: '#,0" t"' },
  py('kpi_ore_t', '#,0" t"', 'Extraction'),
  yoy('kpi_ore_t', 'Extraction'),
  { folder: 'Extraction', name: 'kpi_operating_h', dax: 'SUM(fact_extraction[operating_hours])', format: '#,0" h"' },
  { folder: 'Extraction', name: 'kpi_downtime_h', dax: 'SUM(fact_extraction[downtime_hours])', format: '#,0" h"' },
  { folder: 'Extraction', name: 'kpi_availability_pct', dax: 'DIVIDE([kpi_operating_h], [kpi_operating_h] + [kpi_downtime_h])', format: '0.0%' },
  py('kpi_availability_pct', '0.0%', 'Extraction'),
  { folder: 'Extraction', name: 'kpi_asset_days', dax: 'SUM(fact_extraction[asset_days])', format: '#,0' },
  { folder: 'Extraction', name: 'kpi_t_per_asset_day', dax: 'DIVIDE([kpi_ore_t], [kpi_asset_days])', format: '#,0.0" t"' },
  { folder: 'Extraction', name: 'kpi_active_sites', dax: 'DISTINCTCOUNT(fact_extraction[location_key])', format: '0' },
  { folder: 'Reliability', name: 'kpi_events', dax: 'SUM(fact_downtime[events])', format: '#,0' },
  py('kpi_events', '#,0', 'Reliability'),
  yoy('kpi_events', 'Reliability'),
  { folder: 'Reliability', name: 'kpi_event_downtime_h', dax: 'SUM(fact_downtime[downtime_hours])', format: '#,0" h"' },
  { folder: 'Reliability', name: 'kpi_h_per_event', dax: 'DIVIDE([kpi_event_downtime_h], [kpi_events])', format: '0.0" h"' },
  {
    folder: 'Reliability',
    name: 'kpi_high_severity_events',
    dax: `CALCULATE(
	[kpi_events],
	KEEPFILTERS(dim_event_type[severity] = "High")
) + 0`,
    format: '#,0'
  },
  { folder: 'Logistics', name: 'kpi_shipped_t', dax: 'SUM(fact_shipment[tons_shipped])', format: '#,0" t"' },
  py('kpi_shipped_t', '#,0" t"', 'Logistics'),
  yoy('kpi_shipped_t', 'Logistics'),
  { folder: 'Logistics', name: 'kpi_trips', dax: 'SUM(fact_shipment[trips])', format: '#,0' },
  { folder: 'Logistics', name: 'kpi_ship_cost_musd', dax: 'DIVIDE(SUM(fact_shipment[shipping_cost]), 1000000)', format: '\\$#,0.0"M"' },
  { folder: 'Logistics', name: 'kpi_cost_per_t', dax: 'DIVIDE(SUM(fact_shipment[shipping_cost]), [kpi_shipped_t])', format: '\\$#,0' },
  { folder: 'Logistics', name: 'kpi_transit_days', dax: 'DIVIDE(SUM(fact_shipment[transit_days]), [kpi_trips])', format: '0.0" d"' },
  {
    folder: 'Logistics',
    name: 'kpi_on_hand_t',
    dax: `VAR _last = MAX(fact_inventory[month_start])
RETURN
	CALCULATE(
		SUM(fact_inventory[on_hand_tons]),
		KEEPFILTERS(fact_inventory[month_start] = _last)
	)`,
    format: '#,0" t"'
  },
  { folder: 'Markets', name: 'kpi_revenue_t', dax: 'DIVIDE(SUM(fact_sales[revenue]), 1000000000000)', format: '\\$#,0.00"T"' },
  py('kpi_revenue_t', '\\$#,0.00"T"', 'Markets'),
  yoy('kpi_revenue_t', 'Markets'),
  {
    folder: 'Logistics',
    name: 'kpi_on_hand_mt',
    dax: 'DIVIDE([kpi_on_hand_t], 1000000)',
    format: '#,0.0"M t"'
  },
  { folder: 'Markets', name: 'kpi_revenue_b', dax: 'DIVIDE(SUM(fact_sales[revenue]), 1000000000)', format: '\\$#,0"B"' },
  { folder: 'Markets', name: 'kpi_tons_sold', dax: 'SUM(fact_sales[tons_sold])', format: '#,0" t"' },
  { folder: 'Markets', name: 'kpi_value_per_t_musd', dax: 'DIVIDE(SUM(fact_sales[revenue]), [kpi_tons_sold]) / 1000000', format: '\\$#,0.0"M"' },
  { folder: 'Markets', name: 'kpi_customers', dax: 'DISTINCTCOUNT(fact_sales[customer_key])', format: '0' }
]

const note = (name, dax) => ({ name, dax })
const FMT = [
  {
    name: 'fmt_period',
    dax: `VAR _first = MIN(dim_calendar[date])
VAR _last = MAX(dim_calendar[date])
RETURN
	UPPER(FORMAT(_first, "MMM") & " – " & FORMAT(_last, "MMM yyyy"))`
  },
  note('fmt_ore_note', 'FORMAT([kpi_ore_t_yoy_pct], "+0.0%;-0.0%;0.0%") & " vs last year"'),
  note('fmt_availability_note', 'FORMAT([kpi_downtime_h], "#,0") & " h of downtime"'),
  note('fmt_sites_note', 'FORMAT([kpi_asset_days], "#,0") & " asset-days"'),
  note('fmt_rate_note', 'FORMAT([kpi_operating_h], "#,0") & " operating hours"'),
  note('fmt_shipped_note', 'FORMAT([kpi_shipped_t_yoy_pct], "+0.0%;-0.0%;0.0%") & " vs last year"'),
  note('fmt_trips_note', 'FORMAT([kpi_ship_cost_musd], "$#,0.0") & "M haul cost"'),
  note('fmt_transit_note', '"origin to customer, per trip"'),
  note('fmt_stock_note', '"closing balance, month end"'),
  note('fmt_revenue_note', 'FORMAT([kpi_revenue_t_yoy_pct], "+0.0%;-0.0%;0.0%") & " vs last year"'),
  note('fmt_customers_note', '"buying in the period"'),
  note('fmt_events_note', 'FORMAT([kpi_events_yoy_pct], "+0.0%;-0.0%;0.0%") & " vs last year"'),
  note('fmt_event_hours_note', 'FORMAT([kpi_h_per_event], "0.0") & " h per event"'),
  note('fmt_severity_note', 'FORMAT(DIVIDE([kpi_high_severity_events], [kpi_events]), "0%") & " of all events"'),
  {
    name: 'fmt_site_title',
    dax: `VAR _site = SELECTEDVALUE(dim_location[site], "All sites")
VAR _body = SELECTEDVALUE(dim_location[celestial_body])
RETURN
	_site & IF(NOT ISBLANK(_body), "  ·  " & UPPER(_body), "")`
  },
  {
    name: 'fmt_site_kicker',
    dax: `VAR _type = UPPER(SELECTEDVALUE(dim_location[site_type], "Mining site"))
VAR _region = UPPER(SELECTEDVALUE(dim_location[region]))
RETURN
	_type & IF(_region <> "", "  //  " & _region, "")`
  },
  {
    name: 'fmt_availability_color',
    dax: `SWITCH(
	TRUE(),
	[kpi_availability_pct] < 0.94, "${T.rose}",
	[kpi_availability_pct] < 0.95, "${T.gold}",
	"${T.teal}"
)`
  }
]

// ---------------------------------------------------------------- layout helpers
const L = (p) => col('dim_location', p)
const MAT = (p) => col('dim_material', p)
const EV = (p) => col('dim_event_type', p)
const CU = (p) => col('dim_customer', p)
const CATEGORY_COLORS = { 'Precious Metals': T.gold, Isotopes: T.ice, Volatiles: T.teal, 'Common Metals': T.copper, Exotics: T.violet, 'Industrial Minerals': '#C9D1DC' }
const SEVERITY_COLORS = { High: T.rose, Medium: T.gold, Low: T.teal }
const EVENT_CATEGORY_COLORS = { Planned: T.teal, Environmental: T.ice, Technical: T.gold, 'Human Factor': T.rose }

/** TopN visual filter: the top (or bottom) `n` values of a column by a measure. */
function topN(entity, prop, measure, n, { bottom = false } = {}) {
  const column = { Column: { Expression: { SourceRef: { Entity: entity } }, Property: prop } }
  return {
    name: hex(`${ID}/topn/${entity}/${prop}/${measure}/${n}/${bottom}`),
    field: column,
    type: 'TopN',
    filter: {
      Version: 2,
      From: [
        {
          Name: 'subquery',
          Expression: {
            Subquery: {
              Query: {
                Version: 2,
                From: [{ Name: 'd', Entity: entity, Type: 0 }],
                Select: [{ Column: { Expression: { SourceRef: { Source: 'd' } }, Property: prop }, Name: 'field' }],
                OrderBy: [{ Direction: bottom ? 1 : 2, Expression: { Measure: { Expression: { SourceRef: { Entity: '_measures_kpi' } }, Property: measure } } }],
                Top: n
              }
            }
          },
          Type: 2
        },
        { Name: 'd', Entity: entity, Type: 0 }
      ],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'd' } }, Property: prop } }], Table: { SourceRef: { Source: 'subquery' } } } } }]
    }
  }
}

const tableLook = { headBg: '#00000000', rowBg: '#00000000', color: T.ink, headColor: T.copper, font: 'Barlow', headFont: 'Roboto Condensed', lineColor: T.grid, size: 9, rowPadding: 5 }
const availabilityColor = (v) => columnColor(v, '_measures_kpi.kpi_availability_pct', 'fmt_availability_color')

function page(k, title, kicker, extra = []) {
  return chrome(k, {
    title,
    kicker,
    period: fmt('fmt_period'),
    filters: [
      yearSlicer(k, { x: 20, y: 434, w: 172, h: 34, year: YEAR, ...railSlicer, motion: PIN }),
      k.slicer({ name: 'body', x: 20, y: 478, w: 172, h: 58, field: L('celestial_body'), header: 'CELESTIAL BODY', syncGroup: 'body', ...railSlicer, motion: PIN }),
      k.slicer({ name: 'category', x: 20, y: 544, w: 172, h: 58, field: MAT('category'), header: 'MATERIAL CATEGORY', syncGroup: 'category', ...railSlicer, motion: PIN })
    ],
    extra
  })
}

const W5 = 196
const GAP = 12
const xs5 = [0, 1, 2, 3, 4].map((i) => X0 + i * (W5 + GAP))

// tiles shared by Command and Extraction: the same label and fields, so the morph transition glides them
const oreTile = (k, x, y) => tile(k, 'ore', x, y, W5, 'ORE EXTRACTED', kpi('kpi_ore_t'), fmt('fmt_ore_note'), T.copper)
const availabilityTile = (k, x, y) => tile(k, 'availability', x, y, W5, 'AVAILABILITY', kpi('kpi_availability_pct'), fmt('fmt_availability_note'), T.teal)
const sitesTile = (k, x, y) => tile(k, 'sites', x, y, W5, 'ACTIVE SITES', kpi('kpi_active_sites'), fmt('fmt_sites_note'), T.ice)

// ---------------------------------------------------------------- pages
function command(seed) {
  const k = kit(seed, T)
  return [
    ...page(k, 'Command', 'FLEET-WIDE OPERATIONS  //  YEAR IN VIEW'),
    ...oreTile(k, xs5[0], 80),
    ...availabilityTile(k, xs5[1], 80),
    ...tile(k, 'shipped', xs5[2], 80, W5, 'TONNAGE SHIPPED', kpi('kpi_shipped_t'), fmt('fmt_shipped_note'), T.gold),
    ...tile(k, 'revenue', xs5[3], 80, W5, 'REVENUE', kpi('kpi_revenue_t'), fmt('fmt_revenue_note'), T.violet),
    ...sitesTile(k, xs5[4], 80),
    k.line(framed({ name: 'trend', x: X0, y: 190, w: 620, h: 230, area: true, stacked: true, cat: cal('month_abbr'), val: [as(kpi('kpi_ore_t'), 'Ore extracted')], series: MAT('category'), colorMap: CATEGORY_COLORS, legend: 'TopRight', grid: true, smooth: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Ore extracted', 'TONNES PER MONTH BY MATERIAL CATEGORY')),
    k.donut(framed({ name: 'bodies', x: 860, y: 190, w: 396, h: 230, cat: L('celestial_body'), val: as(kpi('kpi_ore_t'), 'Ore extracted'), innerRadius: 62, labelStyle: 'Category, percent of total', labelColor: T.ink }, 'Share by celestial body', 'TONNES EXTRACTED', T.teal)),
    k.column(framed({ name: 'leaders', x: X0, y: 432, w: 500, h: 268, horizontal: true, cat: L('site'), val: [as(kpi('kpi_ore_t'), 'Ore extracted')], colors: [T.copper], labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_ore_t') }, axisSize: 8, filters: [topN('dim_location', 'site', 'kpi_ore_t', 8)] }, 'Site leaderboard', 'TOP 8 BY TONNES  ·  RIGHT-CLICK A SITE TO DRILL THROUGH')),
    availabilityColor(
      growToFit(
        k.table(
          framed(
            { name: 'materials', x: 740, y: 432, w: 516, h: 268, fields: [as(MAT('material'), 'Material'), as(kpi('kpi_ore_t'), 'Extracted'), as(kpi('kpi_availability_pct'), 'Availability'), as(kpi('kpi_shipped_t'), 'Shipped'), as(kpi('kpi_revenue_b'), 'Revenue')], ...tableLook, sort: { field: kpi('kpi_revenue_b') } },
            'Materials',
            'OUTPUT, AVAILABILITY, HAULAGE AND REVENUE',
            T.gold
          )
        )
      )
    )
  ]
}

function extraction(seed) {
  const k = kit(seed, T)
  const rx = X1 - W5
  const btn = (name, x, text, bookmark) =>
    k.button({ name, x, y: 80, w: 128, h: 28, text, font: 'Roboto Condensed', size: 8.5, color: T.ink, fill: '#1C222B', hoverFill: '#262E39', line: '#38414E', radius: 6, action: { type: 'Bookmark', bookmark: bookmarkId(ID, bookmark) }, motion: { entrance: 'none' } })
  return [
    ...page(k, 'Extraction', 'OUTPUT BY MATERIAL AND SITE  //  PRODUCTIVITY'),
    btn('by-material', X0, 'BY MATERIAL', 'By material'),
    btn('by-site', X0 + 136, 'BY SITE', 'By site'),
    k.text({ name: 'view-hint', x: X0 + 276, y: 84, w: 400, h: 22, runs: [{ text: 'BOOKMARKS  ·  THE VIEWS SWAP WITH A MORPH', font: 'Roboto Condensed', size: 7.5, color: T.muted }] }),
    // view A: by material (shown when the page opens)
    k.column(framed({ name: 'view-material', x: X0, y: 116, w: 816, h: 384, stacked: true, cat: cal('month_abbr'), val: [as(kpi('kpi_ore_t'), 'Ore extracted')], series: MAT('material'), legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Monthly output by material', 'TONNES EXTRACTED, STACKED')),
    // view B: by site (hidden until its bookmark)
    availabilityColor(
      growToFit(
        k.table({
          ...framed(
            { name: 'view-site', x: X0, y: 116, w: 816, h: 384, fields: [as(L('site'), 'Site'), as(L('celestial_body'), 'Body'), as(L('site_type'), 'Site type'), as(kpi('kpi_ore_t'), 'Extracted'), as(kpi('kpi_t_per_asset_day'), 't / asset-day'), as(kpi('kpi_availability_pct'), 'Availability'), as(kpi('kpi_downtime_h'), 'Downtime')], ...tableLook, totals: true, sort: { field: kpi('kpi_ore_t') } },
            'Output by site',
            'AVAILABILITY UNDER 95% IN GOLD, UNDER 94% IN ROSE',
            T.teal
          ),
          hidden: true
        })
      )
    ),
    ...oreTile(k, rx, 80),
    ...availabilityTile(k, rx, 188),
    ...sitesTile(k, rx, 296),
    ...tile(k, 'rate', rx, 404, W5, 'TONNES PER ASSET-DAY', kpi('kpi_t_per_asset_day'), fmt('fmt_rate_note'), T.gold),
    k.scatter(framed({ name: 'productivity', x: X0, y: 512, w: 600, h: 188, details: L('site'), xm: as(kpi('kpi_availability_pct'), 'Availability'), ym: as(kpi('kpi_t_per_asset_day'), 't / asset-day'), colors: [T.copper], grid: true, axisSize: 7.5 }, 'Productivity against availability', 'ONE DOT PER SITE', T.copper)),
    k.column(framed({ name: 'site-types', x: X0 + 612, y: 512, w: X1 - X0 - 612, h: 188, cat: L('site_type'), val: [as(kpi('kpi_ore_t'), 'Ore extracted')], colors: [T.teal], labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_ore_t') }, axisSize: 7 }, 'Output by site type', 'TONNES EXTRACTED', T.teal))
  ]
}

function reliability(seed) {
  const k = kit(seed, T)
  return [
    ...page(k, 'Fleet & Reliability', 'DOWNTIME EVENTS  //  AVAILABILITY'),
    ...tile(k, 'events', xs5[0], 80, W5, 'DOWNTIME EVENTS', kpi('kpi_events'), fmt('fmt_events_note'), T.rose),
    ...tile(k, 'event-hours', xs5[1], 80, W5, 'EVENT DOWNTIME', kpi('kpi_event_downtime_h'), fmt('fmt_event_hours_note'), T.gold),
    ...tile(k, 'severity', xs5[2], 80, W5, 'HIGH-SEVERITY EVENTS', kpi('kpi_high_severity_events'), fmt('fmt_severity_note'), T.violet),
    ...availabilityTile(k, xs5[3], 80),
    ...sitesTile(k, xs5[4], 80),
    k.combo(framed({ name: 'avail-trend', x: X0, y: 190, w: 620, h: 230, cat: cal('month_abbr'), columns: [as(kpi('kpi_event_downtime_h'), 'Event downtime')], lines: [as(kpi('kpi_availability_pct'), 'Availability')], colors: [T.violet, T.teal], legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Availability and downtime', 'EVENT HOURS PER MONTH  ·  AVAILABILITY', T.teal)),
    k.donut(framed({ name: 'asset-types', x: 860, y: 190, w: 396, h: 230, cat: col('fact_downtime', 'asset_type'), val: as(kpi('kpi_event_downtime_h'), 'Downtime'), innerRadius: 62, labelStyle: 'Category, percent of total', labelColor: T.ink }, 'Downtime by asset type', 'EVENT HOURS', T.violet)),
    k.column(framed({ name: 'events', x: X0, y: 432, w: 500, h: 268, horizontal: true, stacked: true, cat: EV('event'), val: [as(kpi('kpi_events'), 'Events')], series: EV('severity'), colorMap: SEVERITY_COLORS, legend: 'TopRight', yAxis: false, grid: false, sort: { field: kpi('kpi_events') }, axisSize: 8, objects: { legend: legend(T) } }, 'Events by type', 'STACKED BY SEVERITY', T.rose)),
    availabilityColor(
      growToFit(
        k.table(
          framed(
            { name: 'watchlist', x: 740, y: 432, w: 516, h: 268, filters: [topN('dim_location', 'site', 'kpi_availability_pct', 8, { bottom: true })], fields: [as(L('site'), 'Site'), as(L('celestial_body'), 'Body'), as(kpi('kpi_availability_pct'), 'Availability'), as(kpi('kpi_events'), 'Events'), as(kpi('kpi_h_per_event'), 'h / event')], ...tableLook, sort: { field: kpi('kpi_availability_pct'), dir: 'Ascending' } },
            'Watchlist',
            'LOWEST AVAILABILITY  ·  RIGHT-CLICK A SITE TO DRILL THROUGH',
            T.rose
          )
        )
      )
    )
  ]
}

function logistics(seed) {
  const k = kit(seed, T)
  return [
    ...page(k, 'Logistics', 'HAULAGE  //  STOCK ON HAND'),
    ...tile(k, 'shipped', xs5[0], 80, W5, 'TONNAGE SHIPPED', kpi('kpi_shipped_t'), fmt('fmt_shipped_note'), T.gold),
    ...tile(k, 'trips', xs5[1], 80, W5, 'HAUL TRIPS', kpi('kpi_trips'), fmt('fmt_trips_note'), T.copper),
    ...tile(k, 'cost', xs5[2], 80, W5, 'COST PER TONNE', kpi('kpi_cost_per_t'), null, T.violet),
    ...tile(k, 'transit', xs5[3], 80, W5, 'DAYS IN TRANSIT', kpi('kpi_transit_days'), fmt('fmt_transit_note'), T.ice),
    ...tile(k, 'stock', xs5[4], 80, W5, 'STOCK ON HAND', kpi('kpi_on_hand_mt'), fmt('fmt_stock_note'), T.teal),
    k.column(framed({ name: 'haul-trend', x: X0, y: 190, w: 620, h: 230, stacked: true, cat: cal('month_abbr'), val: [as(kpi('kpi_shipped_t'), 'Shipped')], series: MAT('category'), colorMap: CATEGORY_COLORS, legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Tonnage shipped', 'TONNES PER MONTH BY MATERIAL CATEGORY', T.gold)),
    k.treemap(framed({ name: 'stock', x: 860, y: 190, w: 396, h: 230, cat: MAT('material'), val: as(kpi('kpi_on_hand_t'), 'Stock on hand'), labelColor: '#0A0C10' }, 'Stock on hand', 'TONNES AT MONTH END, BY MATERIAL', T.teal)),
    k.column(framed({ name: 'origins', x: X0, y: 432, w: 500, h: 268, horizontal: true, cat: L('celestial_body'), val: [as(kpi('kpi_shipped_t'), 'Shipped')], colors: [T.gold], labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_shipped_t') }, axisSize: 8, filters: [topN('dim_location', 'celestial_body', 'kpi_shipped_t', 8)] }, 'Shipped by origin', 'TOP 8 CELESTIAL BODIES, TONNES', T.gold)),
    k.combo(framed({ name: 'transit', x: 740, y: 432, w: 516, h: 268, cat: cal('month_abbr'), columns: [as(kpi('kpi_cost_per_t'), 'Cost per tonne')], lines: [as(kpi('kpi_transit_days'), 'Days in transit')], colors: [T.violet, T.ice], legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Transit and cost', 'HAUL COST PER TONNE  ·  DAYS PER TRIP', T.ice))
  ]
}

function markets(seed) {
  const k = kit(seed, T)
  return [
    ...page(k, 'Markets', 'REVENUE  //  CUSTOMERS AND MATERIALS'),
    ...tile(k, 'revenue', xs5[0], 80, W5, 'REVENUE', kpi('kpi_revenue_t'), fmt('fmt_revenue_note'), T.violet),
    ...tile(k, 'sold', xs5[1], 80, W5, 'TONNES SOLD', kpi('kpi_tons_sold'), null, T.copper),
    ...tile(k, 'value', xs5[2], 80, W5, 'VALUE PER TONNE', kpi('kpi_value_per_t_musd'), null, T.gold),
    ...tile(k, 'customers', xs5[3], 80, W5, 'CUSTOMERS', kpi('kpi_customers'), fmt('fmt_customers_note'), T.teal),
    ...tile(k, 'shipped', xs5[4], 80, W5, 'TONNAGE SHIPPED', kpi('kpi_shipped_t'), fmt('fmt_shipped_note'), T.gold),
    k.combo(framed({ name: 'revenue-trend', x: X0, y: 190, w: 620, h: 230, cat: cal('month_abbr'), columns: [as(kpi('kpi_revenue_t'), 'Revenue')], lines: [as(kpi('kpi_tons_sold'), 'Tonnes sold')], colors: [T.violet, T.gold], legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Revenue and volume', '$ TRILLIONS PER MONTH  ·  TONNES SOLD', T.violet)),
    k.donut(framed({ name: 'sectors', x: 860, y: 190, w: 396, h: 230, cat: CU('sector'), val: as(kpi('kpi_revenue_b'), 'Revenue'), innerRadius: 62, labelStyle: 'Category, percent of total', labelColor: T.ink }, 'Revenue by sector', 'SHARE OF REVENUE', T.teal)),
    k.column(framed({ name: 'materials-rev', x: X0, y: 432, w: 500, h: 268, horizontal: true, cat: MAT('material'), val: [as(kpi('kpi_revenue_b'), 'Revenue')], colors: [T.violet], labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_revenue_b') }, axisSize: 8, objects: { labels: { show: true, color: c(T.ink), fontSize: 8, fontFamily: T.fontBody, labelDisplayUnits: 1 } } }, 'Revenue by material', '$ BILLIONS', T.violet)),
    growToFit(
      k.table(
        framed(
          { name: 'customers', x: 740, y: 432, w: 516, h: 268, filters: [topN('dim_customer', 'customer', 'kpi_revenue_b', 10)], fields: [as(CU('customer'), 'Customer'), as(CU('sector'), 'Sector'), as(kpi('kpi_revenue_b'), 'Revenue'), as(kpi('kpi_tons_sold'), 'Tonnes')], ...tableLook, sort: { field: kpi('kpi_revenue_b') } },
          'Top customers',
          'BY REVENUE',
          T.gold
        )
      )
    )
  ]
}

function siteDetail(seed) {
  const k = kit(seed, T)
  return [
    ...page(k, 'Site detail', 'DRILL-THROUGH  //  ONE SITE', [
      k.button({ name: 'back', x: 1128, y: 22, w: 128, h: 30, text: 'BACK', icon: 'back', font: 'Roboto Condensed', size: 9, color: T.ink, fill: '#1C222B', hoverFill: '#262E39', line: T.copper, radius: 6, action: { type: 'Back' }, motion: { entrance: 'none' } }),
      k.card({ name: 'site-title', x: X0 + 230, y: 12, w: 640, h: 34, field: fmt('fmt_site_title'), size: 16, font: 'Barlow Semibold', color: T.copper }),
      k.card({ name: 'site-kicker', x: X0 + 232, y: 44, w: 640, h: 22, field: fmt('fmt_site_kicker'), size: 8, font: 'Roboto Condensed', color: T.muted })
    ]),
    ...oreTile(k, xs5[0], 80),
    ...availabilityTile(k, xs5[1], 80),
    ...tile(k, 'rate', xs5[2], 80, W5, 'TONNES PER ASSET-DAY', kpi('kpi_t_per_asset_day'), fmt('fmt_rate_note'), T.gold),
    ...tile(k, 'events', xs5[3], 80, W5, 'DOWNTIME EVENTS', kpi('kpi_events'), fmt('fmt_events_note'), T.rose),
    ...tile(k, 'shipped', xs5[4], 80, W5, 'TONNAGE SHIPPED', kpi('kpi_shipped_t'), fmt('fmt_shipped_note'), T.gold),
    k.column(framed({ name: 'site-trend', x: X0, y: 190, w: 620, h: 230, stacked: true, cat: cal('month_abbr'), val: [as(kpi('kpi_ore_t'), 'Ore extracted')], series: MAT('material'), legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Monthly output', 'TONNES EXTRACTED BY MATERIAL')),
    k.donut(framed({ name: 'site-events', x: 860, y: 190, w: 396, h: 230, cat: EV('event_category'), val: as(kpi('kpi_event_downtime_h'), 'Downtime'), innerRadius: 62, labelStyle: 'Category, percent of total', labelColor: T.ink, colorMap: EVENT_CATEGORY_COLORS }, 'Downtime by cause', 'EVENT HOURS', T.rose)),
    k.line(framed({ name: 'site-avail', x: X0, y: 432, w: 500, h: 268, area: true, cat: cal('month_abbr'), val: [as(kpi('kpi_availability_pct'), 'Availability')], colors: [T.teal], smooth: true, grid: true, axisSize: 7.5 }, 'Availability', 'BY MONTH', T.teal)),
    growToFit(
      k.table(
        framed(
          { name: 'site-materials', x: 740, y: 432, w: 516, h: 268, fields: [as(MAT('material'), 'Material'), as(kpi('kpi_ore_t'), 'Extracted'), as(kpi('kpi_shipped_t'), 'Shipped'), as(kpi('kpi_on_hand_t'), 'On hand')], ...tableLook, sort: { field: kpi('kpi_ore_t') } },
          'Materials at this site',
          'EXTRACTED, SHIPPED AND IN STOCK',
          T.gold
        )
      )
    )
  ]
}

const visualName = (pageName, name) => hex(`${ID}/${pageName}/${name}`)
const VIEW_TYPES = { [visualName('Extraction', 'view-material')]: 'columnChart', [visualName('Extraction', 'view-site')]: 'tableEx' }

export default {
  id: ID,
  name: 'Regolith',
  theme: themeOf(T),
  calendar: { start: '2069-01-01', end: '2070-12-31' },
  tables,
  relationships,
  measures: { kpi: KPI, format: FMT },
  // the showcase's motion: a stagger down every page and a transition per page (Lumen only; Power BI ignores them)
  motion: { duration: 650, stagger: 45, transition: 'fade', transitionDuration: 560 },
  resources: { 'regolith-bg.svg': backdrop(), 'regolith-bg-plain.svg': backdrop({ rock: false }), 'regolith-rail.svg': rail, 'regolith-logo.svg': logo },
  bookmarks: [
    { name: 'By material', page: 'Extraction', show: [visualName('Extraction', 'view-material')], hide: [visualName('Extraction', 'view-site')], types: VIEW_TYPES },
    { name: 'By site', page: 'Extraction', show: [visualName('Extraction', 'view-site')], hide: [visualName('Extraction', 'view-material')], types: VIEW_TYPES }
  ],
  pages: [
    { name: 'Command', background: { color: T.bg, image: 'regolith-bg.svg' }, wallpaper: '#050608', motion: { transition: 'circle' }, visuals: command },
    { name: 'Extraction', background: { color: T.bg, image: 'regolith-bg-plain.svg' }, wallpaper: '#050608', motion: { transition: 'morph' }, visuals: extraction },
    { name: 'Fleet & Reliability', background: { color: T.bg, image: 'regolith-bg-plain.svg' }, wallpaper: '#050608', motion: { transition: 'push' }, visuals: reliability },
    { name: 'Logistics', background: { color: T.bg, image: 'regolith-bg-plain.svg' }, wallpaper: '#050608', motion: { transition: 'depth' }, visuals: logistics },
    { name: 'Markets', background: { color: T.bg, image: 'regolith-bg-plain.svg' }, wallpaper: '#050608', motion: { transition: 'wipe' }, visuals: markets },
    { name: 'Site detail', background: { color: T.bg, image: 'regolith-bg-plain.svg' }, wallpaper: '#050608', hidden: true, drillthrough: { entity: 'dim_location', prop: 'site' }, motion: { transition: 'zoom' }, visuals: siteDetail }
  ]
}


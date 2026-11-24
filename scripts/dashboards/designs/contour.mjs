/**
 * Contour, live: a regional park system's season in review. Six parks with their trails, daily visits and camping,
 * trail work orders, tree planting and wildlife sightings, January 2025 to October 2026. Pages: Trail Report (the
 * gallery template's layout), Visitors, Conservation.
 */
import { kit, themeOf } from '../../templates/kit.mjs'
import { as, c, col } from '../../templates/lib.mjs'
import template, { T, WAYPOINTS, backdrop, compass } from '../../templates/designs/contour.mjs'
import { addDays, clamp, days, iso, monthIndex, normal, pick, poisson, rng, round, season, wobble, START, END } from '../data.mjs'
import { cal, columnColor, fmt, growToFit, kpi, legend, yearSlicer } from '../kit.mjs'

// ---------------------------------------------------------------- data
const PARKS = [
  // key, park, terrain, region, area km², campsites, size (visit scale), established, campground demand
  [1, 'Cedar Ridge', 'Alpine', 'North', 412, 96, 1.3, '1962-06-01', 1.15],
  [2, 'Fox Hollow', 'Forest', 'East', 188, 64, 0.9, '1971-05-15', 0.9],
  [3, 'Granite Basin', 'Alpine', 'North', 356, 40, 0.75, '1984-07-04', 0.7],
  [4, 'Mirror Lake', 'Lakeshore', 'West', 141, 120, 1.1, '1958-08-20', 1.3],
  [5, 'Pine Bluff', 'Forest', 'South', 97, 48, 0.6, '1993-04-10', 0.85],
  [6, 'Heron Marsh', 'Wetland', 'East', 66, 0, 0.45, '2004-09-01', 0]
]
const TRAIL_NAMES = {
  1: [['Summit Loop', 'Strenuous', 11.2, 840], ['Larch Traverse', 'Moderate', 8.4, 410], ['Ridge Spur', 'Strenuous', 5.1, 520], ['Meadow Walk', 'Easy', 3.2, 60]],
  2: [['Hollow Creek', 'Easy', 4.6, 80], ['Old Mill Path', 'Easy', 2.8, 30], ['Fernback Loop', 'Moderate', 7.3, 190]],
  3: [['Granite Stairs', 'Strenuous', 6.7, 690], ['Basin Rim', 'Moderate', 12.5, 380], ['Tarn Trail', 'Moderate', 9.1, 300]],
  4: [['Shoreline Loop', 'Easy', 9.8, 40], ['Lookout Point', 'Moderate', 4.4, 210], ['Boathouse Path', 'Easy', 1.9, 10], ['Birch Island', 'Easy', 3.5, 20]],
  5: [['Bluff Edge', 'Moderate', 5.9, 240], ['Pinewood Circuit', 'Easy', 6.2, 90]],
  6: [['Boardwalk', 'Easy', 2.4, 0], ['Heron Blind Path', 'Easy', 3.1, 10]]
}
const TRAILS = Object.entries(TRAIL_NAMES).flatMap(([pk, list]) => list.map((t) => [Number(pk), ...t])).map((t, i) => [i + 1, ...t])
const SPECIES = [
  // key, species, class, status, weight, parks it favours (terrain)
  [1, 'Elk', 'Mammal', 'Least concern', 1.0, ['Alpine', 'Forest']],
  [2, 'Black bear', 'Mammal', 'Least concern', 0.35, ['Forest', 'Alpine']],
  [3, 'Moose', 'Mammal', 'Least concern', 0.25, ['Wetland', 'Lakeshore']],
  [4, 'Red fox', 'Mammal', 'Least concern', 0.7, ['Forest', 'Lakeshore']],
  [5, 'River otter', 'Mammal', 'Least concern', 0.3, ['Lakeshore', 'Wetland']],
  [6, 'Gray wolf', 'Mammal', 'Vulnerable', 0.08, ['Alpine']],
  [7, 'Canada lynx', 'Mammal', 'Endangered', 0.04, ['Alpine', 'Forest']],
  [8, 'Bald eagle', 'Bird', 'Least concern', 0.5, ['Lakeshore', 'Wetland']],
  [9, 'Great blue heron', 'Bird', 'Least concern', 0.6, ['Wetland', 'Lakeshore']],
  [10, 'Common loon', 'Bird', 'Near threatened', 0.3, ['Lakeshore']],
  [11, 'Peregrine falcon', 'Bird', 'Vulnerable', 0.12, ['Alpine']],
  [12, 'Wood turtle', 'Reptile', 'Endangered', 0.06, ['Wetland', 'Forest']],
  [13, 'Spotted salamander', 'Amphibian', 'Near threatened', 0.2, ['Forest', 'Wetland']]
]
const WORK = [['Clearing', 34], ['Grading', 18], ['Signage', 14], ['Erosion control', 20], ['Bridge repair', 6], ['Boardwalk repair', 8]]
const WORK_COST = { Clearing: 140, Grading: 620, Signage: 260, 'Erosion control': 880, 'Bridge repair': 4200, 'Boardwalk repair': 2600 }
const TREES = [['Douglas fir', 26], ['White pine', 22], ['Red oak', 18], ['Sugar maple', 16], ['Quaking aspen', 18]]
const SOURCES = [['Ranger survey', 30], ['Volunteer count', 25], ['Visitor app', 45]]

const r = rng('contour-live')
const visits = []
const work = []
const planting = []
const sightings = []
const holidays = new Set(['2025-05-26', '2025-07-04', '2025-09-01', '2026-05-25', '2026-07-03', '2026-09-07'])

for (const d of days()) {
  const dow = (d.getUTCDay() + 6) % 7
  const weekend = dow >= 5 || holidays.has(iso(d))
  for (const [pk, , terrain, , , campsites, size, , demand] of PARKS) {
    const peak = terrain === 'Alpine' ? 7 : terrain === 'Lakeshore' ? 6.6 : terrain === 'Wetland' ? 4.5 : 8.8
    const amp = terrain === 'Alpine' ? 0.85 : 0.6
    const growth = 1 + monthIndex(d) * 0.006 + (d.getUTCFullYear() === 2026 && terrain === 'Lakeshore' ? 0.08 : 0)
    const storm = r() < 0.025 ? 0.35 : 1
    const v = 270 * size * season(d, peak, amp) * (weekend ? 1.9 : 1) * growth * storm * wobble(r, 0.12)
    const visitors = Math.max(0, Math.round(v))
    const vehicles = Math.round(visitors / (2.6 + r() * 0.4))
    const campSeason = d.getUTCMonth() >= 4 && d.getUTCMonth() <= 9
    const nights = campsites ? Math.min(campsites, Math.round(campsites * (campSeason ? 0.55 : 0.08) * demand * season(d, 7, 0.4) * (weekend ? 1.45 : 0.85) * wobble(r, 0.1))) : 0
    const revenue = vehicles * 12 + nights * 34 + (r() < 0.1 ? 150 : 0)
    visits.push([d, pk, visitors, vehicles, nights, round(revenue, 2)])
    // wildlife sightings: a handful of reports a day, more in spring and early summer
    const reports = poisson(r, 1.3 * Math.sqrt(size) * season(d, 5.2, 0.55) * (weekend ? 1.4 : 1))
    for (let i = 0; i < reports; i++) {
      const sp = pick(r, SPECIES.map((s) => [s, s[4] * (s[5].includes(terrain) ? 1 : 0.12)]))
      const count = sp[2] === 'Bird' ? 1 + poisson(r, 1.4) : 1 + poisson(r, sp[1] === 'Elk' ? 3 : 0.4)
      sightings.push([d, pk, sp[0], pick(r, SOURCES), count])
    }
  }
  // trail work orders: snow-free months, a spring push after the thaw
  const month = d.getUTCMonth()
  const workRate = month >= 3 && month <= 10 ? 1.6 * season(d, 4.5, 0.35) : 0.25
  for (let i = poisson(r, workRate * (dow < 5 ? 1.1 : 0.7)); i > 0; i--) {
    const trail = TRAILS[Math.floor(r() * TRAILS.length)]
    const type = pick(r, trail[4] === 0 || trail[5] === 'Boardwalk' ? [['Boardwalk repair', 50], ['Signage', 20], ['Clearing', 30]] : WORK.filter(([t]) => t !== 'Boardwalk repair'))
    const km = type === 'Signage' || type.includes('repair') ? round(0.1 + r() * 0.4, 1) : round(Math.min(trail[4], 0.5 + r() * trail[4] * 0.6), 1)
    const volunteers = r() < 0.55 ? Math.round((4 + r() * 20) * (dow >= 5 ? 1.6 : 1)) : 0
    const staff = Math.round(3 + r() * 14)
    const cost = WORK_COST[type] * (type === 'Clearing' || type === 'Grading' || type === 'Erosion control' ? Math.max(1, km) : 1) * wobble(r, 0.2)
    work.push([`WO-${String(work.length + 1).padStart(4, '0')}`, d, trail[0], type, km, volunteers, staff, round(cost, 2)])
  }
  // tree planting: spring and autumn volunteer days
  if ((month === 3 || month === 4 || month === 9) && dow === 5 && r() < 0.9)
    for (const [pk, , terrain] of PARKS) {
      if (r() < 0.45) continue
      const tree = pick(r, terrain === 'Alpine' ? [['Douglas fir', 50], ['White pine', 30], ['Quaking aspen', 20]] : TREES)
      const planted = Math.round(120 + r() * 520)
      const checked = iso(addDays(d, 365)) <= END
      const survival = clamp(0.82 + normal(r) * 0.06 - (terrain === 'Alpine' ? 0.06 : 0), 0.55, 0.97)
      planting.push([d, pk, tree, planted, checked ? Math.round(planted * survival) : null])
    }
}

const tables = [
  {
    name: 'dim_park',
    group: 'Dimension',
    columns: [
      { name: 'park_key', type: 'int64', hidden: true },
      { name: 'park', type: 'string' },
      { name: 'terrain', type: 'string' },
      { name: 'region', type: 'string' },
      { name: 'area_km2', type: 'int64', format: '#,0' },
      { name: 'campsites', type: 'int64' },
      { name: 'established', type: 'date' }
    ],
    rows: PARKS.map(([k, p, t, rg, a, cs, , e]) => [k, p, t, rg, a, cs, e])
  },
  {
    name: 'dim_trail',
    group: 'Dimension',
    columns: [
      { name: 'trail_key', type: 'int64', hidden: true },
      { name: 'park_key', type: 'int64', hidden: true },
      { name: 'trail', type: 'string' },
      { name: 'difficulty', type: 'string' },
      { name: 'length_km', type: 'double', format: '#,0.0', summarize: 'sum' },
      { name: 'elevation_gain_m', type: 'int64', format: '#,0', summarize: 'none' }
    ],
    rows: TRAILS
  },
  {
    name: 'dim_species',
    group: 'Dimension',
    columns: [
      { name: 'species_key', type: 'int64', hidden: true },
      { name: 'species', type: 'string' },
      { name: 'class', type: 'string' },
      { name: 'conservation_status', type: 'string' }
    ],
    rows: SPECIES.map(([k, s, cl, st]) => [k, s, cl, st])
  },
  {
    name: 'fact_visit',
    group: 'Fact',
    columns: [
      { name: 'date', type: 'date' },
      { name: 'park_key', type: 'int64', hidden: true },
      { name: 'visitors', type: 'int64', format: '#,0' },
      { name: 'vehicles', type: 'int64', format: '#,0' },
      { name: 'campsite_nights', type: 'int64', format: '#,0' },
      { name: 'permit_revenue', type: 'currency', format: '\\$#,0' }
    ],
    rows: visits
  },
  {
    name: 'fact_trail_work',
    group: 'Fact',
    columns: [
      { name: 'work_order', type: 'string' },
      { name: 'date', type: 'date' },
      { name: 'trail_key', type: 'int64', hidden: true },
      { name: 'work_type', type: 'string' },
      { name: 'km_maintained', type: 'double', format: '#,0.0' },
      { name: 'volunteer_hours', type: 'int64', format: '#,0' },
      { name: 'staff_hours', type: 'int64', format: '#,0' },
      { name: 'cost', type: 'currency', format: '\\$#,0' }
    ],
    rows: work
  },
  {
    name: 'fact_planting',
    group: 'Fact',
    columns: [
      { name: 'date', type: 'date' },
      { name: 'park_key', type: 'int64', hidden: true },
      { name: 'tree_species', type: 'string' },
      { name: 'trees_planted', type: 'int64', format: '#,0' },
      { name: 'trees_alive_after_1yr', type: 'int64', format: '#,0' }
    ],
    rows: planting
  },
  {
    name: 'fact_sighting',
    group: 'Fact',
    columns: [
      { name: 'date', type: 'date' },
      { name: 'park_key', type: 'int64', hidden: true },
      { name: 'species_key', type: 'int64', hidden: true },
      { name: 'source', type: 'string' },
      { name: 'animals', type: 'int64', format: '#,0' }
    ],
    rows: sightings
  }
]

const relationships = [
  { from: 'dim_trail.park_key', to: 'dim_park.park_key' },
  { from: 'fact_visit.date', to: 'dim_calendar.date' },
  { from: 'fact_visit.park_key', to: 'dim_park.park_key' },
  { from: 'fact_trail_work.date', to: 'dim_calendar.date' },
  { from: 'fact_trail_work.trail_key', to: 'dim_trail.trail_key' },
  { from: 'fact_planting.date', to: 'dim_calendar.date' },
  { from: 'fact_planting.park_key', to: 'dim_park.park_key' },
  { from: 'fact_sighting.date', to: 'dim_calendar.date' },
  { from: 'fact_sighting.park_key', to: 'dim_park.park_key' },
  { from: 'fact_sighting.species_key', to: 'dim_species.species_key' }
]

// ---------------------------------------------------------------- measures
const py = (name, format) => ({
  name: `${name}_py`,
  dax: `CALCULATE(
	[${name}],
	SAMEPERIODLASTYEAR(dim_calendar[date])
)`,
  format
})
const KPI = [
  { folder: 'Visitors', name: 'kpi_visitors', dax: 'SUM(fact_visit[visitors])', format: '#,0' },
  { folder: 'Visitors', ...py('kpi_visitors', '#,0') },
  { folder: 'Visitors', name: 'kpi_visitors_yoy_pct', dax: 'DIVIDE([kpi_visitors] - [kpi_visitors_py], [kpi_visitors_py])', format: '+0.0%;-0.0%;0.0%' },
  { folder: 'Visitors', name: 'kpi_vehicles', dax: 'SUM(fact_visit[vehicles])', format: '#,0' },
  { folder: 'Visitors', name: 'kpi_permit_revenue', dax: 'SUM(fact_visit[permit_revenue])', format: '\\$#,0' },
  { folder: 'Visitors', ...py('kpi_permit_revenue', '\\$#,0') },
  { folder: 'Visitors', name: 'kpi_revenue_per_visitor', dax: 'DIVIDE([kpi_permit_revenue], [kpi_visitors])', format: '\\$#,0.00' },
  { folder: 'Visitors', name: 'kpi_campsite_nights', dax: 'SUM(fact_visit[campsite_nights])', format: '#,0' },
  {
    folder: 'Visitors',
    name: 'kpi_campsite_occupancy_pct',
    dax: `DIVIDE(
	[kpi_campsite_nights],
	SUMX(
		VALUES(dim_park[park_key]),
		CALCULATE(MAX(dim_park[campsites])) * CALCULATE(DISTINCTCOUNT(fact_visit[date]))
	)
)`,
    format: '0.0%'
  },
  { folder: 'Visitors', name: 'kpi_avg_daily_visitors', dax: 'AVERAGEX(VALUES(dim_calendar[date]), [kpi_visitors])', format: '#,0' },
  { folder: 'Trails', name: 'kpi_work_orders', dax: 'COUNTROWS(fact_trail_work)', format: '#,0' },
  { folder: 'Trails', name: 'kpi_trail_km_maintained', dax: 'SUM(fact_trail_work[km_maintained])', format: '#,0" km"' },
  { folder: 'Trails', name: 'kpi_volunteer_hours', dax: 'SUM(fact_trail_work[volunteer_hours])', format: '#,0' },
  { folder: 'Trails', name: 'kpi_staff_hours', dax: 'SUM(fact_trail_work[staff_hours])', format: '#,0' },
  { folder: 'Trails', name: 'kpi_volunteer_share_pct', dax: 'DIVIDE([kpi_volunteer_hours], [kpi_volunteer_hours] + [kpi_staff_hours])', format: '0%' },
  { folder: 'Trails', name: 'kpi_maintenance_cost', dax: 'SUM(fact_trail_work[cost])', format: '\\$#,0' },
  { folder: 'Trails', name: 'kpi_cost_per_km', dax: 'DIVIDE([kpi_maintenance_cost], [kpi_trail_km_maintained])', format: '\\$#,0' },
  { folder: 'Conservation', name: 'kpi_trees_planted', dax: 'SUM(fact_planting[trees_planted])', format: '#,0' },
  {
    folder: 'Conservation',
    name: 'kpi_tree_survival_pct',
    dax: `DIVIDE(
	SUM(fact_planting[trees_alive_after_1yr]),
	CALCULATE(
		SUM(fact_planting[trees_planted]),
		KEEPFILTERS(NOT ISBLANK(fact_planting[trees_alive_after_1yr]))
	)
)`,
    format: '0.0%'
  },
  { folder: 'Conservation', name: 'kpi_sightings', dax: 'COUNTROWS(fact_sighting)', format: '#,0' },
  { folder: 'Conservation', ...py('kpi_sightings', '#,0') },
  { folder: 'Conservation', name: 'kpi_animals_counted', dax: 'SUM(fact_sighting[animals])', format: '#,0' },
  { folder: 'Conservation', name: 'kpi_species_logged', dax: 'DISTINCTCOUNT(fact_sighting[species_key])', format: '0' },
  {
    folder: 'Conservation',
    name: 'kpi_at_risk_sightings',
    dax: `CALCULATE(
	[kpi_sightings],
	KEEPFILTERS(dim_species[conservation_status] IN {"Vulnerable", "Endangered"})
)`,
    format: '#,0'
  }
]

const FMT = [
  {
    name: 'fmt_period',
    dax: `VAR _first = MIN(dim_calendar[date])
VAR _last = MAX(dim_calendar[date])
RETURN
	UPPER(FORMAT(_first, "MMM") & " – " & FORMAT(_last, "MMM yyyy"))`
  },
  {
    name: 'fmt_busiest_park',
    dax: `VAR _top =
	TOPN(
		1,
		VALUES(dim_park[park]),
		[kpi_visitors]
	)
RETURN
	MAXX(_top, dim_park[park])`
  },
  { name: 'fmt_visitors_note', dax: '"busiest: " & [fmt_busiest_park] & "  ·  " & FORMAT([kpi_visitors_yoy_pct], "+0%;-0%;0%") & " vs last year"' },
  { name: 'fmt_trail_note', dax: 'FORMAT([kpi_work_orders], "#,0") & " work orders  ·  " & FORMAT([kpi_volunteer_hours], "#,0") & " volunteer hours"' },
  {
    name: 'fmt_trees_note',
    dax: `IF(
	ISBLANK([kpi_tree_survival_pct]),
	"first-year survival checks due next season",
	FORMAT([kpi_tree_survival_pct], "0%") & " alive after their first year"
)`
  },
  { name: 'fmt_sightings_note', dax: '[kpi_species_logged] & " species  ·  " & [kpi_at_risk_sightings] & " at-risk sightings"' },
  { name: 'fmt_revenue_note', dax: 'FORMAT([kpi_revenue_per_visitor], "$0.00") & " per visitor"' },
  { name: 'fmt_camping_note', dax: 'FORMAT([kpi_campsite_nights], "#,0") & " site nights booked"' },
  { name: 'fmt_daily_note', dax: '"peak day: " & FORMAT(MAXX(VALUES(dim_calendar[date]), [kpi_visitors]), "#,0")' },
  { name: 'fmt_cost_note', dax: 'FORMAT([kpi_cost_per_km], "$#,0") & " per km"' },
  { name: 'fmt_volunteer_note', dax: 'FORMAT([kpi_volunteer_share_pct], "0%") & " of all trail hours"' },
  {
    name: 'fmt_yoy_color',
    dax: `IF(
	[kpi_visitors_yoy_pct] < 0,
	"${T.clay}",
	"${T.forest}"
)`
  }
]

// ---------------------------------------------------------------- layout
const P = (p) => col('dim_park', p)
const panel = { background: { color: c('#FBF7EE') }, border: { color: c(T.ink), width: 1.5, radius: 10 }, padding: 14 }
const head = (text) => ({ show: true, text, fontFamily: 'Trebuchet MS', fontSize: 12, bold: true, fontColor: c(T.ink) })
const framed = (spec, title) => ({ ...spec, box: { ...panel, title: head(title) } })
const CLASS_COLORS = { Mammal: T.forest, Bird: '#D9A441', Reptile: T.clay, Amphibian: '#4F8A8B' }
const WORK_COLORS = { Clearing: T.clay, Grading: '#4F8A8B', 'Erosion control': T.moss, Signage: '#D9A441', 'Bridge repair': '#8A6F4D', 'Boardwalk repair': T.forest }
const STATUS_COLORS = { 'Least concern': T.moss, 'Near threatened': '#D9A441', Vulnerable: T.clay, Endangered: '#8C2F1B' }

function slicers(k, x) {
  return [
    k.slicer({ name: 'park', x, y: 30, w: 200, h: 54, field: P('park'), header: 'PARK', headFont: 'Trebuchet MS', headColor: T.ink, itemBg: '#FBF7EE', outline: 'Frame', outlineColor: T.ink, syncGroup: 'park' }),
    k.text({ name: 'year-h', x: x + 216, y: 30, w: 110, h: 18, runs: [{ text: 'YEAR', font: 'Trebuchet MS', size: 8, bold: true, color: T.ink }] }),
    yearSlicer(k, { x: x + 212, y: 46, w: 110, h: 38, itemBg: '#FBF7EE', outline: 'Frame', outlineColor: T.ink, font: 'Trebuchet MS' })
  ]
}

function trailReport(seed) {
  const k = kit(seed, T)
  const waypoint = (i, label, value, note, units = 1) => {
    const [x, y] = WAYPOINTS[i]
    return [
      k.text({ name: `w${i}-l`, x: x - 55, y: y - 38, w: 110, h: 18, align: 'center', runs: [{ text: label, font: 'Trebuchet MS', size: 7.5, bold: true, color: T.clay }] }),
      k.card({ name: `w${i}-v`, x: x - 60, y: y - 22, w: 120, h: 38, field: kpi(value), size: 16, font: 'Georgia', bold: true, color: T.ink, align: 'center', units }),
      k.card({ name: `w${i}-n`, x: x - 120, y: y + 66, w: 240, h: 26, field: fmt(note), size: 8.5, font: 'Trebuchet MS', italic: true, color: T.muted, align: 'center', wrap: true })
    ]
  }
  return [
    k.text({ name: 'kicker', x: 40, y: 26, w: 500, h: 20, runs: [{ text: 'PARKS & CONSERVATION  ·  SEASON IN REVIEW', font: 'Trebuchet MS', size: 9, bold: true, color: T.clay }] }),
    k.text({ name: 'title', x: 40, y: 44, w: 600, h: 54, runs: [{ text: 'Trail Report', font: 'Georgia', size: 32, bold: true, color: T.ink }] }),
    k.card({ name: 'sub', x: 38, y: 96, w: 560, h: 26, field: fmt('fmt_period'), size: 11, font: 'Georgia', italic: true, color: T.ink }),
    ...slicers(k, 640),
    k.img({ name: 'compass', x: 1170, y: 140, w: 80, h: 80, src: 'contour-compass.svg' }),
    ...waypoint(0, 'VISITORS', 'kpi_visitors', 'fmt_visitors_note', 0),
    ...waypoint(1, 'TRAILS KEPT', 'kpi_trail_km_maintained', 'fmt_trail_note'),
    ...waypoint(2, 'TREES PLANTED', 'kpi_trees_planted', 'fmt_trees_note'),
    ...waypoint(3, 'SIGHTINGS', 'kpi_sightings', 'fmt_sightings_note'),
    k.line(framed({ name: 'profile', x: 40, y: 466, w: 600, h: 226, area: true, cat: cal('month_abbr'), val: [as(kpi('kpi_visitors'), 'Visitors')], colors: [T.forest], smooth: true, width: 2.5, yAxis: false, grid: false, objects: { lineStyles: { strokeWidth: 2.5, areaTransparency: 35, lineChartType: 'smooth' } } }, 'Visitor profile through the year')),
    k.column(framed({ name: 'parks', x: 660, y: 466, w: 290, h: 226, horizontal: true, cat: P('park'), val: [as(kpi('kpi_visitors'), 'Visitors')], colors: [T.clay], labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_visitors') } }, 'Visits by park')),
    k.donut(framed({ name: 'wildlife', x: 970, y: 466, w: 270, h: 226, cat: col('dim_species', 'class'), val: as(kpi('kpi_sightings'), 'Sightings'), innerRadius: 50, labelStyle: 'Category, percent of total', colorMap: CLASS_COLORS }, 'Wildlife sightings'))
  ]
}

/** Detail-page header over the low panorama. */
function header(k, title, kicker) {
  return [
    k.text({ name: 'kicker', x: 40, y: 16, w: 500, h: 20, runs: [{ text: kicker, font: 'Trebuchet MS', size: 9, bold: true, color: T.clay }] }),
    k.text({ name: 'title', x: 40, y: 32, w: 420, h: 48, runs: [{ text: title, font: 'Georgia', size: 26, bold: true, color: T.ink }] }),
    k.card({ name: 'sub', x: 360, y: 44, w: 260, h: 26, field: fmt('fmt_period'), size: 10, font: 'Georgia', italic: true, color: T.ink }),
    ...slicers(k, 900).map((v) => ({ ...v, position: { ...v.position, y: v.position.y - 16 } }))
  ]
}

/** Badge card: a ruled label over a figure and a note. */
function badge(k, name, x, y, w, label, value, note) {
  return [
    k.shape({ name: `${name}-bg`, x, y, w, h: 92, shape: 'roundedRectangle', radius: 10, fill: '#FBF7EE', line: T.ink, lineWeight: 1.5 }),
    k.text({ name: `${name}-l`, x: x + 14, y: y + 10, w: w - 28, h: 18, runs: [{ text: label, font: 'Trebuchet MS', size: 7.5, bold: true, color: T.clay }] }),
    k.card({ name: `${name}-v`, x: x + 10, y: y + 26, w: w - 20, h: 38, field: kpi(value), size: 20, font: 'Georgia', bold: true, color: T.ink }),
    k.card({ name: `${name}-n`, x: x + 10, y: y + 62, w: w - 20, h: 24, field: fmt(note), size: 8, font: 'Trebuchet MS', italic: true, color: T.muted })
  ]
}

function visitorsPage(seed) {
  const k = kit(seed, T)
  const w = 290, xs = [40, 343, 646, 950]
  return [
    ...header(k, 'Visitors', 'PARKS & CONSERVATION  ·  VISITORS AND CAMPING'),
    ...badge(k, 'b1', xs[0], 132, w, 'VISITORS', 'kpi_visitors', 'fmt_visitors_note'),
    ...badge(k, 'b2', xs[1], 132, w, 'AVERAGE DAILY VISITORS', 'kpi_avg_daily_visitors', 'fmt_daily_note'),
    ...badge(k, 'b3', xs[2], 132, w, 'PERMIT REVENUE', 'kpi_permit_revenue', 'fmt_revenue_note'),
    ...badge(k, 'b4', xs[3], 132, w, 'CAMPSITE OCCUPANCY', 'kpi_campsite_occupancy_pct', 'fmt_camping_note'),
    k.line(framed({ name: 'yoy', x: 40, y: 240, w: 760, h: 220, cat: cal('month_abbr'), val: [as(kpi('kpi_visitors'), 'This year'), as(kpi('kpi_visitors_py'), 'Last year')], colors: [T.forest, '#B9AD8E'], legend: 'TopRight', markers: true, grid: true, axisSize: 8, objects: { legend: legend(T) } }, 'Visitors against last year')),
    k.column(framed({ name: 'weekday', x: 816, y: 240, w: 424, h: 220, cat: cal('day_abbr'), val: [as(kpi('kpi_avg_daily_visitors'), 'Average visitors')], colors: [T.moss], labels: true, yAxis: false, grid: false, labelSize: 7.5 }, 'An average day, by weekday')),
    yoyColor(growToFit(k.table(
      framed(
        {
          name: 'park-table',
          x: 40,
          y: 476,
          w: 760,
          h: 216,
          fields: [as(P('park'), 'Park'), as(P('terrain'), 'Terrain'), as(kpi('kpi_visitors'), 'Visitors'), as(kpi('kpi_visitors_yoy_pct'), 'vs last year'), as(kpi('kpi_permit_revenue'), 'Permit revenue'), as(kpi('kpi_campsite_nights'), 'Site nights'), as(kpi('kpi_campsite_occupancy_pct'), 'Occupancy')],
          headBg: '#FBF7EE',
          rowBg: '#FBF7EE',
          headColor: T.clay,
          headFont: 'Trebuchet MS',
          font: 'Trebuchet MS',
          lineColor: '#D8CFB9',
          totals: true,
          rowPadding: 5,
          sort: { field: kpi('kpi_visitors') }
        },
        'Parks at a glance'
      )
    ))),
    k.column(framed({ name: 'revenue', x: 816, y: 476, w: 424, h: 216, stacked: true, cat: cal('quarter'), val: [as(kpi('kpi_permit_revenue'), 'Permit revenue')], series: P('terrain'), colorMap: { Alpine: T.forest, Forest: T.moss, Lakeshore: '#4F8A8B', Wetland: '#D9A441' }, legend: 'TopRight', yAxis: false, grid: false, labels: false, objects: { legend: legend(T) } }, 'Permit revenue by quarter'))
  ]
}

const yoyColor = (v) => columnColor(v, '_measures_kpi.kpi_visitors_yoy_pct', 'fmt_yoy_color')

function conservationPage(seed) {
  const k = kit(seed, T)
  const w = 290, xs = [40, 343, 646, 950]
  const S = (p) => col('dim_species', p)
  return [
    ...header(k, 'Conservation', 'PARKS & CONSERVATION  ·  TRAILS, TREES AND WILDLIFE'),
    ...badge(k, 'b1', xs[0], 132, w, 'TRAIL KM MAINTAINED', 'kpi_trail_km_maintained', 'fmt_cost_note'),
    ...badge(k, 'b2', xs[1], 132, w, 'VOLUNTEER HOURS', 'kpi_volunteer_hours', 'fmt_volunteer_note'),
    ...badge(k, 'b3', xs[2], 132, w, 'TREES PLANTED', 'kpi_trees_planted', 'fmt_trees_note'),
    ...badge(k, 'b4', xs[3], 132, w, 'WILDLIFE SIGHTINGS', 'kpi_sightings', 'fmt_sightings_note'),
    k.column(framed({ name: 'work', x: 40, y: 240, w: 600, h: 220, stacked: true, cat: cal('month_abbr'), val: [as(kpi('kpi_trail_km_maintained'), 'Km maintained')], series: col('fact_trail_work', 'work_type'), colorMap: WORK_COLORS, legend: 'TopRight', yAxis: true, grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Trail work through the season')),
    k.column(framed({ name: 'species', x: 656, y: 240, w: 584, h: 220, horizontal: true, stacked: true, cat: S('species'), val: [as(kpi('kpi_sightings'), 'Sightings')], series: S('conservation_status'), colorMap: STATUS_COLORS, legend: 'TopRight', yAxis: false, grid: false, sort: { field: kpi('kpi_sightings') }, axisSize: 7.5, objects: { legend: legend(T) } }, 'Sightings by species and status')),
    growToFit(k.table(
      framed(
        {
          name: 'trail-table',
          x: 40,
          y: 476,
          w: 820,
          h: 216,
          fields: [as(col('dim_trail', 'trail'), 'Trail'), as(P('park'), 'Park'), as(col('dim_trail', 'difficulty'), 'Difficulty'), as(kpi('kpi_work_orders'), 'Work orders'), as(kpi('kpi_trail_km_maintained'), 'Km'), as(kpi('kpi_volunteer_hours'), 'Volunteer h'), as(kpi('kpi_maintenance_cost'), 'Cost')],
          headBg: '#FBF7EE',
          rowBg: '#FBF7EE',
          headColor: T.clay,
          headFont: 'Trebuchet MS',
          font: 'Trebuchet MS',
          lineColor: '#D8CFB9',
          totals: true,
          rowPadding: 4,
          sort: { field: kpi('kpi_maintenance_cost') }
        },
        'Trail work by trail'
      )
    )),
    k.donut(framed({ name: 'trees', x: 876, y: 476, w: 364, h: 216, cat: col('fact_planting', 'tree_species'), val: as(kpi('kpi_trees_planted'), 'Trees planted'), innerRadius: 52, labelStyle: 'Category, percent of total', colorMap: { 'Douglas fir': T.forest, 'White pine': T.moss, 'Red oak': T.clay, 'Sugar maple': '#D9A441', 'Quaking aspen': '#4F8A8B' } }, 'Trees planted by species'))
  ]
}

export default {
  id: 'contour',
  name: 'Contour',
  theme: themeOf(T),
  calendar: { start: START, end: END },
  tables,
  relationships,
  measures: { kpi: KPI, format: FMT },
  resources: { 'contour-bg.svg': template.resources['contour-bg.svg'], 'contour-bg-low.svg': backdrop({ trail: false, band: 0.45 }), 'contour-compass.svg': compass },
  pages: [
    { name: 'Trail Report', background: { color: T.bg, image: 'contour-bg.svg' }, visuals: trailReport },
    { name: 'Visitors', background: { color: T.bg, image: 'contour-bg-low.svg' }, visuals: visitorsPage },
    { name: 'Conservation', background: { color: T.bg, image: 'contour-bg-low.svg' }, visuals: conservationPage }
  ]
}

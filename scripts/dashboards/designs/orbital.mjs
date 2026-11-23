/**
 * Orbital, live: satellite constellation operations for a fictional operator. Eight missions across four orbit
 * classes, a launch manifest, daily telemetry, an anomaly log and ground-station contacts, January 2025 to
 * October 2026. Pages: Mission Control (the gallery template's layout), Fleet Health, Launches & Ground Network.
 */
import { kit, themeOf } from '../../templates/kit.mjs'
import { as, c, col } from '../../templates/lib.mjs'
import template, { T, backdrop, glass, logo, satellite } from '../../templates/designs/orbital.mjs'
import { addDays, clamp, days, iso, monthIndex, monthStarts, daysInMonth, normal, pick, poisson, rng, round, season, wobble, START, END } from '../data.mjs'
import { cal, columnColor, fmt, growToFit, kpi, legend, yearSlicer } from '../kit.mjs'

// ---------------------------------------------------------------- data
const MISSIONS = [
  // key, mission, orbit, purpose, bus, satellites, commissioned
  [1, 'Helios', 'LEO', 'Earth observation', 'Aster-200', 24, '2021-04-12'],
  [2, 'Kestrel', 'LEO', 'Communications', 'Aster-200', 48, '2022-09-03'],
  [3, 'Lyra', 'MEO', 'Navigation', 'Heron-500', 12, '2020-02-18'],
  [4, 'Nimbus', 'GEO', 'Weather', 'Heron-XL', 3, '2019-07-30'],
  [5, 'Corvid', 'Polar', 'Earth observation', 'Aster-200', 16, '2023-03-21'],
  [6, 'Vanta', 'MEO', 'Communications', 'Heron-500', 8, '2023-11-08'],
  [7, 'Aster', 'GEO', 'Communications', 'Heron-XL', 4, '2018-05-14'],
  [8, 'Tern', 'Polar', 'Science', 'Aster-100', 6, '2025-06-02']
]
const ORBIT = {
  LEO: { launchesPerYear: 5.5, sats: [4, 8], massKg: 260, uptime: 0.9935, passesPerDay: 0.9, tbPerPass: 0.021 },
  MEO: { launchesPerYear: 1.6, sats: [1, 2], massKg: 1450, uptime: 0.9962, passesPerDay: 2.6, tbPerPass: 0.012 },
  GEO: { launchesPerYear: 0.55, sats: [1, 1], massKg: 4200, uptime: 0.9978, passesPerDay: 18, tbPerPass: 0.006 },
  Polar: { launchesPerYear: 3.2, sats: [2, 4], massKg: 380, uptime: 0.9884, passesPerDay: 1.4, tbPerPass: 0.026 }
}
const PURPOSE_DATA = { 'Earth observation': 1.6, Communications: 0.7, Navigation: 0.35, Weather: 1.2, Science: 1.1 }
const VEHICLES = {
  LEO: [['Halcyon 1', 0.7], ['Skylark 5', 0.3]],
  MEO: [['Skylark 5', 0.6], ['Halcyon Heavy', 0.4]],
  GEO: [['Halcyon Heavy', 1]],
  Polar: [['Vireo', 0.75], ['Halcyon 1', 0.25]]
}
const VEHICLE_COST = { 'Halcyon 1': 28, 'Halcyon Heavy': 96, 'Skylark 5': 54, Vireo: 9.5 }
const VEHICLE_SITE = { 'Halcyon 1': 'Coastal Pad 2', 'Halcyon Heavy': 'Coastal Pad 2', 'Skylark 5': 'High Desert Range', Vireo: 'North Cape Pad' }
const STATIONS = [
  // key, station, region, antennas, visibility by orbit
  [1, 'Northwatch', 'Polar', 6, { LEO: 1.3, MEO: 0.6, GEO: 0, Polar: 2.2 }],
  [2, 'Harbor Point', 'Americas', 4, { LEO: 1, MEO: 1, GEO: 1, Polar: 0.6 }],
  [3, 'Alder Fjord', 'Europe', 4, { LEO: 1, MEO: 1, GEO: 0.8, Polar: 0.9 }],
  [4, 'Sundar Hill', 'Asia Pacific', 3, { LEO: 0.9, MEO: 1.1, GEO: 1, Polar: 0.5 }],
  [5, 'Coral Reach', 'Asia Pacific', 2, { LEO: 0.8, MEO: 0.9, GEO: 0.7, Polar: 0.4 }],
  [6, 'Dune Array', 'Africa', 3, { LEO: 0.9, MEO: 0.8, GEO: 0.9, Polar: 0.5 }],
  [7, 'Southcross', 'Polar', 2, { LEO: 0.9, MEO: 0.3, GEO: 0, Polar: 1.6 }]
]
const SUBSYSTEMS = [['Communications', 24], ['Attitude control', 22], ['Power', 18], ['Payload', 14], ['Thermal', 12], ['Propulsion', 10]]
const SEVERITY = [['Minor', 70], ['Major', 25], ['Critical', 5]]
const RESOLVE = { Minor: [20, 180], Major: [120, 900], Critical: [600, 4000] }
const IMPACT = { Minor: 0.15, Major: 0.55, Critical: 1 }

const r = rng('orbital-live')
const ALL_DAYS = days()
const launches = []
const telemetry = []
const anomalies = []
const passes = []

for (const [key, , orbit, , , fleet, commissioned] of MISSIONS) {
  const o = ORBIT[orbit]
  const live = (d) => iso(d) >= commissioned
  // launch manifest: replenishment batches, a little busier in 2026
  for (const ms of monthStarts()) {
    if (!live(ms) && iso(addDays(ms, 31)) < commissioned) continue
    const n = poisson(r, (o.launchesPerYear / 12) * (fleet / 12 + 0.6) * 1.1 * (1 + monthIndex(ms) * 0.012))
    for (let i = 0; i < n; i++) {
      const date = addDays(ms, Math.floor(r() * daysInMonth(ms)))
      const vehicle = pick(r, VEHICLES[orbit])
      const outcome = pick(r, [['Nominal', 94], ['Partial', 4], ['Failure', 2]])
      const planned = o.sats[0] + Math.floor(r() * (o.sats[1] - o.sats[0] + 1))
      const deployed = outcome === 'Failure' ? 0 : outcome === 'Partial' ? Math.max(1, planned - 1 - Math.floor(r() * 2)) : planned
      const payload = planned * o.massKg * wobble(r, 0.08)
      launches.push([`L-${String(launches.length + 1).padStart(3, '0')}`, date, key, vehicle, VEHICLE_SITE[vehicle], planned, deployed, round(payload, 0), round(VEHICLE_COST[vehicle] * wobble(r, 0.06), 1), outcome])
    }
  }
  // daily telemetry and the anomaly log
  for (const d of ALL_DAYS) {
    if (!live(d)) continue
    const rate = (0.02 + fleet * 0.0012) * (1 - monthIndex(d) * 0.011) * (orbit === 'Polar' ? 1.25 : 1)
    let lost = 0
    for (let i = poisson(r, rate); i > 0; i--) {
      const severity = pick(r, SEVERITY)
      const [lo, hi] = RESOLVE[severity]
      const minutes = Math.round(lo + Math.pow(r(), 1.6) * (hi - lo))
      const resolved = iso(d) < '2026-10-17' || r() < 0.35
      anomalies.push([`A-${String(anomalies.length + 1).padStart(4, '0')}`, d, key, pick(r, SUBSYSTEMS), severity, resolved ? minutes : null, resolved])
      lost += (Math.min(minutes, 1440) / 1440) * IMPACT[severity] * 0.35
    }
    const eclipse = orbit === 'GEO' ? Math.max(0, Math.cos(((d.getUTCMonth() + 0.7) / 6) * Math.PI * 2)) * 0.05 : 0
    const uptime = clamp(o.uptime + normal(r) * 0.0016 - lost, 0.9, 1)
    const margin = clamp(0.27 - eclipse - (orbit === 'Polar' ? 0.03 * season(d, 0, 1) : 0) + normal(r) * 0.012 - monthIndex(d) * 0.0011, 0.05, 0.4)
    telemetry.push([d, key, round(uptime, 5), round(margin, 4)])
  }
}
// ids in date order
launches.sort((a, b) => a[1] - b[1] || a[2] - b[2]).forEach((row, i) => (row[0] = `L-${String(i + 1).padStart(3, '0')}`))
anomalies.sort((a, b) => a[1] - b[1] || a[2] - b[2]).forEach((row, i) => (row[0] = `A-${String(i + 1).padStart(4, '0')}`))
// ground contacts by station, mission and month
for (const [skey, , , antennas, vis] of STATIONS)
  for (const [mkey, , orbit, purpose, , fleet, commissioned] of MISSIONS) {
    if (!vis[orbit]) continue
    const o = ORBIT[orbit]
    for (const ms of monthStarts()) {
      if (iso(addDays(ms, daysInMonth(ms) - 1)) < commissioned) continue
      const n = Math.round(o.passesPerDay * vis[orbit] * Math.sqrt(fleet) * daysInMonth(ms) * Math.min(1, antennas / 4 + 0.3) * wobble(r, 0.07))
      const failed = poisson(r, n * (0.012 + (skey === 7 ? 0.02 * season(ms, 6, 1) : 0)))
      const tb = (n - failed) * o.tbPerPass * PURPOSE_DATA[purpose] * (1 + monthIndex(ms) * 0.025) * wobble(r, 0.05)
      passes.push([ms, skey, mkey, n, failed, round(tb, 2)])
    }
  }

const tables = [
  {
    name: 'dim_mission',
    group: 'Dimension',
    columns: [
      { name: 'mission_key', type: 'int64', hidden: true },
      { name: 'mission', type: 'string' },
      { name: 'orbit', type: 'string' },
      { name: 'purpose', type: 'string' },
      { name: 'bus', type: 'string' },
      { name: 'fleet_size', type: 'int64', summarize: 'sum' },
      { name: 'commissioned', type: 'date' },
      { name: 'status', type: 'string' }
    ],
    rows: MISSIONS.map(([k, n, o, p, b, s, cdate]) => [k, n, o, p, b, s, cdate, cdate >= '2025-01-01' ? 'Commissioning' : 'Operational'])
  },
  {
    name: 'dim_ground_station',
    group: 'Dimension',
    columns: [
      { name: 'station_key', type: 'int64', hidden: true },
      { name: 'station', type: 'string' },
      { name: 'region', type: 'string' },
      { name: 'antennas', type: 'int64' }
    ],
    rows: STATIONS.map(([k, n, rg, a]) => [k, n, rg, a])
  },
  {
    name: 'fact_launch',
    group: 'Fact',
    columns: [
      { name: 'launch_id', type: 'string' },
      { name: 'launch_date', type: 'date' },
      { name: 'mission_key', type: 'int64', hidden: true },
      { name: 'vehicle', type: 'string' },
      { name: 'launch_site', type: 'string' },
      { name: 'satellites_planned', type: 'int64' },
      { name: 'satellites_deployed', type: 'int64' },
      { name: 'payload_kg', type: 'double', format: '#,0' },
      { name: 'cost_musd', type: 'double', format: '\\$#,0.0"M"' },
      { name: 'outcome', type: 'string' }
    ],
    rows: launches
  },
  {
    name: 'fact_telemetry',
    group: 'Fact',
    columns: [
      { name: 'date', type: 'date' },
      { name: 'mission_key', type: 'int64', hidden: true },
      { name: 'uptime_pct', type: 'double', format: '0.00%', summarize: 'none' },
      { name: 'power_margin_pct', type: 'double', format: '0.0%', summarize: 'none' }
    ],
    rows: telemetry
  },
  {
    name: 'fact_anomaly',
    group: 'Fact',
    columns: [
      { name: 'anomaly_id', type: 'string' },
      { name: 'date', type: 'date' },
      { name: 'mission_key', type: 'int64', hidden: true },
      { name: 'subsystem', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'minutes_to_resolve', type: 'int64', format: '#,0' },
      { name: 'is_resolved', type: 'bool' }
    ],
    rows: anomalies
  },
  {
    name: 'fact_ground_pass',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'station_key', type: 'int64', hidden: true },
      { name: 'mission_key', type: 'int64', hidden: true },
      { name: 'passes', type: 'int64', format: '#,0' },
      { name: 'failed_passes', type: 'int64', format: '#,0' },
      { name: 'data_tb', type: 'double', format: '#,0.0' }
    ],
    rows: passes
  }
]

const relationships = [
  { from: 'fact_launch.launch_date', to: 'dim_calendar.date' },
  { from: 'fact_launch.mission_key', to: 'dim_mission.mission_key' },
  { from: 'fact_telemetry.date', to: 'dim_calendar.date' },
  { from: 'fact_telemetry.mission_key', to: 'dim_mission.mission_key' },
  { from: 'fact_anomaly.date', to: 'dim_calendar.date' },
  { from: 'fact_anomaly.mission_key', to: 'dim_mission.mission_key' },
  { from: 'fact_ground_pass.month_start', to: 'dim_calendar.date' },
  { from: 'fact_ground_pass.station_key', to: 'dim_ground_station.station_key' },
  { from: 'fact_ground_pass.mission_key', to: 'dim_mission.mission_key' }
]

// ---------------------------------------------------------------- measures
const KPI = [
  { folder: 'Launches', name: 'kpi_launches', dax: 'COUNTROWS(fact_launch)', format: '#,0' },
  {
    folder: 'Launches',
    name: 'kpi_launches_py',
    dax: `CALCULATE(
	[kpi_launches],
	SAMEPERIODLASTYEAR(dim_calendar[date])
)`,
    format: '#,0'
  },
  { folder: 'Launches', name: 'kpi_launches_yoy_pct', dax: 'DIVIDE([kpi_launches] - [kpi_launches_py], [kpi_launches_py])', format: '+0%;-0%;0%' },
  {
    folder: 'Launches',
    name: 'kpi_launch_success_pct',
    dax: `DIVIDE(
	CALCULATE(
		COUNTROWS(fact_launch),
		KEEPFILTERS(fact_launch[outcome] = "Nominal")
	),
	[kpi_launches]
)`,
    format: '0.0%'
  },
  { folder: 'Launches', name: 'kpi_satellites_deployed', dax: 'SUM(fact_launch[satellites_deployed])', format: '#,0' },
  { folder: 'Launches', name: 'kpi_payload_t', dax: 'DIVIDE(SUM(fact_launch[payload_kg]), 1000)', format: '#,0.0" t"' },
  { folder: 'Launches', name: 'kpi_launch_cost_musd', dax: 'SUM(fact_launch[cost_musd])', format: '\\$#,0.0"M"' },
  { folder: 'Launches', name: 'kpi_cost_per_kg', dax: 'DIVIDE(SUM(fact_launch[cost_musd]) * 1000000, SUM(fact_launch[payload_kg]))', format: '\\$#,0' },
  { folder: 'Fleet', name: 'kpi_active_missions', dax: 'DISTINCTCOUNT(fact_telemetry[mission_key])', format: '0' },
  { folder: 'Fleet', name: 'kpi_uptime_pct', dax: 'AVERAGE(fact_telemetry[uptime_pct])', format: '0.00%' },
  {
    folder: 'Fleet',
    name: 'kpi_uptime_py_pct',
    dax: `CALCULATE(
	[kpi_uptime_pct],
	SAMEPERIODLASTYEAR(dim_calendar[date])
)`,
    format: '0.00%'
  },
  { folder: 'Fleet', name: 'kpi_power_margin_pct', dax: 'AVERAGE(fact_telemetry[power_margin_pct])', format: '0.0%' },
  { folder: 'Fleet', name: 'kpi_satellite_days', dax: 'SUMX(fact_telemetry, RELATED(dim_mission[fleet_size]))', format: '#,0' },
  { folder: 'Anomalies', name: 'kpi_anomalies', dax: 'COUNTROWS(fact_anomaly)', format: '#,0' },
  {
    folder: 'Anomalies',
    name: 'kpi_anomalies_critical',
    dax: `CALCULATE(
	COUNTROWS(fact_anomaly),
	KEEPFILTERS(fact_anomaly[severity] = "Critical")
)`,
    format: '#,0'
  },
  {
    folder: 'Anomalies',
    name: 'kpi_anomalies_open',
    dax: `CALCULATE(
	COUNTROWS(fact_anomaly),
	KEEPFILTERS(fact_anomaly[is_resolved] = FALSE())
) + 0`,
    format: '#,0'
  },
  { folder: 'Anomalies', name: 'kpi_anomalies_per_1k_sat_days', dax: 'DIVIDE([kpi_anomalies] * 1000, [kpi_satellite_days])', format: '0.00' },
  { folder: 'Anomalies', name: 'kpi_mttr_hrs', dax: 'DIVIDE(AVERAGE(fact_anomaly[minutes_to_resolve]), 60)', format: '0.0" h"' },
  { folder: 'Ground', name: 'kpi_passes', dax: 'SUM(fact_ground_pass[passes])', format: '#,0' },
  { folder: 'Ground', name: 'kpi_pass_success_pct', dax: 'DIVIDE([kpi_passes] - SUM(fact_ground_pass[failed_passes]), [kpi_passes])', format: '0.00%' },
  { folder: 'Ground', name: 'kpi_data_tb', dax: 'SUM(fact_ground_pass[data_tb])', format: '#,0" TB"' },
  {
    folder: 'Ground',
    name: 'kpi_data_py_tb',
    dax: `CALCULATE(
	[kpi_data_tb],
	SAMEPERIODLASTYEAR(dim_calendar[date])
)`,
    format: '#,0" TB"'
  },
  { folder: 'Ground', name: 'kpi_data_yoy_pct', dax: 'DIVIDE([kpi_data_tb] - [kpi_data_py_tb], [kpi_data_py_tb])', format: '+0%;-0%;0%' }
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
    name: 'fmt_launch_note',
    dax: `FORMAT([kpi_launches_yoy_pct], "+0%;-0%;0%") & " vs last year  ·  " & FORMAT([kpi_launch_success_pct], "0%") & " nominal"`
  },
  { name: 'fmt_payload_note', dax: 'FORMAT([kpi_satellites_deployed], "#,0") & " satellites  ·  " & FORMAT([kpi_cost_per_kg], "$#,0") & " per kg"' },
  { name: 'fmt_data_note', dax: 'FORMAT([kpi_data_yoy_pct], "+0%;-0%;0%") & " vs last year  ·  " & FORMAT([kpi_passes], "#,0") & " passes"' },
  {
    name: 'fmt_uptime_note',
    dax: `VAR _delta = ([kpi_uptime_pct] - [kpi_uptime_py_pct]) * 100
RETURN
	FORMAT(_delta, "+0.00;-0.00;0.00") & " pts vs last year  ·  " & [kpi_anomalies] & " anomalies"`
  },
  { name: 'fmt_margin_note', dax: '"lowest mission: " & FORMAT(MINX(VALUES(dim_mission[mission]), [kpi_power_margin_pct]), "0.0%")' },
  { name: 'fmt_anomaly_note', dax: '[kpi_anomalies_critical] & " critical  ·  " & [kpi_anomalies_open] & " still open"' },
  { name: 'fmt_mttr_note', dax: 'FORMAT([kpi_anomalies_per_1k_sat_days], "0.00") & " per 1,000 satellite-days"' },
  { name: 'fmt_fleet_note', dax: 'FORMAT(SUM(dim_mission[fleet_size]), "#,0") & " satellites in orbit"' },
  { name: 'fmt_success_note', dax: 'FORMAT([kpi_launches] - CALCULATE(COUNTROWS(fact_launch), KEEPFILTERS(fact_launch[outcome] = "Nominal")), "0") & " partial or failed"' },
  { name: 'fmt_cost_note', dax: 'FORMAT([kpi_launch_cost_musd], "$#,0") & "M across " & [kpi_launches] & " launches"' },
  { name: 'fmt_pass_note', dax: 'FORMAT([kpi_pass_success_pct], "0.0%") & " completed"' },
  {
    name: 'fmt_uptime_color',
    dax: `SWITCH(
	TRUE(),
	[kpi_uptime_pct] < 0.99, "${T.magenta}",
	[kpi_uptime_pct] < 0.995, "${T.amber}",
	"${T.good}"
)`
  }
]

// ---------------------------------------------------------------- layout
const M = (p) => col('dim_mission', p)
const ORBIT_COLORS = { LEO: T.cyan, MEO: T.violet, GEO: T.magenta, Polar: T.amber }
const REGION_COLORS = { Americas: T.cyan, Europe: T.violet, 'Asia Pacific': T.magenta, Africa: T.amber, Polar: T.good }
const SEVERITY_COLORS = { Minor: T.cyan, Major: T.amber, Critical: T.magenta }
const OUTCOME_COLORS = { Nominal: T.cyan, Partial: T.amber, Failure: T.magenta }
const head = (text) => ({ show: true, text, fontFamily: 'Barlow Semibold', fontSize: 11, fontColor: c(T.ink) })
const sub = (text) => ({ show: true, text, fontFamily: 'Roboto Condensed', fontSize: 8, fontColor: c(T.muted) })

/** A visual inside its own frosted panel, titled. */
function framed(spec, title, subtitle, accent) {
  const g = glass({ glow: accent ?? T.cyan })
  return { ...spec, style: g.style, box: { ...g.box, title: head(title), ...(subtitle ? { subTitle: sub(subtitle) } : {}) } }
}

function header(k, page, kicker) {
  return [
    k.img({ name: 'logo', x: 36, y: 20, w: 52, h: 52, src: 'orbital-logo.svg' }),
    k.text({ name: 'title', x: 96, y: 18, w: 520, h: 38, runs: [{ text: 'ORBITAL', font: 'Barlow Black', size: 24, color: T.ink }, { text: `  ${page}`, font: 'Barlow', size: 15, color: T.muted }] }),
    k.text({ name: 'kicker', x: 98, y: 54, w: 420, h: 20, runs: [{ text: kicker, font: 'Roboto Condensed', size: 8.5, color: T.cyan }] }),
    k.card({ name: 'period', x: 520, y: 50, w: 220, h: 26, field: fmt('fmt_period'), size: 8.5, font: 'Roboto Condensed', color: T.muted, align: 'right' }),
    k.slicer({ name: 'orbit', x: 760, y: 26, w: 330, h: 44, field: M('orbit'), mode: 'Basic', horizontal: true, header: false, color: T.ink, itemBg: '#11163A', outline: 'Frame', outlineColor: '#3A4590', font: 'Roboto Condensed', size: 9, syncGroup: 'orbit' }),
    yearSlicer(k, { x: 1104, y: 30, w: 136, h: 36, color: T.ink, itemBg: '#11163A', outline: 'Frame', outlineColor: '#3A4590', font: 'Roboto Condensed', size: 10 })
  ]
}

/** KPI strip panel: label, value, note. */
function stat(k, name, x, y, w, label, value, note, accent) {
  const g = glass({ glow: accent })
  return [
    k.shape({ name: `${name}-panel`, x, y, w, h: 96, shape: 'rectangle', ...g, box: { ...g.box, padding: 0 } }),
    k.shape({ name: `${name}-bar`, x: x + 14, y: y + 16, w: 3, h: 64, fill: accent, shape: 'rectangle' }),
    k.text({ name: `${name}-l`, x: x + 26, y: y + 12, w: w - 40, h: 20, runs: [{ text: label, font: 'Roboto Condensed', size: 8.5, color: T.muted }] }),
    k.card({ name: `${name}-v`, x: x + 22, y: y + 28, w: w - 34, h: 40, field: kpi(value), size: 22, font: 'Barlow Semibold', color: T.ink }),
    k.card({ name: `${name}-n`, x: x + 22, y: y + 66, w: w - 30, h: 24, field: fmt(note), size: 8, font: 'Barlow', color: accent })
  ]
}

const CX = 640, CY = 338

function missionControl(seed) {
  const k = kit(seed, T)
  const g = glass()
  const panel = (name, x, y, w, h, accent) => k.shape({ name, x, y, w, h, shape: 'rectangle', ...glass({ glow: accent }), box: { ...g.box, padding: 0 } })
  const title = (name, x, y, w, text, subtext) => [
    k.text({ name: `${name}-t`, x, y, w, h: 22, runs: [{ text, font: 'Barlow Semibold', size: 11, color: T.ink }] }),
    k.text({ name: `${name}-s`, x, y: y + 20, w, h: 18, runs: [{ text: subtext, font: 'Roboto Condensed', size: 8, color: T.muted }] })
  ]
  const bigStat = (name, x, y, label, value, note, accent) => [
    panel(`${name}-panel`, x, y, 320, 104, accent),
    k.shape({ name: `${name}-bar`, x: x + 16, y: y + 18, w: 4, h: 68, fill: accent, shape: 'rectangle' }),
    k.text({ name: `${name}-l`, x: x + 32, y: y + 14, w: 270, h: 20, runs: [{ text: label, font: 'Roboto Condensed', size: 9, color: T.muted }] }),
    k.card({ name: `${name}-v`, x: x + 28, y: y + 30, w: 280, h: 44, field: kpi(value), size: 28, font: 'Barlow Semibold', color: T.ink }),
    k.card({ name: `${name}-n`, x: x + 28, y: y + 72, w: 280, h: 26, field: fmt(note), size: 9, font: 'Barlow', color: accent })
  ]
  return [
    ...header(k, 'mission control', 'CONSTELLATION TELEMETRY  //  ORBIT SUMMARY'),
    ...bigStat('k1', 40, 112, 'LAUNCHES', 'kpi_launches', 'fmt_launch_note', T.cyan),
    ...bigStat('k2', 40, 232, 'PAYLOAD TO ORBIT', 'kpi_payload_t', 'fmt_payload_note', T.violet),
    ...bigStat('k3', 40, 352, 'DATA DOWNLINKED', 'kpi_data_tb', 'fmt_data_note', T.magenta),
    panel('anom-panel', 40, 472, 320, 220),
    ...title('anom', 58, 484, 280, 'Anomalies by mission', 'EVENTS LOGGED IN THE PERIOD'),
    k.column({ name: 'anom-chart', x: 50, y: 526, w: 300, h: 160, cat: M('mission'), val: [as(kpi('kpi_anomalies'), 'Anomalies')], colors: [T.magenta], labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_anomalies') }, axisColor: T.muted, axisSize: 7 }),

    k.donut({ name: 'ring', x: CX - 214, y: CY - 214, w: 428, h: 428, cat: M('orbit'), val: as(kpi('kpi_payload_t'), 'Payload'), innerRadius: 90, labels: false, colorMap: ORBIT_COLORS }),
    k.text({ name: 'ring-k', x: CX - 150, y: CY - 92, w: 300, h: 20, align: 'center', runs: [{ text: 'CONSTELLATION UPTIME', font: 'Roboto Condensed', size: 9, color: T.cyan }] }),
    k.card({ name: 'ring-v', x: CX - 160, y: CY - 70, w: 320, h: 92, field: kpi('kpi_uptime_pct'), size: 54, font: 'Barlow Semibold', color: T.ink, align: 'center' }),
    k.card({ name: 'ring-n', x: CX - 170, y: CY + 22, w: 340, h: 22, field: fmt('fmt_uptime_note'), size: 9, font: 'Barlow', color: T.muted, align: 'center' }),
    k.text({
      name: 'ring-legend',
      x: CX - 150,
      y: CY + 56,
      w: 300,
      h: 20,
      align: 'center',
      runs: [
        { text: '● LEO   ', font: 'Roboto Condensed', size: 8.5, color: T.cyan },
        { text: '● MEO   ', font: 'Roboto Condensed', size: 8.5, color: T.violet },
        { text: '● GEO   ', font: 'Roboto Condensed', size: 8.5, color: T.magenta },
        { text: '● POLAR', font: 'Roboto Condensed', size: 8.5, color: T.amber }
      ]
    }),
    k.text({ name: 'ring-cap', x: CX - 150, y: CY + 76, w: 300, h: 18, align: 'center', runs: [{ text: 'RING: PAYLOAD TO ORBIT BY ORBIT CLASS', font: 'Roboto Condensed', size: 7.5, color: T.muted }] }),
    k.img({ name: 'satellite', x: 790, y: 92, w: 170, h: 93, src: 'orbital-satellite.svg' }),

    panel('trend-panel', 384, 592, 512, 100),
    ...title('trend', 400, 600, 200, 'Data downlink', 'TB PER MONTH'),
    k.line({ name: 'trend-chart', x: 520, y: 598, w: 368, h: 92, area: true, cat: cal('month_abbr'), val: [as(kpi('kpi_data_tb'), 'Data downlinked')], colors: [T.cyan], yAxis: false, grid: false, smooth: true, axisSize: 7, objects: { lineStyles: { strokeWidth: 2, areaTransparency: 70 } } }),

    panel('roster-panel', 920, 112, 320, 344),
    ...title('roster', 938, 124, 280, 'Mission roster', 'LAUNCHES, UPTIME AND PAYLOAD BY MISSION'),
    uptimeColor(growToFit(k.table({
      name: 'roster-table',
      x: 932,
      y: 168,
      w: 296,
      h: 280,
      fields: [as(M('mission'), 'Mission'), as(M('orbit'), 'Orbit'), as(kpi('kpi_launches'), 'Launches'), as(kpi('kpi_uptime_pct'), 'Uptime'), as(kpi('kpi_payload_t'), 'Payload')],
      headBg: '#00000000',
      rowBg: '#00000000',
      color: T.ink,
      headColor: T.cyan,
      font: 'Barlow',
      headFont: 'Roboto Condensed',
      lineColor: '#2A3160',
      size: 9,
      rowPadding: 5,
      sort: { field: kpi('kpi_launches') }
    }))),
    panel('launch-panel', 920, 472, 320, 220, T.violet),
    ...title('launch', 938, 484, 280, 'Launch cadence', 'LAUNCHES PER MONTH BY ORBIT'),
    k.column({ name: 'launch-chart', x: 930, y: 526, w: 300, h: 160, stacked: true, cat: cal('month_abbr'), val: [as(kpi('kpi_launches'), 'Launches')], series: M('orbit'), colorMap: ORBIT_COLORS, yAxis: false, grid: false, axisSize: 7 })
  ]
}

const uptimeColor = (v) => columnColor(v, '_measures_kpi.kpi_uptime_pct', 'fmt_uptime_color')

function fleetHealth(seed) {
  const k = kit(seed, T)
  const w = 228, gap = 15, xs = [0, 1, 2, 3, 4].map((i) => 40 + i * (w + gap))
  return [
    ...header(k, 'fleet health', 'TELEMETRY  //  ANOMALIES AND RECOVERY'),
    ...stat(k, 's1', xs[0], 104, w, 'UPTIME', 'kpi_uptime_pct', 'fmt_uptime_note', T.cyan),
    ...stat(k, 's2', xs[1], 104, w, 'POWER MARGIN', 'kpi_power_margin_pct', 'fmt_margin_note', T.violet),
    ...stat(k, 's3', xs[2], 104, w, 'ANOMALIES', 'kpi_anomalies', 'fmt_anomaly_note', T.magenta),
    ...stat(k, 's4', xs[3], 104, w, 'MEAN TIME TO RESOLVE', 'kpi_mttr_hrs', 'fmt_mttr_note', T.amber),
    ...stat(k, 's5', xs[4], 104, w, 'ACTIVE MISSIONS', 'kpi_active_missions', 'fmt_fleet_note', T.good),
    k.line(framed({ name: 'uptime-trend', x: 40, y: 216, w: 600, h: 236, cat: cal('month_abbr'), val: [as(kpi('kpi_uptime_pct'), 'Uptime')], series: M('orbit'), colorMap: ORBIT_COLORS, legend: 'TopRight', smooth: true, markers: true, grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Uptime by orbit', 'DAILY AVERAGE, BY MONTH')),
    k.column(framed({ name: 'subsystems', x: 656, y: 216, w: 584, h: 236, horizontal: true, stacked: true, cat: col('fact_anomaly', 'subsystem'), val: [as(kpi('kpi_anomalies'), 'Anomalies')], series: col('fact_anomaly', 'severity'), colorMap: SEVERITY_COLORS, legend: 'TopRight', yAxis: false, grid: false, sort: { field: kpi('kpi_anomalies') }, axisSize: 8, objects: { legend: legend(T) } }, 'Anomalies by subsystem', 'STACKED BY SEVERITY', T.magenta)),
    uptimeColor(growToFit(k.table(
      framed(
        {
          name: 'health-table',
          x: 40,
          y: 468,
          w: 780,
          h: 224,
          fields: [as(M('mission'), 'Mission'), as(M('orbit'), 'Orbit'), as(M('purpose'), 'Purpose'), as(kpi('kpi_uptime_pct'), 'Uptime'), as(kpi('kpi_power_margin_pct'), 'Power margin'), as(kpi('kpi_anomalies'), 'Anomalies'), as(kpi('kpi_anomalies_critical'), 'Critical'), as(kpi('kpi_mttr_hrs'), 'MTTR')],
          headBg: '#00000000',
          rowBg: '#00000000',
          color: T.ink,
          headColor: T.cyan,
          font: 'Barlow',
          headFont: 'Roboto Condensed',
          lineColor: '#2A3160',
          size: 9,
          rowPadding: 4,
          totals: true,
          sort: { field: kpi('kpi_anomalies') }
        },
        'Mission health',
        'UPTIME UNDER 99.5% IN AMBER, UNDER 99% IN MAGENTA'
      )
    ))),
    k.column(framed({ name: 'mttr', x: 836, y: 468, w: 404, h: 224, cat: col('fact_anomaly', 'severity'), val: [as(kpi('kpi_mttr_hrs'), 'Hours to resolve')], colorMap: SEVERITY_COLORS, labels: true, yAxis: false, grid: false, axisSize: 8 }, 'Time to resolve', 'MEAN HOURS BY SEVERITY', T.amber))
  ]
}

function launchesGround(seed) {
  const k = kit(seed, T)
  const w = 228, gap = 15, xs = [0, 1, 2, 3, 4].map((i) => 40 + i * (w + gap))
  const L = (p) => col('fact_launch', p)
  return [
    ...header(k, 'launches & ground', 'LAUNCH MANIFEST  //  GROUND NETWORK'),
    ...stat(k, 's1', xs[0], 104, w, 'LAUNCH SUCCESS', 'kpi_launch_success_pct', 'fmt_success_note', T.cyan),
    ...stat(k, 's2', xs[1], 104, w, 'SATELLITES DEPLOYED', 'kpi_satellites_deployed', 'fmt_launch_note', T.violet),
    ...stat(k, 's3', xs[2], 104, w, 'COST PER KG', 'kpi_cost_per_kg', 'fmt_cost_note', T.amber),
    ...stat(k, 's4', xs[3], 104, w, 'GROUND PASSES', 'kpi_passes', 'fmt_pass_note', T.magenta),
    ...stat(k, 's5', xs[4], 104, w, 'DATA DOWNLINKED', 'kpi_data_tb', 'fmt_data_note', T.good),
    k.combo(framed({ name: 'payload', x: 40, y: 216, w: 600, h: 236, cat: cal('month_abbr'), columns: [as(kpi('kpi_payload_t'), 'Payload')], lines: [as(kpi('kpi_cost_per_kg'), 'Cost per kg')], colors: [T.violet, T.amber], legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Payload and cost per kg', 'TONNES TO ORBIT  ·  LAUNCH COST PER KG')),
    k.column(framed({ name: 'stations', x: 656, y: 216, w: 300, h: 236, horizontal: true, cat: col('dim_ground_station', 'station'), val: [as(kpi('kpi_data_tb'), 'Data')], colors: [T.cyan], labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_data_tb') }, axisSize: 8 }, 'Data by ground station', 'TB DOWNLINKED', T.cyan)),
    k.donut(framed({ name: 'regions', x: 972, y: 216, w: 268, h: 236, cat: col('dim_ground_station', 'region'), val: as(kpi('kpi_passes'), 'Passes'), innerRadius: 60, labelStyle: 'Category, percent of total', labelColor: T.ink, colorMap: REGION_COLORS }, 'Passes by region', 'SHARE OF GROUND CONTACTS', T.magenta)),
    growToFit(k.table(
      framed(
        {
          name: 'manifest',
          x: 40,
          y: 468,
          w: 1200,
          h: 224,
          fields: [as(L('launch_id'), 'Launch'), as(L('launch_date'), 'Date'), as(M('mission'), 'Mission'), as(M('orbit'), 'Orbit'), as(L('vehicle'), 'Vehicle'), as(L('launch_site'), 'Site'), as(kpi('kpi_satellites_deployed'), 'Satellites'), as(kpi('kpi_payload_t'), 'Payload'), as(kpi('kpi_launch_cost_musd'), 'Cost'), as(L('outcome'), 'Outcome')],
          headBg: '#00000000',
          rowBg: '#00000000',
          color: T.ink,
          headColor: T.cyan,
          font: 'Barlow',
          headFont: 'Roboto Condensed',
          lineColor: '#2A3160',
          size: 9,
          rowPadding: 4,
          sort: { field: L('launch_date') }
        },
        'Launch manifest',
        'LATEST FIRST'
      )
    ))
  ]
}

export default {
  id: 'orbital',
  name: 'Orbital',
  theme: themeOf(T),
  calendar: { start: START, end: END },
  tables,
  relationships,
  measures: { kpi: KPI, format: FMT },
  resources: { 'orbital-bg.svg': template.resources['orbital-bg.svg'], 'orbital-bg-plain.svg': backdrop({ hud: false }), 'orbital-logo.svg': logo, 'orbital-satellite.svg': satellite },
  pages: [
    { name: 'Mission Control', background: { color: T.bg, image: 'orbital-bg.svg' }, wallpaper: '#03040C', visuals: missionControl },
    { name: 'Fleet Health', background: { color: T.bg, image: 'orbital-bg-plain.svg' }, wallpaper: '#03040C', visuals: fleetHealth },
    { name: 'Launches & Ground', background: { color: T.bg, image: 'orbital-bg-plain.svg' }, wallpaper: '#03040C', visuals: launchesGround }
  ]
}

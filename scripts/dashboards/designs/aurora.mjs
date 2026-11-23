/**
 * Aurora, live: streaming analytics for a fictional dream-pop artist. Eleven tracks across an album, an EP and two
 * singles, monthly streams by country and discovery source, and the monthly audience by country and age, January
 * 2025 to October 2026. Pages: Creator Pulse (the gallery template's layout), Tracks & Releases, Audience.
 */
import { kit, themeOf } from '../../templates/kit.mjs'
import { as, c, col } from '../../templates/lib.mjs'
import { T, bg, glass, orb, wave } from '../../templates/designs/aurora.mjs'
import { iso, monthIndex, monthStarts, rng, round, wobble, START, END } from '../data.mjs'
import { cal, fmt, growToFit, kpi, legend, yearSlicer } from '../kit.mjs'

// ---------------------------------------------------------------- data
const RELEASES = [
  // release, type, release date, color
  ['Northern Lights', 'Album', '2024-10-04', T.violet],
  ['Halo Season', 'EP', '2025-09-12', T.pink],
  ['Prism', 'Single', '2026-04-17', T.aqua],
  ['Blue Hour', 'Single', '2026-08-28', T.peach]
]
const TRACKS = [
  // key, track, release, track no, duration (s), pull
  [1, 'Northern Lights', 'Northern Lights', 1, 224, 1.4],
  [2, 'Glasshouse', 'Northern Lights', 2, 198, 1.15],
  [3, 'Paper Moons', 'Northern Lights', 3, 241, 0.7],
  [4, 'Soft Static', 'Northern Lights', 4, 207, 0.85],
  [5, 'Tidal', 'Northern Lights', 5, 262, 0.45],
  [6, 'Afterglow', 'Northern Lights', 6, 233, 0.6],
  [7, 'Halo Season', 'Halo Season', 1, 213, 1.3],
  [8, 'Satellite Heart', 'Halo Season', 2, 189, 1.05],
  [9, 'Lowlight', 'Halo Season', 3, 255, 0.55],
  [10, 'Prism', 'Prism', 1, 201, 1.5],
  [11, 'Blue Hour', 'Blue Hour', 1, 219, 1.2]
]
const COUNTRIES = [
  // key, country, region, audience share, payout per stream (USD), age skew (younger > 1)
  [1, 'United States', 'NA', 0.27, 0.0042, 1],
  [2, 'Canada', 'NA', 0.05, 0.0038, 1],
  [3, 'Mexico', 'LATAM', 0.08, 0.0012, 1.25],
  [4, 'Brazil', 'LATAM', 0.09, 0.0011, 1.3],
  [5, 'Argentina', 'LATAM', 0.03, 0.0007, 1.2],
  [6, 'United Kingdom', 'EU', 0.1, 0.004, 0.95],
  [7, 'Germany', 'EU', 0.08, 0.0039, 0.9],
  [8, 'France', 'EU', 0.05, 0.0035, 0.95],
  [9, 'Sweden', 'EU', 0.04, 0.0041, 1],
  [10, 'Japan', 'APAC', 0.09, 0.0037, 0.85],
  [11, 'Australia', 'APAC', 0.06, 0.004, 1],
  [12, 'Indonesia', 'APAC', 0.06, 0.0006, 1.35]
]
const SOURCES = ['Editorial playlists', 'Algorithmic', 'Search', 'Artist profile', 'Library']
const AGES = [['18-24', 0.34], ['25-34', 0.38], ['35-44', 0.18], ['45+', 0.1]]

const releaseOf = Object.fromEntries(RELEASES.map((r) => [r[0], r]))
const r = rng('aurora-live')
const streams = []
const audience = []
const MONTHS = monthStarts()
// how the artist's reach grows: a steady climb, a lift from each release
const reach = (ms) => 1 + monthIndex(ms) * 0.035

for (const ms of MONTHS) {
  for (const [tk, , rel, , duration, pull] of TRACKS) {
    const [, type, released] = releaseOf[rel]
    if (iso(ms) < released.slice(0, 7) + '-01') continue
    const age = monthIndex(ms) - ((Number(released.slice(0, 4)) - 2025) * 12 + Number(released.slice(5, 7)) - 1)
    const launch = released.slice(0, 7) === iso(ms).slice(0, 7) ? 1 - Number(released.slice(8, 10)) / 31 : 1
    // a release spikes, then settles into a long tail; album tracks are older catalog by 2025
    const curve = (0.55 + 1.9 * Math.exp(-Math.max(0, age) / 3.2)) * launch * (type === 'Single' ? 1.15 : 1)
    const base = 210000 * pull * curve * reach(ms) * wobble(r, 0.06)
    const editorial = 0.08 + 0.3 * Math.exp(-Math.max(0, age) / 2.5)
    const mix = { 'Editorial playlists': editorial, Algorithmic: 0.32, Search: 0.09, 'Artist profile': 0.13, Library: 0.12 + Math.min(0.2, age * 0.012) }
    const total = Object.values(mix).reduce((a, b) => a + b, 0)
    for (const [ck, , , share, payout] of COUNTRIES)
      for (const src of SOURCES) {
        const n = Math.round(base * share * (mix[src] / total) * wobble(r, 0.12))
        if (n <= 0) continue
        const skipBase = src === 'Algorithmic' ? 0.31 : src === 'Editorial playlists' ? 0.27 : src === 'Library' ? 0.09 : 0.14
        const skips = Math.round(n * skipBase * (duration > 240 ? 1.15 : 1) * wobble(r, 0.1))
        const saveBase = src === 'Search' || src === 'Artist profile' ? 0.085 : src === 'Library' ? 0.01 : 0.045
        const saves = Math.round(n * saveBase * pull ** 0.3 * wobble(r, 0.15))
        const listeners = Math.round(n / (src === 'Library' ? 3.4 : 1.9 + r() * 0.4))
        streams.push([ms, tk, ck, src, n, listeners, saves, skips, round(n * payout * wobble(r, 0.03), 2)])
      }
  }
  for (const [ck, , , share, , young] of COUNTRIES) {
    const monthly = 1.35e6 * share * reach(ms) * wobble(r, 0.04)
    for (const [band, w] of AGES) {
      const tilt = band === '18-24' ? young : band === '45+' ? 2 - young : 1
      const listeners = Math.round(monthly * w * tilt * wobble(r, 0.05))
      const gained = Math.round(listeners * 0.012 * reach(ms) * wobble(r, 0.25))
      const lost = Math.round(listeners * 0.0035 * wobble(r, 0.3))
      audience.push([ms, ck, band, listeners, gained, lost])
    }
  }
}

const tables = [
  {
    name: 'dim_track',
    group: 'Dimension',
    columns: [
      { name: 'track_key', type: 'int64', hidden: true },
      { name: 'track', type: 'string' },
      { name: 'release', type: 'string' },
      { name: 'release_type', type: 'string' },
      { name: 'release_date', type: 'date' },
      { name: 'track_number', type: 'int64', summarize: 'none' },
      { name: 'duration_sec', type: 'int64', summarize: 'none' }
    ],
    rows: TRACKS.map(([k, t, rel, no, dur]) => [k, t, rel, releaseOf[rel][1], releaseOf[rel][2], no, dur])
  },
  {
    name: 'dim_country',
    group: 'Dimension',
    columns: [
      { name: 'country_key', type: 'int64', hidden: true },
      { name: 'country', type: 'string', category: 'Country' },
      { name: 'region', type: 'string' }
    ],
    rows: COUNTRIES.map(([k, n, rg]) => [k, n, rg])
  },
  {
    name: 'fact_stream',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'track_key', type: 'int64', hidden: true },
      { name: 'country_key', type: 'int64', hidden: true },
      { name: 'source', type: 'string' },
      { name: 'streams', type: 'int64', format: '#,0' },
      { name: 'listeners', type: 'int64', format: '#,0', summarize: 'none' },
      { name: 'saves', type: 'int64', format: '#,0' },
      { name: 'skips', type: 'int64', format: '#,0' },
      { name: 'revenue_usd', type: 'currency', format: '\\$#,0.00' }
    ],
    rows: streams
  },
  {
    name: 'fact_audience',
    group: 'Fact',
    columns: [
      { name: 'month_start', type: 'date' },
      { name: 'country_key', type: 'int64', hidden: true },
      { name: 'age_band', type: 'string' },
      { name: 'monthly_listeners', type: 'int64', format: '#,0', summarize: 'none' },
      { name: 'followers_gained', type: 'int64', format: '#,0' },
      { name: 'followers_lost', type: 'int64', format: '#,0' }
    ],
    rows: audience
  }
]

const relationships = [
  { from: 'fact_stream.month_start', to: 'dim_calendar.date' },
  { from: 'fact_stream.track_key', to: 'dim_track.track_key' },
  { from: 'fact_stream.country_key', to: 'dim_country.country_key' },
  { from: 'fact_audience.month_start', to: 'dim_calendar.date' },
  { from: 'fact_audience.country_key', to: 'dim_country.country_key' }
]

// ---------------------------------------------------------------- measures
const KPI = [
  { folder: 'Streams', name: 'kpi_streams', dax: 'SUM(fact_stream[streams])', format: '#,0' },
  {
    folder: 'Streams',
    name: 'kpi_streams_py',
    dax: `CALCULATE(
	[kpi_streams],
	SAMEPERIODLASTYEAR(dim_calendar[date])
)`,
    format: '#,0'
  },
  { folder: 'Streams', name: 'kpi_streams_yoy_pct', dax: 'DIVIDE([kpi_streams] - [kpi_streams_py], [kpi_streams_py])', format: '+0.0%;-0.0%;0.0%' },
  {
    folder: 'Streams',
    name: 'kpi_streams_last_month',
    dax: `VAR _last = MAX(fact_stream[month_start])
RETURN
	CALCULATE(
		[kpi_streams],
		fact_stream[month_start] = _last
	)`,
    format: '#,0'
  },
  {
    folder: 'Streams',
    name: 'kpi_streams_mom_pct',
    dax: `VAR _last = MAX(fact_stream[month_start])
VAR _prior = EDATE(_last, -1)
VAR _now =
	CALCULATE(
		[kpi_streams],
		fact_stream[month_start] = _last
	)
VAR _before =
	CALCULATE(
		[kpi_streams],
		REMOVEFILTERS(dim_calendar),
		fact_stream[month_start] = _prior
	)
RETURN
	DIVIDE(_now - _before, _before)`,
    format: '+0.0%;-0.0%;0.0%'
  },
  { folder: 'Streams', name: 'kpi_stream_listeners', dax: 'SUM(fact_stream[listeners])', format: '#,0' },
  { folder: 'Streams', name: 'kpi_saves', dax: 'SUM(fact_stream[saves])', format: '#,0' },
  { folder: 'Streams', name: 'kpi_save_rate_pct', dax: 'DIVIDE([kpi_saves], [kpi_streams])', format: '0.00%' },
  { folder: 'Streams', name: 'kpi_skip_rate_pct', dax: 'DIVIDE(SUM(fact_stream[skips]), [kpi_streams])', format: '0.0%' },
  { folder: 'Streams', name: 'kpi_streams_per_listener', dax: 'DIVIDE([kpi_streams], [kpi_stream_listeners])', format: '0.00' },
  {
    folder: 'Streams',
    name: 'kpi_discovery_share_pct',
    dax: `DIVIDE(
	CALCULATE(
		[kpi_streams],
		KEEPFILTERS(fact_stream[source] IN {"Editorial playlists", "Algorithmic", "Search"})
	),
	[kpi_streams]
)`,
    format: '0%'
  },
  { folder: 'Revenue', name: 'kpi_revenue', dax: 'SUM(fact_stream[revenue_usd])', format: '\\$#,0' },
  { folder: 'Revenue', name: 'kpi_revenue_per_1k_streams', dax: 'DIVIDE([kpi_revenue] * 1000, [kpi_streams])', format: '\\$#,0.00' },
  {
    folder: 'Revenue',
    name: 'kpi_revenue_py',
    dax: `CALCULATE(
	[kpi_revenue],
	SAMEPERIODLASTYEAR(dim_calendar[date])
)`,
    format: '\\$#,0'
  },
  {
    folder: 'Audience',
    name: 'kpi_monthly_listeners',
    dax: `VAR _last = MAX(fact_audience[month_start])
RETURN
	CALCULATE(
		SUM(fact_audience[monthly_listeners]),
		fact_audience[month_start] = _last
	)`,
    format: '#,0'
  },
  {
    folder: 'Audience',
    name: 'kpi_monthly_listeners_avg',
    dax: `AVERAGEX(
	VALUES(fact_audience[month_start]),
	CALCULATE(SUM(fact_audience[monthly_listeners]))
)`,
    format: '#,0'
  },
  { folder: 'Audience', name: 'kpi_followers_gained', dax: 'SUM(fact_audience[followers_gained])', format: '#,0' },
  { folder: 'Audience', name: 'kpi_followers_lost', dax: 'SUM(fact_audience[followers_lost])', format: '#,0' },
  { folder: 'Audience', name: 'kpi_followers_net', dax: '[kpi_followers_gained] - [kpi_followers_lost]', format: '+#,0;-#,0;0' },
  { folder: 'Audience', name: 'kpi_countries', dax: 'DISTINCTCOUNT(fact_stream[country_key])', format: '0' }
]

const FMT = [
  {
    name: 'fmt_period',
    dax: `VAR _first = MIN(dim_calendar[date])
VAR _last = MAX(dim_calendar[date])
RETURN
	FORMAT(_first, "mmm") & " – " & FORMAT(_last, "mmm yyyy")`
  },
  { name: 'fmt_streams_note', dax: 'FORMAT([kpi_streams_yoy_pct], "+0%;-0%;0%") & " vs last year  ·  " & FORMAT([kpi_streams_mom_pct], "+0%;-0%;0%") & " last month"' },
  { name: 'fmt_listeners_note', dax: '"in " & FORMAT(MAX(fact_audience[month_start]), "mmmm")' },
  { name: 'fmt_saves_note', dax: 'FORMAT([kpi_save_rate_pct], "0.0%") & " of streams saved"' },
  { name: 'fmt_followers_note', dax: 'FORMAT([kpi_followers_net], "+#,0;-#,0") & " net"' },
  { name: 'fmt_skip_note', dax: 'FORMAT([kpi_streams_per_listener], "0.0") & " streams per listener"' },
  { name: 'fmt_revenue_note', dax: 'FORMAT([kpi_revenue_per_1k_streams], "$0.00") & " per 1,000 streams"' },
  { name: 'fmt_discovery_note', dax: '"playlists, algorithm and search"' },
  { name: 'fmt_churn_note', dax: 'FORMAT(DIVIDE([kpi_followers_lost], [kpi_followers_gained]), "0%") & " of new follows"' },
  {
    name: 'fmt_top_track',
    dax: `VAR _top =
	TOPN(
		1,
		VALUES(dim_track[track]),
		[kpi_streams]
	)
RETURN
	"top track: " & MAXX(_top, dim_track[track])`
  },
  {
    name: 'fmt_top_country',
    dax: `VAR _top =
	TOPN(
		1,
		VALUES(dim_country[country]),
		[kpi_streams]
	)
RETURN
	"most streams: " & MAXX(_top, dim_country[country])`
  }
]

// ---------------------------------------------------------------- layout
const D = (p) => col('dim_track', p)
const C = (p) => col('dim_country', p)
const RELEASE_COLORS = Object.fromEntries(RELEASES.map(([n, , , color]) => [n, color]))
const TRACK_COLORS = Object.fromEntries(TRACKS.map(([, t, rel]) => [t, releaseOf[rel][3]]))
const REGION_COLORS = { NA: T.violet, EU: T.aqua, LATAM: T.pink, APAC: T.peach }
const SOURCE_COLORS = { 'Editorial playlists': T.violet, Algorithmic: T.sky, Search: T.aqua, 'Artist profile': T.pink, Library: T.peach }
const head = (text) => ({ show: true, text, fontFamily: 'Barlow Semibold', fontSize: 12, fontColor: c(T.ink) })
const g = glass()
const framed = (spec, title, accent) => ({ ...spec, ...glass({ glow: accent ?? T.violet }), box: { ...g.box, title: head(title) } })

function chips(k, x, w) {
  return [
    k.slicer({ name: 'releases', x, y: 30, w, h: 44, field: D('release'), mode: 'Basic', horizontal: true, header: false, font: 'Open Sans', size: 9, color: T.ink, itemBg: '#FFFFFF', outline: 'Frame', outlineColor: '#E3DDF7', syncGroup: 'release' }),
    yearSlicer(k, { x: x + w + 14, y: 34, w: 1250 - x - w - 14, h: 36, font: 'Open Sans', size: 9.5, color: T.ink, itemBg: '#FFFFFF', outline: 'Frame', outlineColor: '#E3DDF7' })
  ]
}

function creatorPulse(seed) {
  const k = kit(seed, T)
  const stat = (i, label, value, note) => {
    const y = 432 + i * 76
    return [
      k.text({ name: `s${i}-l`, x: 60, y, w: 160, h: 20, runs: [{ text: label, font: 'Open Sans', size: 9, color: T.muted }] }),
      k.card({ name: `s${i}-v`, x: 56, y: y + 18, w: 180, h: 46, field: kpi(value), size: 24, font: 'Barlow Semibold', color: T.ink }),
      k.card({ name: `s${i}-n`, x: 214, y: y + 26, w: 160, h: 30, field: fmt(note), size: 8.5, font: 'Open Sans', color: T.violet, align: 'right', wrap: true })
    ]
  }
  return [
    k.shape({ name: 'hero', x: 30, y: 30, w: 360, h: 660, ...glass({ glow: T.pink }), box: { ...g.box, padding: 0 } }),
    k.img({ name: 'orb', x: 54, y: 52, w: 54, h: 54, src: 'aurora-orb.svg' }),
    k.text({ name: 'brand', x: 116, y: 56, w: 260, h: 30, runs: [{ text: 'aurora', font: 'Barlow Semibold', size: 18, color: T.ink }] }),
    k.card({ name: 'brand-s', x: 113, y: 82, w: 260, h: 26, field: fmt('fmt_period'), size: 9, font: 'Open Sans', color: T.muted }),
    k.text({ name: 'hero-l', x: 60, y: 150, w: 300, h: 22, runs: [{ text: 'Total streams', font: 'Open Sans', size: 10, color: T.muted }] }),
    k.card({ name: 'hero-v', x: 54, y: 170, w: 330, h: 80, field: kpi('kpi_streams'), size: 42, font: 'Barlow Semibold', color: T.ink }),
    k.card({ name: 'hero-n', x: 56, y: 248, w: 320, h: 26, field: fmt('fmt_streams_note'), size: 9.5, font: 'Open Sans', color: T.violet }),
    k.img({ name: 'wave', x: 56, y: 290, w: 308, h: 116, src: 'aurora-wave.svg' }),
    ...stat(0, 'Monthly listeners', 'kpi_monthly_listeners', 'fmt_listeners_note'),
    ...stat(1, 'Saves to library', 'kpi_saves', 'fmt_saves_note'),
    ...stat(2, 'New followers', 'kpi_followers_gained', 'fmt_followers_note'),
    ...chips(k, 412, 700),
    k.line({ name: 'trend', x: 412, y: 92, w: 838, h: 262, area: true, stacked: true, cat: cal('month_abbr'), val: [as(kpi('kpi_streams'), 'Streams')], series: D('release'), colorMap: RELEASE_COLORS, legend: 'TopRight', smooth: true, yAxis: false, grid: false, ...glass(), box: { ...g.box, title: head('Streams over time') }, objects: { lineStyles: { strokeWidth: 1.5, areaTransparency: 30, lineChartType: 'smooth' }, legend: legend(T) } }),
    k.column({ name: 'top', x: 412, y: 372, w: 300, h: 318, horizontal: true, cat: D('track'), val: [as(kpi('kpi_streams'), 'Streams')], colorMap: TRACK_COLORS, labels: true, yAxis: false, grid: false, sort: { field: kpi('kpi_streams') }, ...glass({ glow: T.pink }), box: { ...g.box, title: head('Top tracks') } }),
    k.donut({ name: 'regions', x: 730, y: 372, w: 250, h: 318, cat: C('region'), val: as(kpi('kpi_monthly_listeners'), 'Monthly listeners'), innerRadius: 58, labelStyle: 'Category, percent of total', colorMap: REGION_COLORS, ...glass({ glow: T.aqua }), box: { ...g.box, title: head('Listeners by region') } }),
    k.column({ name: 'sources', x: 998, y: 372, w: 252, h: 318, cat: col('fact_stream', 'source'), val: [as(kpi('kpi_streams'), 'Streams')], colorMap: SOURCE_COLORS, labels: true, yAxis: false, grid: false, axisSize: 7.5, sort: { field: kpi('kpi_streams') }, ...glass({ glow: T.peach }), box: { ...g.box, title: head('How they find you') } })
  ]
}

function header(k, page) {
  return [
    k.img({ name: 'orb', x: 30, y: 28, w: 44, h: 44, src: 'aurora-orb.svg' }),
    k.text({ name: 'brand', x: 82, y: 26, w: 300, h: 30, runs: [{ text: 'aurora', font: 'Barlow Semibold', size: 18, color: T.ink }, { text: `  ${page}`, font: 'Barlow', size: 14, color: T.muted }] }),
    k.card({ name: 'brand-s', x: 79, y: 56, w: 260, h: 26, field: fmt('fmt_period'), size: 9, font: 'Open Sans', color: T.muted }),
    ...chips(k, 520, 592)
  ]
}

function tile(k, name, x, y, w, label, value, note, accent) {
  return [
    k.shape({ name: `${name}-bg`, x, y, w, h: 100, ...glass({ glow: accent }), box: { ...g.box, padding: 0 } }),
    k.text({ name: `${name}-l`, x: x + 18, y: y + 12, w: w - 36, h: 20, runs: [{ text: label, font: 'Open Sans', size: 9, color: T.muted }] }),
    k.card({ name: `${name}-v`, x: x + 14, y: y + 30, w: w - 28, h: 42, field: kpi(value), size: 22, font: 'Barlow Semibold', color: T.ink }),
    k.card({ name: `${name}-n`, x: x + 14, y: y + 70, w: w - 24, h: 24, field: fmt(note), size: 8.5, font: 'Open Sans', color: accent })
  ]
}

const xs = [30, 274, 518, 762, 1006]
const TW = 244 - 12

function tracksPage(seed) {
  const k = kit(seed, T)
  return [
    ...header(k, 'tracks & releases'),
    ...tile(k, 't1', xs[0], 90, TW, 'Streams', 'kpi_streams', 'fmt_top_track', T.violet),
    ...tile(k, 't2', xs[1], 90, TW, 'Save rate', 'kpi_save_rate_pct', 'fmt_saves_note', T.pink),
    ...tile(k, 't3', xs[2], 90, TW, 'Skip rate', 'kpi_skip_rate_pct', 'fmt_skip_note', T.peach),
    ...tile(k, 't4', xs[3], 90, TW, 'Discovery', 'kpi_discovery_share_pct', 'fmt_discovery_note', T.aqua),
    ...tile(k, 't5', xs[4], 90, TW, 'Earnings', 'kpi_revenue', 'fmt_revenue_note', T.sky),
    k.line(framed({ name: 'by-release', x: 30, y: 206, w: 760, h: 250, cat: cal('month_abbr'), val: [as(kpi('kpi_streams'), 'Streams')], series: D('release'), colorMap: RELEASE_COLORS, legend: 'TopRight', smooth: true, markers: true, grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Streams by release')),
    k.scatter(
      framed(
        {
          name: 'reach-save',
          x: 806,
          y: 206,
          w: 444,
          h: 250,
          details: D('track'),
          xm: as(kpi('kpi_streams'), 'Streams'),
          ym: as(kpi('kpi_save_rate_pct'), 'Save rate'),
          size: as(kpi('kpi_stream_listeners'), 'Listeners'),
          colors: [T.pink],
          labels: true,
          grid: true,
          axisSize: 7.5
        },
        'Reach against save rate',
        T.pink
      )
    ),
    growToFit(
      k.table(
        framed(
          {
            name: 'tracks',
            x: 30,
            y: 472,
            w: 1220,
            h: 218,
            fields: [as(D('track'), 'Track'), as(D('release'), 'Release'), as(D('release_type'), 'Type'), as(kpi('kpi_streams'), 'Streams'), as(kpi('kpi_streams_yoy_pct'), 'vs last year'), as(kpi('kpi_save_rate_pct'), 'Save rate'), as(kpi('kpi_skip_rate_pct'), 'Skip rate'), as(kpi('kpi_streams_per_listener'), 'Streams per listener'), as(kpi('kpi_revenue'), 'Earnings')],
            headBg: '#00000000',
            rowBg: '#00000000',
            headColor: T.violet,
            headFont: 'Barlow Semibold',
            font: 'Open Sans',
            lineColor: '#E3DDF7',
            rowPadding: 4,
            totals: true,
            sort: { field: kpi('kpi_streams') }
          },
          'Every track'
        )
      )
    )
  ]
}

function audiencePage(seed) {
  const k = kit(seed, T)
  return [
    ...header(k, 'audience'),
    ...tile(k, 'a1', xs[0], 90, TW, 'Monthly listeners', 'kpi_monthly_listeners', 'fmt_listeners_note', T.violet),
    ...tile(k, 'a2', xs[1], 90, TW, 'New followers', 'kpi_followers_gained', 'fmt_followers_note', T.pink),
    ...tile(k, 'a3', xs[2], 90, TW, 'Countries', 'kpi_countries', 'fmt_top_country', T.aqua),
    ...tile(k, 'a4', xs[3], 90, TW, 'Followers lost', 'kpi_followers_lost', 'fmt_churn_note', T.peach),
    ...tile(k, 'a5', xs[4], 90, TW, 'Earnings', 'kpi_revenue', 'fmt_revenue_note', T.sky),
    k.line(framed({ name: 'listeners', x: 30, y: 206, w: 600, h: 250, area: true, cat: cal('month_abbr'), val: [as(kpi('kpi_monthly_listeners'), 'Monthly listeners')], colors: [T.violet], smooth: true, grid: true, axisSize: 7.5, objects: { lineStyles: { strokeWidth: 2.5, areaTransparency: 60, lineChartType: 'smooth' } } }, 'Monthly listeners')),
    k.column(framed({ name: 'followers', x: 646, y: 206, w: 604, h: 250, cat: cal('month_abbr'), val: [as(kpi('kpi_followers_gained'), 'Gained'), as(kpi('kpi_followers_lost'), 'Lost')], colors: [T.aqua, T.pink], legend: 'TopRight', grid: true, axisSize: 7.5, objects: { legend: legend(T) } }, 'Followers gained and lost', T.aqua)),
    growToFit(
      k.table(
        framed(
          {
            name: 'countries',
            x: 30,
            y: 472,
            w: 600,
            h: 218,
            fields: [as(C('country'), 'Country'), as(C('region'), 'Region'), as(kpi('kpi_streams'), 'Streams'), as(kpi('kpi_monthly_listeners'), 'Listeners'), as(kpi('kpi_revenue'), 'Earnings'), as(kpi('kpi_revenue_per_1k_streams'), 'Per 1,000')],
            headBg: '#00000000',
            rowBg: '#00000000',
            headColor: T.violet,
            headFont: 'Barlow Semibold',
            font: 'Open Sans',
            lineColor: '#E3DDF7',
            rowPadding: 4,
            totals: true,
            sort: { field: kpi('kpi_streams') }
          },
          'Where they listen'
        )
      )
    ),
    k.column(framed({ name: 'ages', x: 646, y: 472, w: 290, h: 218, cat: col('fact_audience', 'age_band'), val: [as(kpi('kpi_monthly_listeners'), 'Monthly listeners')], colorMap: { '18-24': T.violet, '25-34': T.pink, '35-44': T.aqua, '45+': T.peach }, labels: true, yAxis: false, grid: false }, 'Listeners by age', T.pink)),
    k.donut(framed({ name: 'regions', x: 952, y: 472, w: 298, h: 218, cat: C('region'), val: as(kpi('kpi_revenue'), 'Earnings'), innerRadius: 56, labelStyle: 'Category, percent of total', colorMap: REGION_COLORS }, 'Earnings by region', T.aqua))
  ]
}

export default {
  id: 'aurora',
  name: 'Aurora',
  theme: themeOf(T),
  calendar: { start: START, end: END },
  tables,
  relationships,
  measures: { kpi: KPI, format: FMT },
  resources: { 'aurora-bg.svg': bg, 'aurora-wave.svg': wave, 'aurora-orb.svg': orb },
  pages: [
    { name: 'Creator Pulse', background: { color: T.bg, image: 'aurora-bg.svg' }, visuals: creatorPulse },
    { name: 'Tracks & Releases', background: { color: T.bg, image: 'aurora-bg.svg' }, visuals: tracksPage },
    { name: 'Audience', background: { color: T.bg, image: 'aurora-bg.svg' }, visuals: audiencePage }
  ]
}

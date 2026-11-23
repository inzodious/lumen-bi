/**
 * Contour: outdoors and conservation. A layered mountain panorama with pines and birds across the top,
 * topographic contour lines over sand below, a dashed trail that winds through four waypoint markers
 * (the headline figures), and an elevation-profile style area chart. Power BI compatible.
 */
import { kit, themeOf, colorMap } from '../kit.mjs'
import { m, col, as, c, rng } from '../lib.mjs'
import { svg, f, smooth, contours, noise2, pathOf } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round, season } from '../data.mjs'

export const T = {
  bg: '#EFE8D8',
  ink: '#21362B',
  muted: '#5D6B5A',
  grid: '#D8CFB9',
  forest: '#2F5D45',
  moss: '#7E9A47',
  clay: '#C2683A',
  sky: '#9CC3C7',
  sand: '#E4D6B6',
  colors: ['#2F5D45', '#C2683A', '#7E9A47', '#4F8A8B', '#D9A441', '#8A6F4D', '#A7C4A0', '#21362B'],
  fontBody: 'Trebuchet MS',
  fontHead: 'Trebuchet MS',
  fontNum: 'Georgia'
}

// ---------------------------------------------------------------- data
const PARKS = [
  ['Cedar Ridge', 1.3, 'Alpine'],
  ['Fox Hollow', 0.9, 'Forest'],
  ['Granite Basin', 0.75, 'Alpine'],
  ['Mirror Lake', 1.1, 'Lakeshore'],
  ['Pine Bluff', 0.6, 'Forest']
]
const SPECIES = [
  ['Elk', 1.0],
  ['Black bear', 0.35],
  ['Bald eagle', 0.5],
  ['Red fox', 0.7],
  ['River otter', 0.3]
]
const visits = []
const sightings = []
const jt = jitter('contour', 0.1)
PARKS.forEach(([park, size]) =>
  MONTHS.forEach((mo, mi) => {
    const v = 8200 * size * season(mi, 6.5, 0.7) * jt()
    visits.push([mo, mi + 1, park, Math.round(v), round(14 * size * season(mi, 6, 0.6) * jt(), 1), Math.round(mi >= 2 && mi <= 4 ? 900 * size * jt() : mi >= 8 && mi <= 9 ? 500 * size * jt() : 30 * jt())])
    SPECIES.forEach(([sp, w]) => sightings.push([mo, mi + 1, park, sp, Math.round(40 * w * size * season(mi, 6, 0.5) * jt())]))
  })
)

const F = (p) => m('_Trail', p)
const P = (p) => col('Parks', p)
const V = (p) => col('Visits', p)
const S = (p) => col('Sightings', p)
const measures = [
  { name: 'Visitors', dax: 'SUM(Visits[Visitors])', format: '#,0' },
  { name: 'Trail km Maintained', dax: 'SUM(Visits[TrailKm])', format: '#,0" km"' },
  { name: 'Trees Planted', dax: 'SUM(Visits[TreesPlanted])', format: '#,0' },
  { name: 'Wildlife Sightings', dax: 'SUM(Sightings[Sightings])', format: '#,0' },
  { name: 'Busiest Park', dax: 'FIRSTNONBLANK(TOPN(1, VALUES(Parks[Park]), [Visitors]), 1)' },
  { name: 'Visitors Note', dax: '"busiest: " & [Busiest Park]' },
  { name: 'Trail Note', dax: '"cleared, graded and signed"' },
  { name: 'Trees Note', dax: '"by volunteers this season"' },
  { name: 'Sightings Note', dax: 'DISTINCTCOUNT(Sightings[Species]) & " species logged"' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720
const BAND = 232

function ridge(seed, base, amp, step, freq) {
  const r = rng(seed)
  const pts = []
  for (let x = -40; x <= W + 40; x += step) pts.push([x, base - Math.abs(Math.sin(x * freq + r() * 0.6)) * amp - r() * amp * 0.35])
  return smooth(pts, false, 0.35) + `L${W + 40} ${BAND + 10}L-40 ${BAND + 10}Z`
}

function pines(seed, n, baseY, minH, maxH, color) {
  const r = rng(seed)
  let o = ''
  for (let i = 0; i < n; i++) {
    const x = r() * W
    const h = minH + r() * (maxH - minH)
    const w = h * 0.38
    const y = baseY + r() * 10
    o += `<path d="M${f(x)} ${f(y - h)}L${f(x + w * 0.5)} ${f(y - h * 0.55)}L${f(x + w * 0.3)} ${f(y - h * 0.55)}L${f(x + w * 0.6)} ${f(y - h * 0.2)}L${f(x + w * 0.35)} ${f(y - h * 0.2)}L${f(x + w * 0.7)} ${f(y)}L${f(x - w * 0.7)} ${f(y)}L${f(x - w * 0.35)} ${f(y - h * 0.2)}L${f(x - w * 0.6)} ${f(y - h * 0.2)}L${f(x - w * 0.3)} ${f(y - h * 0.55)}L${f(x - w * 0.5)} ${f(y - h * 0.55)}Z" fill="${color}"/>`
  }
  return o
}

function birds(x, y) {
  return [
    [0, 0, 1],
    [22, 8, 0.8],
    [40, -6, 0.7]
  ]
    .map(([dx, dy, s]) => `<path d="M${f(x + dx - 8 * s)} ${f(y + dy)}Q${f(x + dx - 4 * s)} ${f(y + dy - 5 * s)} ${f(x + dx)} ${f(y + dy)}Q${f(x + dx + 4 * s)} ${f(y + dy - 5 * s)} ${f(x + dx + 8 * s)} ${f(y + dy)}" fill="none" stroke="${T.ink}" stroke-width="1.6" stroke-linecap="round"/>`)
    .join('')
}

const noise = noise2('contour-terrain')
const field = (x, y) => noise(x / 160, y / 140) * 0.7 + noise(x / 60 + 7, y / 55 + 3) * 0.3
const topo = contours(W, H - BAND, field, Array.from({ length: 14 }, (_, i) => 0.18 + i * 0.05), { cell: 10 })

// waypoints along the trail (KPI badges sit on them)
export const WAYPOINTS = [
  [170, 352],
  [480, 318],
  [790, 360],
  [1100, 322]
]
const trailPts = [[-20, 420], ...WAYPOINTS, [1300, 380]]

/**
 * The panorama over contour lines. `trail` draws the dashed trail and its waypoint rings; `band` < 1 squashes the
 * mountains into a lower strip (the dashboards' detail pages).
 */
export function backdrop({ trail = true, band = 1 } = {}) {
  const top = BAND * band
  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="${T.bg}"/>` +
      `<g transform="translate(0 ${top})">${topo.map((p, i) => `<path d="${p.d}" fill="none" stroke="${i % 5 === 0 ? '#C9BA94' : '#DCCFAE'}" stroke-width="${i % 5 === 0 ? 1.3 : 0.8}"/>`).join('')}</g>` +
      (band === 1 ? '' : `<g transform="scale(1 ${band})">`) +
      `<rect width="${W}" height="${BAND}" fill="url(#sky)"/>` +
      `<circle cx="1040" cy="78" r="38" fill="#F6E7BF"/><circle cx="1040" cy="78" r="56" fill="#F6E7BF" opacity="0.35"/>` +
      birds(860, 64) +
      birds(300, 46) +
      `<path d="${ridge('r1', 150, 90, 70, 0.006)}" fill="#A9BFB8"/>` +
      `<path d="${ridge('r2', 178, 70, 60, 0.009)}" fill="#7E9C8C"/>` +
      `<path d="${ridge('r3', 202, 50, 50, 0.012)}" fill="#557A63"/>` +
      pines('p1', 46, 220, 26, 44, '#3E6B50') +
      `<path d="${ridge('r4', 226, 18, 40, 0.02)}" fill="${T.forest}"/>` +
      pines('p2', 60, 240, 30, 58, T.ink) +
      `<rect y="${BAND}" width="${W}" height="10" fill="${T.ink}"/>` +
      (band === 1 ? '' : '</g>') +
      (trail
        ? `<path d="${smooth(trailPts, false, 0.5)}" fill="none" stroke="${T.clay}" stroke-width="4" stroke-dasharray="10 9" stroke-linecap="round"/>` +
          WAYPOINTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="62" fill="${T.bg}" stroke="${T.ink}" stroke-width="3"/><circle cx="${x}" cy="${y}" r="55" fill="none" stroke="${T.clay}" stroke-width="1.5" stroke-dasharray="3 4"/>`).join('')
        : ''),
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#CFE0DA"/><stop offset="1" stop-color="#F2E6C9"/></linearGradient>`
  )
}
const bg = backdrop()

export const compass = svg(
  90,
  90,
  `<circle cx="45" cy="45" r="40" fill="${T.bg}" stroke="${T.ink}" stroke-width="2.5"/><circle cx="45" cy="45" r="33" fill="none" stroke="${T.ink}" stroke-width="0.8"/>` +
    `<path d="M45 10L52 45L45 80L38 45Z" fill="${T.ink}"/><path d="M45 10L52 45H38Z" fill="${T.clay}"/><path d="M10 45L45 39L80 45L45 51Z" fill="none" stroke="${T.ink}" stroke-width="1.4"/>` +
    `<circle cx="45" cy="45" r="4" fill="${T.bg}" stroke="${T.ink}" stroke-width="1.5"/>`
)

// ---------------------------------------------------------------- page
const panel = { background: { color: c('#FBF7EE') }, border: { color: c(T.ink), width: 1.5, radius: 10 }, padding: 14 }
const head = (text) => ({ show: true, text, fontFamily: 'Trebuchet MS', fontSize: 12, bold: true, fontColor: c(T.ink) })

function waypoint(k, i, label, value, note) {
  const [x, y] = WAYPOINTS[i]
  return [
    k.text({ name: `w${i}-l`, x: x - 55, y: y - 38, w: 110, h: 18, align: 'center', runs: [{ text: label, font: 'Trebuchet MS', size: 7.5, bold: true, color: T.clay }] }),
    k.card({ name: `w${i}-v`, x: x - 58, y: y - 22, w: 116, h: 38, field: F(value), size: 18, font: 'Georgia', bold: true, color: T.ink, align: 'center' }),
    k.card({ name: `w${i}-n`, x: x - 120, y: y + 66, w: 240, h: 26, field: F(note), size: 8.5, font: 'Trebuchet MS', italic: true, color: T.muted, align: 'center' })
  ]
}

export default {
  order: 8,
  id: 'contour',
  name: 'Contour',
  style: 'Nature',
  compatibility: 'powerbi',
  summary: 'Mountain panorama and topographic lines; a winding trail links waypoint KPIs',
  description:
    'A parks and conservation report under a layered mountain panorama with pines and birds: topographic contour lines over sand, a dashed trail that winds through four waypoint markers holding the headline figures, an elevation-profile area chart of visitors, visits by park and wildlife sightings. Opens in Power BI Desktop as is.',
  swatch: [T.bg, T.forest, T.clay, T.sky],
  theme: themeOf(T),
  measures: { table: '_Trail', list: measures },
  tables: [
    { name: 'Parks', columns: [{ name: 'Park', type: 'string' }, { name: 'Terrain', type: 'string' }], rows: PARKS.map(([p, , t]) => [p, t]) },
    {
      name: 'Visits',
      hidden: false,
      columns: [...monthColumns, { name: 'Park', type: 'string', hidden: true }, { name: 'Visitors', type: 'int64' }, { name: 'TrailKm', type: 'double', format: '#,0.0' }, { name: 'TreesPlanted', type: 'int64' }],
      rows: visits
    },
    {
      name: 'Sightings',
      columns: [{ name: 'Month', type: 'string', sortBy: 'MonthNo' }, { name: 'MonthNo', type: 'int64', hidden: true, summarize: 'none' }, { name: 'Park', type: 'string', hidden: true }, { name: 'Species', type: 'string' }, { name: 'Sightings', type: 'int64' }],
      rows: sightings
    }
  ],
  relationships: [
    { from: 'Visits.Park', to: 'Parks.Park' },
    { from: 'Sightings.Park', to: 'Parks.Park' }
  ],
  resources: { 'contour-bg.svg': bg, 'contour-compass.svg': compass },
  pages: [
    {
      name: 'Trail Report',
      background: { color: T.bg, image: 'contour-bg.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        return [
          k.text({ name: 'kicker', x: 40, y: 26, w: 500, h: 20, runs: [{ text: 'PARKS & CONSERVATION  ·  SEASON IN REVIEW', font: 'Trebuchet MS', size: 9, bold: true, color: T.clay }] }),
          k.text({ name: 'title', x: 40, y: 44, w: 600, h: 54, runs: [{ text: 'Trail Report', font: 'Georgia', size: 32, bold: true, color: T.ink }] }),
          k.text({ name: 'sub', x: 42, y: 96, w: 560, h: 24, runs: [{ text: 'Visitors, upkeep and wildlife across five parks', font: 'Georgia', size: 12, italic: true, color: T.ink }] }),
          k.slicer({ name: 'park', x: 640, y: 30, w: 200, h: 54, field: P('Park'), header: 'PARK', headFont: 'Trebuchet MS', headColor: T.ink, itemBg: '#FBF7EE', outline: 'Frame', outlineColor: T.ink }),
          k.img({ name: 'compass', x: 1170, y: 140, w: 80, h: 80, src: 'contour-compass.svg' }),
          ...waypoint(k, 0, 'VISITORS', 'Visitors', 'Visitors Note'),
          ...waypoint(k, 1, 'TRAILS KEPT', 'Trail km Maintained', 'Trail Note'),
          ...waypoint(k, 2, 'TREES PLANTED', 'Trees Planted', 'Trees Note'),
          ...waypoint(k, 3, 'SIGHTINGS', 'Wildlife Sightings', 'Sightings Note'),
          k.line({ name: 'profile', x: 40, y: 466, w: 600, h: 226, area: true, cat: V('Month'), val: [F('Visitors')], colors: [T.forest], smooth: true, width: 2.5, yAxis: false, grid: false, labels: false, box: { ...panel, title: head('Visitor profile through the year') }, objects: { lineStyles: { strokeWidth: 2.5, areaTransparency: 35, lineChartType: 'smooth' } } }),
          k.column({ name: 'parks', x: 660, y: 466, w: 290, h: 226, horizontal: true, cat: P('Park'), val: [F('Visitors')], colors: [T.clay], labels: true, yAxis: false, grid: false, sort: { field: F('Visitors') }, box: { ...panel, title: head('Visits by park') } }),
          k.donut({ name: 'wildlife', x: 970, y: 466, w: 270, h: 226, cat: S('Species'), val: F('Wildlife Sightings'), innerRadius: 50, labelStyle: 'Category, percent of total', colorMap: { Elk: T.forest, 'Black bear': T.ink, 'Bald eagle': '#D9A441', 'Red fox': T.clay, 'River otter': '#4F8A8B' }, box: { ...panel, title: head('Wildlife sightings') } })
        ]
      }
    }
  ]
}

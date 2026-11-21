/**
 * Atomic: mid-century modern record shop. Cream stock, teal, mustard and burnt orange, boomerangs and
 * atomic starbursts, halftone dots, a vinyl record that doubles as the genre donut, rounded TV-screen
 * cards with an off-register mustard print shadow. Georgia italic over Trebuchet. Power BI compatible.
 */
import { kit, themeOf, colorMap } from '../kit.mjs'
import { m, col, as, c, rng } from '../lib.mjs'
import { svg, f, smooth, starPath, halftone, rrect } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round, season } from '../data.mjs'

const T = {
  bg: '#F2E6CC',
  ink: '#3B2A20',
  muted: '#7A5F4B',
  grid: '#DCCBA6',
  teal: '#2C7873',
  mustard: '#E3A72F',
  orange: '#D3582B',
  olive: '#7D8B3A',
  salmon: '#E98A6A',
  cream: '#FBF4E4',
  colors: ['#2C7873', '#E3A72F', '#D3582B', '#7D8B3A', '#E98A6A', '#3B2A20', '#86B8B1', '#B9893F'],
  fontBody: 'Trebuchet MS',
  fontHead: 'Georgia',
  fontNum: 'Trebuchet MS'
}

// ---------------------------------------------------------------- data
const GENRES = [
  ['Jazz', 1.2, 4.6],
  ['Soul', 1.05, 3.9],
  ['Rock & Roll', 1.3, 3.6],
  ['Lounge', 0.7, 4.2],
  ['Doo-wop', 0.6, 3.4],
  ['Calypso', 0.45, 3.8]
]
const FORMATS = [
  ['LP', 0.9, 1.0],
  ['45 Single', 1.5, 0.28],
  ['EP', 0.6, 0.55],
  ['Reel Tape', 0.18, 1.6]
]
const rows = []
const jt = jitter('atomic', 0.14)
MONTHS.forEach((mo, mi) =>
  GENRES.forEach(([g, pop, price]) =>
    FORMATS.forEach(([fm, w, pm]) => {
      const units = Math.round(120 * pop * w * season(mi, 11, 0.3) * jt())
      rows.push([mo, mi + 1, g, fm, units, round(units * price * pm * jt(), 2)])
    })
  )
)

const F = (p) => m('_Ledger', p)
const D = (p) => col('Sales', p)
const measures = [
  { name: 'Records Sold', dax: 'SUM(Sales[Units])', format: '#,0' },
  { name: 'Revenue', dax: 'SUM(Sales[Revenue])', format: '\\$#,0' },
  { name: 'Avg Ticket', dax: 'DIVIDE([Revenue], [Records Sold])', format: '\\$0.00' },
  { name: 'Top Genre', dax: 'FIRSTNONBLANK(TOPN(1, VALUES(Sales[Genre]), [Records Sold]), 1)' },
  { name: 'Singles Share', dax: 'DIVIDE(CALCULATE([Records Sold], Sales[Format] = "45 Single"), [Records Sold])', format: '0%' },
  { name: 'Sold Note', dax: '"spinning out of the shop, led by " & [Top Genre]' },
  { name: 'Revenue Note', dax: '"at " & FORMAT([Avg Ticket], "\\$0.00") & " a record, on average"' },
  { name: 'Singles Note', dax: '"of everything sold was a 45"' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720

function burst(cx, cy, r, color, rays = 8, w = 2) {
  let d = ''
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2
    const L = i % 2 ? r * 0.55 : r
    d += `M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a) * L)} ${f(cy + Math.sin(a) * L)}`
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>` + [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8
    return `<circle cx="${f(cx + Math.cos(a) * r * 0.78)}" cy="${f(cy + Math.sin(a) * r * 0.78)}" r="${f(w * 1.3)}" fill="${color}"/>`
  }).join('') + `<circle cx="${cx}" cy="${cy}" r="${f(w * 1.8)}" fill="${color}"/>`
}

function sparkle(cx, cy, r, color) {
  return `<path d="${starPath(cx, cy, r, r * 0.16, 4)}" fill="${color}"/>`
}

// a boomerang (kidney) between two lobes
function boomerang(x, y, w, h, color, flip = false) {
  const pts = flip
    ? [[x + w, y + h * 0.1], [x + w * 0.55, y + h * 0.25], [x, y], [x + w * 0.08, y + h * 0.55], [x + w * 0.55, y + h], [x + w * 0.9, y + h * 0.8]]
    : [[x, y + h * 0.15], [x + w * 0.5, y], [x + w, y + h * 0.1], [x + w * 0.96, y + h * 0.75], [x + w * 0.5, y + h * 0.95], [x + w * 0.04, y + h * 0.85]]
  return `<path d="${smooth(pts, true, 0.55)}" fill="${color}"/>`
}

const bg = svg(
  W,
  H,
  `<rect width="${W}" height="${H}" fill="${T.bg}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#grain)"/>` +
    halftone(0, 520, 260, 200, 14, T.salmon, { dir: 'x', opacity: 0.45 }) +
    halftone(1000, 0, 280, 160, 14, T.mustard, { dir: 'y', opacity: 0.35 }) +
    // the big teal boomerang that carries the headline figures
    `<g transform="translate(6 8)">${boomerang(44, 118, 772, 236, T.mustard)}</g>` +
    boomerang(44, 118, 772, 236, T.teal) +
    burst(70, 74, 30, T.orange, 8, 2.4) +
    burst(860, 120, 22, T.teal, 8, 2) +
    burst(612, 76, 16, T.mustard, 8, 2) +
    burst(1240, 700, 26, T.teal, 8, 2.2) +
    sparkle(780, 74, 12, T.orange) +
    sparkle(1220, 420, 9, T.mustard) +
    sparkle(30, 380, 10, T.teal) +
    // ruled base line
    `<path d="M40 692H1240" stroke="${T.ink}" stroke-width="1.5"/><path d="M40 697H1240" stroke="${T.ink}" stroke-width="0.6"/>`,
  `<pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.6" fill="#E3D3B0"/><circle cx="4" cy="4" r="0.5" fill="#E8DABB"/></pattern>`
)

const logo = svg(
  80,
  80,
  [0, 60, 120].map((a) => `<ellipse cx="40" cy="40" rx="34" ry="12" transform="rotate(${a} 40 40)" fill="none" stroke="${T.ink}" stroke-width="2.6"/>`).join('') +
    `<circle cx="40" cy="40" r="7" fill="${T.orange}"/>` +
    [0, 120, 240].map((a, i) => {
      const rad = ((a + 20) * Math.PI) / 180
      return `<circle cx="${f(40 + Math.cos(rad) * 33)}" cy="${f(40 + Math.sin(rad) * 11.5)}" r="3.6" fill="${[T.teal, T.mustard, T.olive][i]}" transform="rotate(${[0, 60, 120][i]} 40 40)"/>`
    }).join('')
)

const record = svg(
  360,
  360,
  `<circle cx="186" cy="186" r="170" fill="${T.mustard}" opacity="0.9"/>` +
    `<circle cx="180" cy="180" r="170" fill="#1E1714"/>` +
    Array.from({ length: 22 }, (_, i) => `<circle cx="180" cy="180" r="${f(70 + i * 4.6)}" fill="none" stroke="#3A2E28" stroke-width="0.9"/>`).join('') +
    `<path d="M70 110A130 130 0 0 1 150 56" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0.18" fill="none"/>` +
    `<circle cx="180" cy="180" r="60" fill="${T.orange}"/><circle cx="180" cy="180" r="52" fill="none" stroke="${T.cream}" stroke-width="1.5" stroke-dasharray="3 4"/><circle cx="180" cy="180" r="6" fill="#1E1714"/>`
)

const tonearm = svg(
  140,
  260,
  `<circle cx="104" cy="30" r="22" fill="${T.cream}" stroke="${T.ink}" stroke-width="3"/><circle cx="104" cy="30" r="8" fill="${T.ink}"/>` +
    `<path d="M104 30L112 180L64 236" fill="none" stroke="${T.ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M104 30L112 180L64 236" fill="none" stroke="#C9B48A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="46" y="226" width="34" height="22" rx="4" transform="rotate(-40 63 237)" fill="${T.ink}"/>`
)

// ---------------------------------------------------------------- page
const tv = (extra = {}) => ({
  background: { color: c(T.cream) },
  border: { color: c(T.ink), width: 2, radius: 26 },
  shadow: { preset: 'Custom', color: c(T.mustard), transparency: 0, angle: 45, shadowDistance: 6, shadowBlur: 0, shadowSpread: 0, position: 'Outer' },
  ...extra
})
const head = (text) => ({ show: true, text, fontFamily: 'Georgia', fontSize: 14, italic: true, fontColor: c(T.ink) })

function figure(k, i, x, label, value, note) {
  return [
    k.text({ name: `f${i}-l`, x, y: 168, w: 230, h: 22, runs: [{ text: label, font: 'Trebuchet MS', size: 9, bold: true, color: T.mustard }] }),
    k.card({ name: `f${i}-v`, x: x - 4, y: 188, w: 240, h: 62, field: F(value), size: 36, font: 'Georgia', italic: true, color: T.cream }),
    k.card({ name: `f${i}-n`, x: x - 4, y: 252, w: 220, h: 44, field: F(note), size: 9.5, font: 'Trebuchet MS', color: '#D9EAE6', wrap: true })
  ]
}

export default {
  order: 5,
  id: 'atomic',
  name: 'Atomic',
  style: 'Mid-century',
  compatibility: 'powerbi',
  summary: 'Mid-century record shop: boomerangs, starbursts, a vinyl donut and TV-screen cards',
  description:
    'A 1950s hi-fi shop ledger on cream stock: headline figures on a teal boomerang, atomic starbursts and halftone dots, a vinyl record whose label is the genre donut, and rounded TV-screen cards with an off-register mustard print shadow. Opens in Power BI Desktop as is.',
  swatch: [T.bg, T.teal, T.mustard, T.orange],
  theme: themeOf(T),
  measures: { table: '_Ledger', list: measures },
  tables: [
    {
      name: 'Sales',
      columns: [
        ...monthColumns,
        { name: 'Genre', type: 'string' },
        { name: 'Format', type: 'string' },
        { name: 'Units', type: 'int64' },
        { name: 'Revenue', type: 'double', format: '\\$#,0.00' }
      ],
      rows
    }
  ],
  resources: { 'atomic-bg.svg': bg, 'atomic-logo.svg': logo, 'atomic-record.svg': record, 'atomic-tonearm.svg': tonearm },
  pages: [
    {
      name: 'Hi-Fi Ledger',
      background: { color: T.bg, image: 'atomic-bg.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        const genreColors = { Jazz: T.teal, Soul: T.orange, 'Rock & Roll': T.mustard, Lounge: T.olive, 'Doo-wop': T.salmon, Calypso: '#86B8B1' }
        return [
          k.img({ name: 'logo', x: 110, y: 22, w: 66, h: 66, src: 'atomic-logo.svg' }),
          k.text({ name: 'title', x: 184, y: 20, w: 520, h: 52, runs: [{ text: 'Atomic Records', font: 'Georgia', size: 30, italic: true, color: T.ink }] }),
          k.text({ name: 'sub', x: 188, y: 70, w: 520, h: 24, runs: [{ text: 'HI-FI SALES LEDGER  ✦  EST. 1958  ✦  ALL FORMATS', font: 'Trebuchet MS', size: 9, bold: true, color: T.orange }] }),
          ...figure(k, 0, 88, 'RECORDS SOLD', 'Records Sold', 'Sold Note'),
          ...figure(k, 1, 340, 'TAKINGS', 'Revenue', 'Revenue Note'),
          ...figure(k, 2, 580, 'SINGLES', 'Singles Share', 'Singles Note'),
          k.img({ name: 'record', x: 880, y: 26, w: 340, h: 340, src: 'atomic-record.svg' }),
          k.donut({ name: 'genres', x: 920, y: 66, w: 260, h: 260, cat: D('Genre'), val: F('Records Sold'), innerRadius: 44, labels: false, colorMap: genreColors }),
          k.img({ name: 'tonearm', x: 1150, y: 10, w: 110, h: 204, src: 'atomic-tonearm.svg' }),
          k.text({ name: 'genres-cap', x: 880, y: 374, w: 360, h: 22, align: 'center', runs: [{ text: 'Spins by genre', font: 'Georgia', size: 12, italic: true, color: T.ink }, { text: '   (the record is the chart)', font: 'Trebuchet MS', size: 8.5, color: T.muted }] }),
          k.slicer({ name: 'format', x: 880, y: 404, w: 360, h: 40, field: D('Format'), mode: 'Basic', horizontal: true, header: false, font: 'Trebuchet MS', size: 9, color: T.ink, itemBg: T.cream, outline: 'Frame', outlineColor: T.ink }),
          k.line({
            name: 'monthly',
            x: 40,
            y: 384,
            w: 520,
            h: 290,
            cat: D('Month'),
            val: [F('Revenue')],
            area: true,
            colors: [T.orange],
            smooth: true,
            width: 3,
            yAxis: false,
            labels: false,
            grid: false,
            box: { ...tv(), padding: 18, title: head('Takings through the year') },
            objects: { lineStyles: { strokeWidth: 3, areaTransparency: 60, lineChartType: 'smooth' } }
          }),
          k.column({
            name: 'formats',
            x: 590,
            y: 384,
            w: 270,
            h: 290,
            cat: D('Format'),
            val: [F('Records Sold')],
            labels: true,
            yAxis: false,
            grid: false,
            colorMap: { LP: T.teal, '45 Single': T.orange, EP: T.mustard, 'Reel Tape': T.olive },
            axisSize: 8,
            sort: { field: F('Records Sold') },
            box: { ...tv(), padding: 18, title: head('By format') }
          }),
          k.table({
            name: 'genre-table',
            x: 880,
            y: 462,
            w: 360,
            h: 212,
            fields: [as(D('Genre'), 'Genre'), as(F('Records Sold'), 'Sold'), as(F('Revenue'), 'Takings'), as(F('Avg Ticket'), 'Avg')],
            headBg: T.teal,
            headColor: T.cream,
            headFont: 'Trebuchet MS',
            rowBg: T.cream,
            rowAlt: '#F4E9D2',
            color: T.ink,
            lineColor: T.grid,
            size: 10.5,
            rowPadding: 2,
            sort: { field: F('Records Sold') },
            box: { ...tv(), padding: 14 }
          })
        ]
      }
    }
  ]
}

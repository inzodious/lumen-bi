/**
 * Doodle: cartoony and cheerful. Vanilla paper with sprinkles, outlined clouds and a smiling sun, rolling
 * hills, a waving ice-cream mascot, and sticker cards with thick ink outlines and hard offset shadows.
 * Power BI compatible: the cards are ordinary container borders, rounded corners and drop shadows.
 */
import { kit, themeOf } from '../kit.mjs'
import { m, col, as, c, rng } from '../lib.mjs'
import { svg, f, smooth, rrect, starPath } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round, season } from '../data.mjs'

const INK = '#2B2140'
const T = {
  bg: '#FFF4DE',
  ink: INK,
  muted: '#6B5E86',
  grid: '#EADFCB',
  pink: '#FF7AB6',
  mint: '#4FD1A0',
  lemon: '#FFD23F',
  sky: '#5CC3FF',
  orange: '#FF9F43',
  purple: '#9B7BFF',
  colors: ['#FF7AB6', '#4FD1A0', '#FFD23F', '#5CC3FF', '#FF9F43', '#9B7BFF', '#FF6B6B', '#7A5C3E'],
  fontBody: 'Trebuchet MS',
  fontHead: 'Arial Black',
  fontNum: 'Arial Black'
}

// ---------------------------------------------------------------- data
const FLAVORS = [
  ['Strawberry Swirl', 1.25, 4.7],
  ['Mint Chip', 1.0, 4.5],
  ['Lemon Sorbet', 0.7, 4.2],
  ['Choco Fudge', 1.35, 4.8],
  ['Cookie Dough', 1.1, 4.6],
  ['Mango Tango', 0.8, 4.4],
  ['Bubblegum', 0.55, 4.0]
]
const SERVINGS = [
  ['Cone', 1.0, 3.5],
  ['Cup', 0.75, 3.25],
  ['Shake', 0.35, 5.5]
]
const rows = []
const jt = jitter('doodle', 0.12)
const temps = MONTHS.map((_, mi) => round(14 + 13 * season(mi, 6.5, 1) - 13, 1))
MONTHS.forEach((mo, mi) =>
  FLAVORS.forEach(([fl, pop, rating]) =>
    SERVINGS.forEach(([sv, w, price]) => {
      const scoops = Math.round(420 * pop * w * season(mi, 6.5, 0.55) * jt())
      rows.push([mo, mi + 1, fl, sv, scoops, round(scoops * price * jt(), 2), Math.round(scoops * 0.82 * jt()), round(rating + (jt() - 1), 2), temps[mi]])
    })
  )
)

const F = (p) => m('_Treats', p)
const D = (p) => col('Scoops', p)
const measures = [
  { name: 'Scoops Sold', dax: 'SUM(Scoops[Scoops])', format: '#,0' },
  { name: 'Sales', dax: 'SUM(Scoops[Sales])', format: '\\$#,0' },
  { name: 'Happy Customers', dax: 'SUM(Scoops[HappyCustomers])', format: '#,0' },
  { name: 'Avg Rating', dax: 'AVERAGE(Scoops[Rating])', format: '0.0" ★"' },
  { name: 'Avg Temperature', dax: 'AVERAGE(Scoops[TempC])', format: '0"°C"' },
  { name: 'Top Flavor', dax: 'FIRSTNONBLANK(TOPN(1, VALUES(Scoops[Flavor]), [Scoops Sold]), 1)' },
  { name: 'Scoops Note', dax: '"Top flavor: " & [Top Flavor]' },
  { name: 'Sales Note', dax: 'FORMAT(DIVIDE([Sales], [Scoops Sold]), "\\$0.00") & " per scoop"' },
  { name: 'Happy Note', dax: 'FORMAT(DIVIDE([Happy Customers], [Scoops Sold]), "0%") & " came back smiling"' },
  { name: 'Rating Note', dax: '"from " & FORMAT([Scoops Sold], "#,0") & " taste tests"' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720
const OUT = (d, fill, w = 3) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`

function cloud(x, y, s) {
  const blobs = [
    [0, 0, 26],
    [30, -14, 32],
    [64, -4, 26],
    [88, 8, 18],
    [-22, 10, 18],
    [34, 12, 24]
  ]
  const outline = blobs.map(([dx, dy, r]) => `<circle cx="${f(x + dx * s)}" cy="${f(y + dy * s)}" r="${f(r * s + 3)}" fill="${INK}"/>`).join('')
  const fill = blobs.map(([dx, dy, r]) => `<circle cx="${f(x + dx * s)}" cy="${f(y + dy * s)}" r="${f(r * s)}" fill="#FFFFFF"/>`).join('')
  const flat = `<rect x="${f(x - 40 * s)}" y="${f(y + 14 * s)}" width="${f(140 * s)}" height="${f(30 * s)}" fill="${T.bg}"/>`
  return `<g>${outline}${fill}${flat}<path d="M${f(x - 38 * s)} ${f(y + 15.5 * s)}H${f(x + 104 * s)}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/></g>`
}

function sun(cx, cy, r) {
  let rays = ''
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const p = (rad, da) => [cx + Math.cos(a + da) * rad, cy + Math.sin(a + da) * rad]
    const [x1, y1] = p(r + 8, -0.12), [x2, y2] = p(r + 26, 0), [x3, y3] = p(r + 8, 0.12)
    rays += OUT(`M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}Z`, T.orange, 2.5)
  }
  return (
    rays +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${T.lemon}" stroke="${INK}" stroke-width="3"/>` +
    `<ellipse cx="${cx - r * 0.33}" cy="${cy - r * 0.12}" rx="${f(r * 0.08)}" ry="${f(r * 0.13)}" fill="${INK}"/><ellipse cx="${cx + r * 0.33}" cy="${cy - r * 0.12}" rx="${f(r * 0.08)}" ry="${f(r * 0.13)}" fill="${INK}"/>` +
    `<circle cx="${f(cx - r * 0.55)}" cy="${f(cy + r * 0.2)}" r="${f(r * 0.13)}" fill="${T.pink}" opacity="0.7"/><circle cx="${f(cx + r * 0.55)}" cy="${f(cy + r * 0.2)}" r="${f(r * 0.13)}" fill="${T.pink}" opacity="0.7"/>` +
    `<path d="M${f(cx - r * 0.3)} ${f(cy + r * 0.22)}Q${cx} ${f(cy + r * 0.62)} ${f(cx + r * 0.3)} ${f(cy + r * 0.22)}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
  )
}

function sprinkles(n, seed, area) {
  const r = rng(seed)
  let o = ''
  const cols = [T.pink, T.mint, T.lemon, T.sky, T.orange, T.purple]
  for (let i = 0; i < n; i++) {
    const x = area[0] + r() * area[2], y = area[1] + r() * area[3]
    const a = r() * 180
    o += `<rect x="${f(x - 5)}" y="${f(y - 1.8)}" width="10" height="3.6" rx="1.8" fill="${cols[i % cols.length]}" transform="rotate(${f(a)} ${f(x)} ${f(y)})" opacity="0.85"/>`
  }
  return o
}

function hills() {
  const back = []
  for (let x = -20; x <= W + 40; x += 80) back.push([x, 618 + Math.sin(x / 140 + 1) * 22])
  const front = []
  for (let x = -20; x <= W + 40; x += 70) front.push([x, 660 + Math.sin(x / 110) * 16])
  const fill = (pts, color) => smooth(pts) + `L${W + 40} ${H + 20}L-20 ${H + 20}Z`
  return OUT(fill(back), '#A8EBCB') + OUT(fill(front), T.mint)
}

const bg = svg(
  W,
  H,
  `<rect width="${W}" height="${H}" fill="${T.bg}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#dots)"/>` +
    sprinkles(70, 'doodle-sprinkles', [0, 110, W, 520]) +
    cloud(560, 60, 0.6) +
    cloud(1110, 655, 0.55) +
    hills() +
    sun(1238, 18, 34) +
    // little flowers on the hills
    [80, 420, 760, 1000]
      .map((x, i) => {
        const y = 676 + (i % 2) * 14
        return [0, 1, 2, 3, 4].map((k) => `<circle cx="${f(x + Math.cos((k * 2 * Math.PI) / 5) * 7)}" cy="${f(y + Math.sin((k * 2 * Math.PI) / 5) * 7)}" r="5" fill="#FFFFFF" stroke="${INK}" stroke-width="2"/>`).join('') + `<circle cx="${x}" cy="${y}" r="4" fill="${T.lemon}" stroke="${INK}" stroke-width="2"/>`
      })
      .join(''),
  `<pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2" fill="#F3DFB8"/><circle cx="18" cy="18" r="2" fill="#F3DFB8"/></pattern>`
)

const mascot = svg(
  200,
  250,
  // arms
  `<path d="M52 112C30 100 22 80 20 62" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="19" cy="56" r="9" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M150 116C168 124 176 138 180 150" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="181" cy="155" r="9" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>` +
    // cone
    OUT('M58 118L100 238L142 118Z', '#F2B45A') +
    [0, 1, 2, 3].map((i) => `<path d="M${66 + i * 22} 118L${108 + i * 4 - 30} ${238 - (i + 1) * 0}" stroke="#C98A2E" stroke-width="2" opacity="0"/>`).join('') +
    [130, 152, 174, 196].map((y) => {
      const t = (y - 118) / 120
      return `<path d="M${f(58 + 42 * t)} ${y}L${f(142 - 42 * t)} ${y}" stroke="#C98A2E" stroke-width="2.5"/>`
    }).join('') +
    [0, 1, 2].map((i) => `<path d="M${74 + i * 22} 118L${f(100 + (i - 1) * 6)} 214" stroke="#C98A2E" stroke-width="2.5"/>`).join('') +
    // scoop with drips
    OUT('M40 116C26 112 24 90 40 84C34 56 62 34 90 40C108 22 146 30 152 58C176 62 180 92 162 104C168 120 150 128 140 118C136 136 118 138 114 122C108 140 86 140 84 122C76 134 56 132 58 118C52 124 42 124 40 116Z', T.pink) +
    `<path d="M70 60C78 52 92 50 100 54" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.7"/>` +
    sprinkles(10, 'mascot', [56, 56, 90, 30]) +
    // cherry
    `<path d="M104 32C104 20 112 10 124 6" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="102" cy="36" r="12" fill="#FF4D5E" stroke="${INK}" stroke-width="3"/><circle cx="98" cy="31" r="3" fill="#FFFFFF"/>` +
    // face
    `<ellipse cx="82" cy="88" rx="6" ry="8" fill="${INK}"/><ellipse cx="122" cy="88" rx="6" ry="8" fill="${INK}"/><circle cx="84" cy="85" r="2" fill="#FFFFFF"/><circle cx="124" cy="85" r="2" fill="#FFFFFF"/>` +
    `<circle cx="70" cy="100" r="7" fill="#FF4D8D" opacity="0.55"/><circle cx="134" cy="100" r="7" fill="#FF4D8D" opacity="0.55"/>` +
    `<path d="M90 100Q102 114 114 100" fill="#7A1F3D" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`
)

const icon = (body) => svg(64, 64, body)
const icons = {
  'doodle-icon-scoop.svg': icon(OUT('M18 34L32 60L46 34Z', '#F2B45A', 2.5) + OUT('M14 34C8 30 10 20 18 20C18 10 30 6 36 12C44 8 54 16 50 26C56 30 52 38 46 36Z', '#FFFFFF', 2.5) + `<circle cx="32" cy="10" r="5" fill="#FF4D5E" stroke="${INK}" stroke-width="2.5"/>`),
  'doodle-icon-coin.svg': icon(`<circle cx="32" cy="34" r="22" fill="${T.lemon}" stroke="${INK}" stroke-width="3"/><circle cx="32" cy="34" r="15" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="3 4"/>` + OUT(starPath(32, 34, 9, 4, 5), '#FFFFFF', 2) + `<path d="M50 10l3 6 6 2-6 2-3 6-3-6-6-2 6-2z" fill="#FFFFFF" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`),
  'doodle-icon-heart.svg': icon(OUT('M32 56C14 44 6 34 8 22C10 12 22 8 32 18C42 8 54 12 56 22C58 34 50 44 32 56Z', '#FFFFFF', 3) + `<ellipse cx="24" cy="28" rx="3" ry="4" fill="${INK}"/><ellipse cx="40" cy="28" rx="3" ry="4" fill="${INK}"/><path d="M25 36Q32 43 39 36" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`),
  'doodle-icon-star.svg': icon(OUT(starPath(32, 34, 26, 12, 5), '#FFFFFF', 3) + `<circle cx="27" cy="33" r="2.5" fill="${INK}"/><circle cx="37" cy="33" r="2.5" fill="${INK}"/><path d="M28 39Q32 42 36 39" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`)
}

const banner = svg(
  600,
  96,
  OUT('M14 30L44 22L44 78L14 86L26 56Z', '#E0559A') + OUT('M586 30L556 22L556 78L586 86L574 56Z', '#E0559A') + OUT(rrect(40, 10, 520, 70, 14), T.pink) + `<path d="M56 22H544" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.55"/>`
)

const SERVING_COLORS = { Cone: T.pink, Cup: T.sky, Shake: T.lemon }

// ---------------------------------------------------------------- page
const sticker = (fill, extra = {}) => ({
  background: { color: c(fill) },
  border: { color: c(INK), width: 3, radius: 18 },
  shadow: { preset: 'Custom', color: c(INK), transparency: 0, angle: 45, shadowDistance: 6, shadowBlur: 0, shadowSpread: 0, position: 'Outer' },
  ...extra
})
const chartTitle = (text) => ({ show: true, text, fontFamily: 'Arial Black', fontSize: 12, fontColor: c(INK) })

function kpi(k, i, label, value, note, fill, iconFile) {
  const x = 196 + i * 266
  return [
    k.shape({ name: `k${i}`, x, y: 140, w: 246, h: 112, box: sticker(fill) }),
    k.img({ name: `k${i}-i`, x: x + 12, y: 152, w: 54, h: 54, src: iconFile }),
    k.text({ name: `k${i}-l`, x: x + 72, y: 154, w: 166, h: 22, runs: [{ text: label, font: 'Arial Black', size: 10, color: INK }] }),
    k.card({ name: `k${i}-v`, x: x + 68, y: 172, w: 172, h: 46, field: F(value), size: 24, font: 'Arial Black', color: INK }),
    k.card({ name: `k${i}-n`, x: x + 12, y: 218, w: 228, h: 26, field: F(note), size: 9, font: 'Trebuchet MS', color: INK })
  ]
}

export default {
  order: 3,
  id: 'doodle',
  name: 'Doodle',
  style: 'Cartoon',
  compatibility: 'powerbi',
  summary: 'Cartoon sticker cards with ink outlines, a waving ice-cream mascot, sunny hills',
  description:
    'A cheerful treats tracker drawn like a cartoon: a waving ice-cream mascot, a ribbon banner, outlined clouds and a smiling sun, and sticker cards with thick ink borders and hard offset shadows. Scoops by flavor, serving mix, sales against sunshine and a flavor leaderboard. Opens in Power BI Desktop as is.',
  swatch: [T.bg, T.pink, T.mint, T.lemon],
  theme: themeOf(T),
  measures: { table: '_Treats', list: measures },
  tables: [
    {
      name: 'Scoops',
      columns: [
        ...monthColumns,
        { name: 'Flavor', type: 'string' },
        { name: 'Serving', type: 'string' },
        { name: 'Scoops', type: 'int64' },
        { name: 'Sales', type: 'double', format: '\\$#,0.00' },
        { name: 'HappyCustomers', type: 'int64' },
        { name: 'Rating', type: 'double', format: '0.0', summarize: 'average' },
        { name: 'TempC', type: 'double', format: '0.0', summarize: 'average' }
      ],
      rows
    }
  ],
  resources: { 'doodle-bg.svg': bg, 'doodle-mascot.svg': mascot, 'doodle-banner.svg': banner, ...icons },
  pages: [
    {
      name: 'Scoop Report',
      background: { color: T.bg, image: 'doodle-bg.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        const flavorColors = [T.pink, T.mint, T.lemon, '#7A4E2D', '#C9A27C', T.orange, '#FF9ED2']
        const flavorNames = FLAVORS.map((x) => x[0])
        return [
          k.img({ name: 'mascot', x: 18, y: 14, w: 168, h: 210, src: 'doodle-mascot.svg' }),
          k.img({ name: 'banner', x: 186, y: 16, w: 560, h: 90, src: 'doodle-banner.svg' }),
          k.text({ name: 'title', x: 240, y: 30, w: 450, h: 50, align: 'center', runs: [{ text: 'The Scoop Report', font: 'Arial Black', size: 24, color: '#FFFFFF' }] }),
          k.text({ name: 'sub', x: 770, y: 98, w: 470, h: 24, align: 'right', runs: [{ text: 'Sunny Scoops  ·  how many scoops made people smile this year', font: 'Trebuchet MS', size: 10, italic: true, color: T.muted }] }),
          k.slicer({
            name: 'serving',
            x: 770,
            y: 38,
            w: 410,
            h: 50,
            field: D('Serving'),
            mode: 'Basic',
            horizontal: true,
            header: false,
            font: 'Arial Black',
            size: 10,
            color: INK,
            itemBg: '#FFFFFF',
            outline: 'Frame',
            outlineColor: INK
          }),
          ...kpi(k, 0, 'SCOOPS SOLD', 'Scoops Sold', 'Scoops Note', T.pink, 'doodle-icon-scoop.svg'),
          ...kpi(k, 1, 'SALES', 'Sales', 'Sales Note', T.lemon, 'doodle-icon-coin.svg'),
          ...kpi(k, 2, 'HAPPY FACES', 'Happy Customers', 'Happy Note', T.mint, 'doodle-icon-heart.svg'),
          ...kpi(k, 3, 'TASTE RATING', 'Avg Rating', 'Rating Note', T.sky, 'doodle-icon-star.svg'),

          k.column({
            name: 'flavors',
            x: 30,
            y: 282,
            w: 486,
            h: 250,
            horizontal: true,
            cat: D('Flavor'),
            val: [F('Scoops Sold')],
            labels: true,
            yAxis: false,
            grid: false,
            axisSize: 9,
            axisColor: INK,
            sort: { field: F('Scoops Sold') },
            objects: { dataPoint: [{ showAllDataPoints: true }, ...flavorColors.map((cc, i) => ({ fill: c(cc), $selector: { data: [{ scopeId: { Comparison: { ComparisonKind: 0, Left: { Column: { Expression: { SourceRef: { Entity: 'Scoops' } }, Property: 'Flavor' } }, Right: { Literal: { Value: `'${flavorNames[i]}'` } } } } }] } }))] },
            box: { ...sticker('#FFFFFF'), padding: 14, title: chartTitle('Scoops by flavor') }
          }),
          k.donut({
            name: 'serving-mix',
            x: 540,
            y: 282,
            w: 266,
            h: 250,
            cat: D('Serving'),
            val: F('Scoops Sold'),
            innerRadius: 52,
            legend: 'Bottom',
            labelStyle: 'Percent of total',
            colorMap: SERVING_COLORS,
            box: { ...sticker('#FFFFFF'), padding: 14, title: chartTitle('Cone, cup or shake?') }
          }),
          k.combo({
            name: 'sunshine',
            x: 830,
            y: 282,
            w: 420,
            h: 250,
            cat: D('Month'),
            columns: [F('Sales')],
            lines: [F('Avg Temperature')],
            colors: [T.orange, INK],
            legend: 'Top',
            axisSize: 7,
            box: { ...sticker('#FFFFFF'), padding: 14, title: chartTitle('Sales vs sunshine') }
          }),
          k.line({
            name: 'season',
            x: 30,
            y: 556,
            w: 760,
            h: 128,
            area: true,
            stacked: true,
            cat: D('Month'),
            val: [F('Scoops Sold')],
            series: D('Serving'),
            colorMap: SERVING_COLORS,
            legend: 'TopRight',
            smooth: true,
            axisSize: 8,
            box: { ...sticker('#FFFFFF'), padding: 12, title: chartTitle('Scoops through the seasons') }
          }),
          k.table({
            name: 'leaderboard',
            x: 816,
            y: 556,
            w: 434,
            h: 128,
            fields: [as(D('Flavor'), 'Flavor'), as(F('Scoops Sold'), 'Scoops'), as(F('Avg Rating'), 'Rating'), as(F('Sales'), 'Sales')],
            headBg: T.lemon,
            headColor: INK,
            headFont: 'Arial Black',
            rowBg: '#FFFFFF',
            rowAlt: '#FFF4DE',
            color: INK,
            font: 'Trebuchet MS',
            lineColor: '#F1E3C6',
            size: 9,
            rowPadding: 2,
            sort: { field: F('Scoops Sold') },
            box: { ...sticker('#FFFFFF'), padding: 10 }
          })
        ]
      }
    }
  ]
}

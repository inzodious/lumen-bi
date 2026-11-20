/**
 * Monolith: ultra-modern bento grid. Warm concrete canvas, rounded tiles in white, black and one electric
 * lime, giant light numerals, lowercase labels, abstract geometry (arcs, rings, an arrow) inside the
 * tiles. Power BI compatible: tiles are container backgrounds with rounded corners.
 */
import { kit, themeOf, colorMap } from '../kit.mjs'
import { m, col, as, c } from '../lib.mjs'
import { svg, f } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round } from '../data.mjs'

const T = {
  bg: '#E9E8E3',
  ink: '#0E0E0E',
  muted: '#8A8A85',
  grid: '#E2E1DB',
  lime: '#D4FF3A',
  stone: '#D6D5CE',
  white: '#FFFFFF',
  colors: ['#0E0E0E', '#D4FF3A', '#8A8A85', '#5B5BF0', '#C8C7BF', '#3A3A38', '#A8E000', '#B9B8FF'],
  fontBody: 'Segoe UI',
  fontHead: 'Segoe UI Semibold',
  fontNum: 'Segoe UI Light'
}

// ---------------------------------------------------------------- data
const PLANS = [
  ['Free', 5200, 0, 0.62],
  ['Pro', 1900, 24, 0.81],
  ['Team', 820, 79, 0.88],
  ['Enterprise', 140, 1150, 0.94]
]
const CHANNELS = [
  ['Organic', 0.42],
  ['Paid', 0.26],
  ['Referral', 0.2],
  ['Partner', 0.12]
]
const rows = []
const jt = jitter('monolith', 0.07)
MONTHS.forEach((mo, mi) =>
  PLANS.forEach(([plan, users, arpu, ret]) =>
    CHANNELS.forEach(([ch, share]) => {
      const g = 1 + mi * 0.035
      const active = users * share * g * jt()
      const signups = active * (plan === 'Free' ? 0.18 : 0.06) * jt()
      rows.push([mo, mi + 1, plan, ch, Math.round(active), Math.round(signups), round(active * arpu * jt(), 0), Math.round(active * (1 - ret) * 0.1 * jt()), round(ret * jt(), 3), Math.round((plan === 'Free' ? 31 : plan === 'Pro' ? 44 : plan === 'Team' ? 52 : 61) * jt())])
    })
  )
)

const F = (p) => m('_Pulse', p)
const D = (p) => col('Usage', p)
const LAST = (e) => `CALCULATE(${e}, Usage[MonthNo] = MAX(Usage[MonthNo]))`
const measures = [
  { name: 'Active Users', dax: LAST('SUM(Usage[ActiveUsers])'), format: '#,0' },
  { name: 'Active Users (sum)', dax: 'SUM(Usage[ActiveUsers])', format: '#,0' },
  { name: 'MRR', dax: LAST('SUM(Usage[MRR])'), format: '\\$#,0' },
  { name: 'MRR (sum)', dax: 'SUM(Usage[MRR])', format: '\\$#,0' },
  { name: 'Signups', dax: 'SUM(Usage[Signups])', format: '#,0' },
  { name: 'Retention', dax: 'AVERAGE(Usage[Retention])', format: '0%' },
  { name: 'NPS', dax: 'AVERAGE(Usage[NPS])', format: '0' },
  { name: 'Churned', dax: 'SUM(Usage[Churned])', format: '#,0' },
  { name: 'MRR Growth', dax: 'VAR m = MAX(Usage[MonthNo]) VAR cur = CALCULATE(SUM(Usage[MRR]), Usage[MonthNo] = m) VAR prev = CALCULATE(SUM(Usage[MRR]), Usage[MonthNo] = m - 1) RETURN DIVIDE(cur - prev, prev)', format: '+0.0%;-0.0%' },
  { name: 'MRR Note', dax: 'FORMAT([MRR Growth], "+0.0%;-0.0%") & " month over month"' },
  { name: 'Users Note', dax: '"active this month · " & FORMAT([Signups], "#,0") & " signups this year"' }
]

// ---------------------------------------------------------------- art
const dots = svg(1280, 720, `<rect width="1280" height="720" fill="${T.bg}"/><rect width="1280" height="720" fill="url(#d)"/>`, `<pattern id="d" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="0.9" fill="#D2D1CA"/></pattern>`)

// black tile: concentric arcs bleeding off the corner
const arcs = svg(
  404,
  420,
  Array.from({ length: 7 }, (_, i) => `<circle cx="404" cy="0" r="${70 + i * 34}" fill="none" stroke="${i === 2 ? T.lime : '#2A2A28'}" stroke-width="${i === 2 ? 2 : 1}"/>`).join('') + `<circle cx="404" cy="0" r="54" fill="${T.lime}"/>`
)
// lime tile: big diagonal arrow
const arrow = svg(300, 204, `<path d="M222 166L270 118M270 118H232M270 118V156" stroke="${T.ink}" stroke-width="9" stroke-linecap="square" fill="none"/>`)
// stone tile: quarter rings
const rings = svg(246, 204, Array.from({ length: 5 }, (_, i) => `<path d="M${f(246 - 40 - i * 26)} 204A${40 + i * 26} ${40 + i * 26} 0 0 1 246 ${f(204 - 40 - i * 26)}" fill="none" stroke="${T.ink}" stroke-width="${i === 0 ? 10 : 1.2}" opacity="${i === 0 ? 1 : 0.35}"/>`).join(''))
// white tile: half-tone bar sculpture
const bars = svg(140, 80, Array.from({ length: 9 }, (_, i) => `<rect x="${i * 15}" y="${f(80 - (12 + Math.abs(Math.sin(i * 0.9)) * 60))}" width="9" height="${f(12 + Math.abs(Math.sin(i * 0.9)) * 60)}" rx="4.5" fill="${i === 6 ? T.lime : T.ink}"/>`).join(''))
// wordmark glyph: a monolith slab
const mark = svg(28, 40, `<rect x="4" y="2" width="20" height="36" rx="3" fill="${T.lime}"/><rect x="4" y="2" width="8" height="36" rx="3" fill="#A8E000"/>`)

// ---------------------------------------------------------------- page
const tile = (fill, extra = {}) => ({ background: { color: c(fill) }, border: { color: c(fill), width: 0, radius: 28 }, padding: 22, ...extra })
const lbl = (k, name, x, y, text, color = T.muted, w = 300) => k.text({ name, x, y, w, h: 22, runs: [{ text, font: 'Segoe UI Semibold', size: 9.5, color }] })
const ttl = (text, color = T.ink) => ({ show: true, text, fontFamily: 'Segoe UI Semibold', fontSize: 11, fontColor: c(color) })

export default {
  order: 2,
  id: 'monolith',
  name: 'Monolith',
  style: 'Modern',
  compatibility: 'powerbi',
  summary: 'Ultra-modern bento grid: giant light numerals, black and electric-lime tiles, pure geometry',
  description:
    'A product pulse laid out as a bento grid of rounded tiles on warm concrete: a black hero tile with recurring revenue in giant light type, an electric-lime active-users tile, retention, NPS, plan mix, signups by channel and a plan table, each tile with its own piece of abstract geometry. Opens in Power BI Desktop as is.',
  swatch: [T.bg, T.ink, T.lime, T.white],
  theme: themeOf(T),
  measures: { table: '_Pulse', list: measures },
  tables: [
    {
      name: 'Usage',
      columns: [
        ...monthColumns,
        { name: 'Plan', type: 'string' },
        { name: 'Channel', type: 'string' },
        { name: 'ActiveUsers', type: 'int64' },
        { name: 'Signups', type: 'int64' },
        { name: 'MRR', type: 'double', format: '\\$#,0' },
        { name: 'Churned', type: 'int64' },
        { name: 'Retention', type: 'double', format: '0%', summarize: 'average' },
        { name: 'NPS', type: 'int64', summarize: 'average' }
      ],
      rows
    }
  ],
  resources: { 'monolith-bg.svg': dots, 'monolith-arcs.svg': arcs, 'monolith-arrow.svg': arrow, 'monolith-rings.svg': rings, 'monolith-bars.svg': bars, 'monolith-mark.svg': mark },
  pages: [
    {
      name: 'Pulse',
      background: { color: T.bg, image: 'monolith-bg.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        const planColors = { Free: T.stone, Pro: T.ink, Team: T.lime, Enterprise: '#5B5BF0' }
        return [
          // A: black hero
          k.shape({ name: 'A', x: 24, y: 24, w: 404, h: 420, box: tile(T.ink, { padding: 0 }) }),
          k.img({ name: 'A-art', x: 24, y: 24, w: 404, h: 420, src: 'monolith-arcs.svg', scaling: 'Fill' }),
          k.img({ name: 'A-mark', x: 50, y: 48, w: 20, h: 28, src: 'monolith-mark.svg' }),
          k.text({ name: 'A-brand', x: 78, y: 48, w: 200, h: 28, runs: [{ text: 'monolith', font: 'Segoe UI Semibold', size: 15, color: T.white }, { text: '.', font: 'Segoe UI Semibold', size: 15, color: T.lime }] }),
          lbl(k, 'A-l', 50, 196, 'monthly recurring revenue', '#9B9B95'),
          k.card({ name: 'A-v', x: 44, y: 214, w: 380, h: 96, field: F('MRR'), size: 60, font: 'Segoe UI Light', color: T.white }),
          k.card({ name: 'A-n', x: 46, y: 306, w: 360, h: 24, field: F('MRR Note'), size: 10, font: 'Segoe UI Semibold', color: T.lime }),
          k.line({ name: 'A-spark', x: 40, y: 340, w: 372, h: 92, area: true, scalar: true, cat: D('MonthNo'), val: [F('MRR (sum)')], colors: [T.lime], xAxis: false, yAxis: false, grid: false, width: 2.5, objects: { lineStyles: { strokeWidth: 2.5, areaTransparency: 85 } } }),

          // B: lime users
          k.shape({ name: 'B', x: 440, y: 24, w: 300, h: 204, box: tile(T.lime, { padding: 0 }) }),
          k.img({ name: 'B-art', x: 440, y: 24, w: 300, h: 204, src: 'monolith-arrow.svg' }),
          lbl(k, 'B-l', 462, 44, 'active users', T.ink),
          k.card({ name: 'B-v', x: 456, y: 62, w: 270, h: 80, field: F('Active Users'), size: 48, font: 'Segoe UI Light', color: T.ink }),
          k.card({ name: 'B-n', x: 458, y: 144, w: 200, h: 44, field: F('Users Note'), size: 8.5, font: 'Segoe UI', color: T.ink, wrap: true }),

          // C: trend
          k.line({ name: 'C', x: 752, y: 24, w: 504, h: 204, cat: D('Month'), val: [F('Active Users (sum)')], series: D('Plan'), colorMap: planColors, legend: 'TopRight', width: 2.5, yAxis: false, grid: false, smooth: true, box: tile(T.white, { title: ttl('active users by plan') }) }),

          // D: retention
          k.shape({ name: 'D', x: 440, y: 240, w: 300, h: 204, box: tile(T.white, { padding: 0 }) }),
          lbl(k, 'D-l', 462, 260, 'retention'),
          k.gauge({ name: 'D-g', x: 452, y: 278, w: 276, h: 160, value: F('Retention'), min: 0, maxValue: 1, fill: T.ink, calloutSize: 30, calloutFont: 'Segoe UI Light', objects: { dataPoint: { fill: c(T.ink), target: c(T.lime) } } }),

          // E: NPS
          k.shape({ name: 'E', x: 752, y: 240, w: 246, h: 204, box: tile(T.stone, { padding: 0 }) }),
          k.img({ name: 'E-art', x: 752, y: 240, w: 246, h: 204, src: 'monolith-rings.svg' }),
          lbl(k, 'E-l', 774, 260, 'net promoter score', T.ink),
          k.card({ name: 'E-v', x: 768, y: 280, w: 200, h: 100, field: F('NPS'), size: 64, font: 'Segoe UI Light', color: T.ink }),

          // F: plan mix
          k.donut({ name: 'F', x: 1010, y: 240, w: 246, h: 204, cat: D('Plan'), val: F('Active Users (sum)'), innerRadius: 72, labels: false, legend: 'Bottom', colorMap: planColors, box: tile(T.white, { padding: 14, title: ttl('plan mix') }) }),

          // G: channels
          k.column({ name: 'G', x: 24, y: 456, w: 716, h: 240, stacked: true, cat: D('Month'), val: [F('Signups')], series: D('Channel'), colorMap: { Organic: T.ink, Paid: T.lime, Referral: '#8A8A85', Partner: '#5B5BF0' }, legend: 'TopRight', yAxis: false, grid: false, box: tile(T.white, { title: ttl('signups by channel') }) }),
          k.img({ name: 'G-art', x: 600, y: 470, w: 112, h: 64, src: 'monolith-bars.svg' }),

          // H: plans table on black
          k.table({
            name: 'H',
            x: 752,
            y: 456,
            w: 504,
            h: 240,
            fields: [as(D('Plan'), 'plan'), as(F('Active Users'), 'active'), as(F('MRR'), 'mrr'), as(F('Retention'), 'retention'), as(F('NPS'), 'nps')],
            headBg: T.ink,
            headColor: T.lime,
            headFont: 'Segoe UI Semibold',
            headBold: false,
            rowBg: T.ink,
            color: T.white,
            font: 'Segoe UI Light',
            size: 12,
            lineColor: '#2A2A28',
            rowPadding: 5,
            sort: { field: F('MRR') },
            box: tile(T.ink, { title: ttl('plans', T.white) })
          })
        ]
      }
    }
  ]
}

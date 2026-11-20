/**
 * Broadsheet: an editorial front page. Newsprint, black ink and one spot red, a masthead with ears and a
 * dateline, a lead story built around the main chart (headline, deck, drop cap), a boxed "By the numbers"
 * sidebar, engraved line art of a streetcar and column rules. Power BI compatible.
 */
import { kit, themeOf, colorMap } from '../kit.mjs'
import { m, col, as, c, rng } from '../lib.mjs'
import { svg, f, pathOf } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round, season } from '../data.mjs'

const T = {
  bg: '#F3EFE6',
  ink: '#161616',
  muted: '#5F5B53',
  grid: '#D3CCBC',
  red: '#B5121B',
  colors: ['#161616', '#B5121B', '#7A746A', '#B8B0A0', '#3C3C3C', '#D9786F', '#9C958A', '#5F5B53'],
  fontBody: 'Georgia',
  fontHead: 'Georgia',
  fontNum: 'Georgia'
}

// ---------------------------------------------------------------- data
const LINES = [
  ['Red Line', 'Northside', 182, 0.86],
  ['Blue Line', 'Riverside', 151, 0.92],
  ['Green Line', 'Old Town', 118, 0.9],
  ['Gold Line', 'Harbor', 96, 0.94],
  ['Harbor Ferry', 'Harbor', 31, 0.97],
  ['Crosstown Bus', 'Old Town', 74, 0.81]
]
const rows = []
const jt = jitter('broadsheet', 0.05)
MONTHS.forEach((mo, mi) =>
  LINES.forEach(([line, district, riders, ontime]) => {
    const grow = line === 'Harbor Ferry' || line === 'Gold Line' ? 1 + mi * 0.03 : 1 + mi * 0.012
    const rd = riders * grow * season(mi, 9, 0.06) * jt()
    rows.push([mo, mi + 1, line, district, round(rd, 1), round(Math.min(0.99, ontime * jt() * (line === 'Red Line' ? 1 - mi * 0.004 : 1)), 3), round(rd * 22 * 2.1 * jt(), 0), Math.round(rd * 0.012 * jt() * 10)])
  })
)

const F = (p) => m('_Desk', p)
const D = (p) => col('Ridership', p)
const measures = [
  { name: 'Weekday Riders (k)', dax: 'SUM(Ridership[RidersK])', format: '#,0' },
  { name: 'Riders This Month', dax: 'CALCULATE(SUM(Ridership[RidersK]), Ridership[MonthNo] = MAX(Ridership[MonthNo]))', format: '#,0"k"' },
  { name: 'On-Time %', dax: 'AVERAGE(Ridership[OnTime])', format: '0.0%' },
  { name: 'Fare Revenue', dax: 'SUM(Ridership[FareRevenueK]) / 1000', format: '\\$#,0.0"M"' },
  { name: 'Complaints', dax: 'SUM(Ridership[Complaints])', format: '#,0' },
  { name: 'Growth', dax: 'VAR m = MAX(Ridership[MonthNo]) VAR a = CALCULATE(SUM(Ridership[RidersK]), Ridership[MonthNo] = m) VAR b = CALCULATE(SUM(Ridership[RidersK]), Ridership[MonthNo] = 1) RETURN DIVIDE(a - b, b)', format: '+0%;-0%' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720
const rule = (x1, x2, y, w = 1) => `<path d="M${x1} ${y}H${x2}" stroke="${T.ink}" stroke-width="${w}"/>`
const vrule = (x, y1, y2, w = 0.7) => `<path d="M${x} ${y1}V${y2}" stroke="${T.ink}" stroke-width="${w}"/>`

function fleuron(cx, cy, s, color = T.ink) {
  // a simple printer's ornament: two mirrored leaves and a dot
  const leaf = (dir) => `<path d="M${cx} ${cy}C${f(cx + dir * 6 * s)} ${f(cy - 7 * s)} ${f(cx + dir * 16 * s)} ${f(cy - 5 * s)} ${f(cx + dir * 20 * s)} ${cy}C${f(cx + dir * 16 * s)} ${f(cy + 5 * s)} ${f(cx + dir * 6 * s)} ${f(cy + 7 * s)} ${cx} ${cy}Z" fill="${color}"/>`
  return leaf(1) + leaf(-1) + `<circle cx="${f(cx + 25 * s)}" cy="${cy}" r="${f(2 * s)}" fill="${color}"/><circle cx="${f(cx - 25 * s)}" cy="${cy}" r="${f(2 * s)}" fill="${color}"/>`
}

const bg = svg(
  W,
  H,
  `<rect width="${W}" height="${H}" fill="${T.bg}"/><rect width="${W}" height="${H}" fill="url(#news)"/>` +
    // masthead rules
    rule(40, 1240, 104, 3) + rule(40, 1240, 108.5, 0.8) + rule(40, 1240, 130, 0.8) +
    // ears
    `<rect x="40" y="22" width="170" height="70" fill="none" stroke="${T.ink}" stroke-width="0.8"/><rect x="1070" y="22" width="170" height="70" fill="none" stroke="${T.ink}" stroke-width="0.8"/>` +
    fleuron(640, 100, 0.5, T.bg) +
    // column rules
    vrule(830, 142, 470) + vrule(436, 486, 688) + vrule(830, 486, 688) +
    rule(40, 1240, 478, 1.6) + rule(40, 1240, 482, 0.5) +
    // sidebar box
    `<rect x="850" y="146" width="390" height="318" fill="none" stroke="${T.ink}" stroke-width="1.2"/><rect x="854" y="150" width="382" height="310" fill="none" stroke="${T.ink}" stroke-width="0.5"/>` +
    `<rect x="850" y="146" width="390" height="30" fill="${T.ink}"/>` +
    [244, 314, 384].map((y) => `<path d="M870 ${y}H1220" stroke="${T.grid}" stroke-width="0.8"/>`).join('') +
    fleuron(1045, 700, 0.55) +
    rule(40, 1240, 694, 0.8),
  `<pattern id="news" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.45" fill="#E4DED1"/></pattern>`
)

function streetcar() {
  // engraved line drawing: body, windows, roof, pantograph, wheels, rails, hatching
  const L = (d, w = 1.4) => `<path d="${d}" fill="none" stroke="${T.ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
  let o = ''
  o += L('M20 60H300V138H20Z', 2)
  o += L('M14 60Q160 40 306 60', 2)
  o += L('M120 46L150 18L190 46M150 18H210', 1.4)
  for (let i = 0; i < 6; i++) o += L(`M${34 + i * 44} 72H${68 + i * 44}V104H${34 + i * 44}Z`, 1.2)
  o += L('M20 116H300', 1)
  for (let x = 24; x < 300; x += 5) o += `<path d="M${x} 118L${x + 6} 136" stroke="${T.ink}" stroke-width="0.6"/>`
  o += [60, 100, 220, 260].map((x) => `<circle cx="${x}" cy="146" r="11" fill="${T.bg}" stroke="${T.ink}" stroke-width="1.6"/><circle cx="${x}" cy="146" r="3" fill="${T.ink}"/>`).join('')
  o += L('M0 158H320', 1.6) + L('M0 163H320', 0.6)
  for (let x = 6; x < 320; x += 16) o += `<path d="M${x} 158V163" stroke="${T.ink}" stroke-width="0.6"/>`
  // window hatching
  for (let i = 0; i < 6; i++) for (let k = 0; k < 4; k++) o += `<path d="M${36 + i * 44 + k * 8} 102L${44 + i * 44 + k * 8} 74" stroke="${T.ink}" stroke-width="0.4" opacity="0.7"/>`
  o += `<rect x="140" y="84" width="40" height="12" fill="${T.red}"/>`
  return svg(320, 170, o)
}

// ---------------------------------------------------------------- page
const smallHead = (text) => ({ show: true, text, fontFamily: 'Georgia', fontSize: 12, bold: true, fontColor: c(T.ink) })
const kicker = (k, name, x, y, w, text, color = T.red) => k.text({ name, x, y, w, h: 18, runs: [{ text, font: 'Segoe UI Semibold', size: 8, color }] })

function stat(k, i, label, value) {
  const y = 186 + i * 70
  return [
    k.text({ name: `st${i}-l`, x: 870, y: y + 2, w: 180, h: 40, runs: [{ text: label, font: 'Georgia', size: 10.5, italic: true, color: T.muted }] }),
    k.card({ name: `st${i}-v`, x: 1030, y: y - 6, w: 196, h: 54, field: F(value), size: 28, font: 'Georgia', bold: true, color: i === 0 ? T.red : T.ink, align: 'right' })
  ]
}

export default {
  order: 7,
  id: 'broadsheet',
  name: 'Broadsheet',
  style: 'Editorial',
  compatibility: 'powerbi',
  summary: 'A newspaper front page: masthead and ears, a lead chart with headline and drop cap, spot red',
  description:
    'Transit ridership reported like a broadsheet front page: masthead with ears and a dateline, a lead story with headline, deck and drop cap built around the main chart, an engraved streetcar, a boxed "By the numbers" sidebar and a below-the-fold row of small charts and a line report. Opens in Power BI Desktop as is.',
  swatch: [T.bg, T.ink, T.red, T.grid],
  theme: themeOf(T),
  measures: { table: '_Desk', list: measures },
  tables: [
    {
      name: 'Ridership',
      columns: [
        ...monthColumns,
        { name: 'Line', type: 'string' },
        { name: 'District', type: 'string' },
        { name: 'RidersK', type: 'double', format: '#,0.0' },
        { name: 'OnTime', type: 'double', format: '0.0%', summarize: 'average' },
        { name: 'FareRevenueK', type: 'double', format: '#,0' },
        { name: 'Complaints', type: 'int64' }
      ],
      rows
    }
  ],
  resources: { 'broadsheet-bg.svg': bg, 'broadsheet-streetcar.svg': streetcar() },
  pages: [
    {
      name: 'Front Page',
      background: { color: T.bg, image: 'broadsheet-bg.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        const lineColors = { 'Red Line': T.red, 'Blue Line': T.ink, 'Green Line': '#7A746A', 'Gold Line': '#B8B0A0', 'Harbor Ferry': '#3C3C3C', 'Crosstown Bus': '#D9786F' }
        return [
          // masthead
          k.text({ name: 'ear-l', x: 48, y: 28, w: 156, h: 60, paragraphs: [{ runs: [{ text: 'TRANSIT DESK', font: 'Segoe UI Semibold', size: 7.5, color: T.red }] }, { runs: [{ text: 'Every line, every stop, every month.', font: 'Georgia', size: 9, italic: true, color: T.ink }] }] }),
          k.text({ name: 'masthead', x: 230, y: 14, w: 820, h: 70, align: 'center', runs: [{ text: 'The Metro Courier', font: 'Georgia', size: 40, bold: true, color: T.ink }] }),
          k.text({ name: 'ear-r', x: 1078, y: 28, w: 156, h: 20, align: 'right', runs: [{ text: 'DISTRICT EDITION', font: 'Segoe UI Semibold', size: 7.5, color: T.red }] }),
          k.text({ name: 'dateline', x: 40, y: 110, w: 600, h: 20, runs: [{ text: 'VOL. XII  ·  NO. 318  ·  CITY EDITION', font: 'Segoe UI Semibold', size: 7.5, color: T.ink }] }),
          k.text({ name: 'dateline-r', x: 840, y: 110, w: 400, h: 20, align: 'right', runs: [{ text: 'SAMPLE DATA  ·  REPLACE WITH YOUR OWN', font: 'Segoe UI Semibold', size: 7.5, color: T.ink }] }),
          k.slicer({ name: 'district', x: 1076, y: 48, w: 160, h: 38, field: D('District'), header: false, font: 'Georgia', size: 9, itemBg: T.bg, outline: 'None' }),

          // lead story
          kicker(k, 'lead-k', 40, 146, 400, 'RIDERSHIP  ·  ANNUAL REVIEW'),
          k.text({ name: 'lead-h', x: 40, y: 162, w: 560, h: 74, runs: [{ text: 'Riders return to the rails for an eighth straight month', font: 'Georgia', size: 22, bold: true, color: T.ink }] }),
          k.text({ name: 'lead-d', x: 40, y: 234, w: 560, h: 40, runs: [{ text: 'Harbor Ferry and the Gold Line carry the gains while on-time running slips on the busiest corridor.', font: 'Georgia', size: 11.5, italic: true, color: T.muted }] }),
          k.img({ name: 'streetcar', x: 620, y: 150, w: 196, h: 104, src: 'broadsheet-streetcar.svg' }),
          k.text({
            name: 'lead-body',
            x: 40,
            y: 282,
            w: 220,
            h: 186,
            paragraphs: [
              { runs: [{ text: 'By the Data Desk', font: 'Segoe UI Semibold', size: 7.5, color: T.red }] },
              {
                runs: [
                  { text: 'WEEKDAY RIDERSHIP ', font: 'Georgia', size: 9.5, bold: true, color: T.ink },
                  { text: 'grew across the network this year. Use this column for the story behind the numbers: what changed, where, and what to watch next month. Keep it short; the chart carries the detail.', font: 'Georgia', size: 9.5, color: T.ink }
                ]
              }
            ]
          }),
          k.line({ name: 'lead-chart', x: 276, y: 270, w: 548, h: 180, cat: D('Month'), val: [F('Weekday Riders (k)')], series: D('Line'), colorMap: lineColors, legend: 'Top', width: 1.8, markers: false, axisColor: T.muted }),
          k.text({ name: 'fig1', x: 280, y: 450, w: 540, h: 18, runs: [{ text: 'FIG. 1', font: 'Segoe UI Semibold', size: 7, color: T.red }, { text: '  Weekday riders by line, thousands', font: 'Georgia', size: 8, italic: true, color: T.muted }] }),

          // sidebar
          k.text({ name: 'side-h', x: 850, y: 151, w: 390, h: 22, align: 'center', runs: [{ text: 'BY THE NUMBERS', font: 'Segoe UI Semibold', size: 9, color: T.bg }] }),
          ...stat(k, 0, 'weekday riders this month', 'Riders This Month'),
          ...stat(k, 1, 'growth since January', 'Growth'),
          ...stat(k, 2, 'trains and boats on time', 'On-Time %'),
          ...stat(k, 3, 'collected in fares', 'Fare Revenue'),

          // below the fold
          kicker(k, 'b1-k', 40, 490, 380, 'PUNCTUALITY'),
          k.column({ name: 'b1', x: 36, y: 504, w: 390, h: 184, horizontal: true, cat: D('Line'), val: [F('On-Time %')], colorMap: lineColors, labels: true, labelColor: '#FFFFFF', labelPos: 'InsideEnd', yAxis: false, grid: false, sort: { field: F('On-Time %') }, box: { title: smallHead('Which lines keep to time') } }),
          kicker(k, 'b2-k', 452, 490, 360, 'FARES'),
          k.column({ name: 'b2', x: 448, y: 504, w: 376, h: 184, cat: D('District'), val: [F('Fare Revenue')], colors: [T.ink], labels: true, yAxis: false, grid: false, sort: { field: F('Fare Revenue') }, box: { title: smallHead('Fare revenue by district') } }),
          kicker(k, 'b3-k', 850, 490, 380, 'LINE REPORT'),
          k.table({
            name: 'b3',
            x: 846,
            y: 506,
            w: 394,
            h: 182,
            fields: [as(D('Line'), 'Line'), as(F('Weekday Riders (k)'), 'Riders (k)'), as(F('On-Time %'), 'On time'), as(F('Complaints'), 'Complaints')],
            headBg: T.bg,
            headColor: T.ink,
            headFont: 'Segoe UI Semibold',
            rowBg: T.bg,
            color: T.ink,
            font: 'Georgia',
            size: 9.5,
            lineColor: T.grid,
            rowPadding: 3,
            sort: { field: F('Weekday Riders (k)') }
          })
        ]
      }
    }
  ]
}

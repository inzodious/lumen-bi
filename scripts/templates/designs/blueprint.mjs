/**
 * Blueprint: an engineering drawing sheet. Cyanotype blue with a fine grid, a bordered sheet with zone
 * marks, a dimensioned CAD drawing of a gear, crop-marked panels, Consolas throughout and a classic
 * title block in the corner. Plant OEE data. Power BI compatible.
 */
import { kit, themeOf, colorMap } from '../kit.mjs'
import { m, col, as, c, rng } from '../lib.mjs'
import { svg, f, pathOf } from '../art.mjs'
import { jitter, round } from '../data.mjs'

const T = {
  bg: '#123E7C',
  ink: '#EAF2FF',
  muted: '#9DB9E6',
  grid: '#2D5FA3',
  yellow: '#FFD23F',
  red: '#FF6B4A',
  colors: ['#EAF2FF', '#FFD23F', '#7FD1FF', '#FF6B4A', '#9DB9E6', '#B7F0C4', '#5C8FD6', '#FFE9A3'],
  fontBody: 'Consolas',
  fontHead: 'Consolas',
  fontNum: 'Consolas'
}

// ---------------------------------------------------------------- data
const LINES = [
  ['Press A', 0.91, 0.88, 0.985],
  ['Press B', 0.86, 0.9, 0.975],
  ['Weld 1', 0.88, 0.82, 0.968],
  ['Weld 2', 0.93, 0.85, 0.972],
  ['Paint', 0.8, 0.78, 0.94],
  ['Assembly', 0.9, 0.92, 0.991]
]
const SHIFTS = [
  ['Day', 1.0],
  ['Swing', 0.97],
  ['Night', 0.92]
]
const CAUSES = [
  ['Changeover', 0.3],
  ['Jam', 0.22],
  ['Material', 0.16],
  ['Maintenance', 0.14],
  ['Quality hold', 0.1],
  ['Other', 0.08]
]
const prod = []
const down = []
const jt = jitter('blueprint', 0.04)
const r = rng('blueprint-d')
LINES.forEach(([line, av, pf, q]) =>
  SHIFTS.forEach(([shift, k]) => {
    for (let wk = 1; wk <= 12; wk++) {
      const planned = 2400
      const run = planned * Math.min(0.99, av * k * jt())
      const ideal = run * 1.2
      const actual = ideal * Math.min(0.99, pf * jt())
      const good = actual * Math.min(0.999, q * jt())
      prod.push([wk, `W${String(wk).padStart(2, '0')}`, line, shift, planned, Math.round(run), Math.round(ideal), Math.round(actual), Math.round(good)])
      if (shift === 'Day') CAUSES.forEach(([cause, w]) => down.push([wk, line, cause, Math.round((planned - run) * 3 * w * (0.6 + r() * 0.8))]))
    }
  })
)

const F = (p) => m('_OEE', p)
const D = (p) => col('Production', p)
const X = (p) => col('Downtime', p)
const measures = [
  { name: 'Availability', dax: 'DIVIDE(SUM(Production[RunMin]), SUM(Production[PlannedMin]))', format: '0.0%' },
  { name: 'Performance', dax: 'DIVIDE(SUM(Production[ActualUnits]), SUM(Production[IdealUnits]))', format: '0.0%' },
  { name: 'Quality', dax: 'DIVIDE(SUM(Production[GoodUnits]), SUM(Production[ActualUnits]))', format: '0.0%' },
  { name: 'OEE', dax: '[Availability] * [Performance] * [Quality]', format: '0.0%' },
  { name: 'OEE Target', dax: '0.85', format: '0%' },
  { name: 'Good Units', dax: 'SUM(Production[GoodUnits])', format: '#,0' },
  { name: 'Scrap Rate', dax: '1 - [Quality]', format: '0.00%' },
  { name: 'Downtime (h)', dax: 'SUM(Downtime[Minutes]) / 60', format: '#,0' },
  { name: 'OEE Note', dax: 'IF([OEE] >= [OEE Target], "AT OR ABOVE 85% TARGET", "GAP TO TARGET " & FORMAT([OEE Target] - [OEE], "0.0%"))' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720
const L = (d, w = 1, color = T.ink, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" ${extra}/>`
const txt = (x, y, s, size = 9, anchor = 'start', color = T.ink) => `<text x="${x}" y="${y}" font-family="Consolas, 'DejaVu Sans Mono', monospace" font-size="${size}" fill="${color}" text-anchor="${anchor}">${s}</text>`

function grid() {
  let minor = '', major = ''
  for (let x = 0; x <= W; x += 10) (x % 50 ? (minor += `M${x} 0V${H}`) : (major += `M${x} 0V${H}`))
  for (let y = 0; y <= H; y += 10) (y % 50 ? (minor += `M0 ${y}H${W}`) : (major += `M0 ${y}H${W}`))
  return L(minor, 0.4, '#1E4D8F') + L(major, 0.7, T.grid)
}

function frame() {
  let o = `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="${T.ink}" stroke-width="2"/><rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="${T.ink}" stroke-width="0.8"/>`
  const cols = 8, rows = 4
  for (let i = 1; i < cols; i++) {
    const x = 24 + ((W - 48) / cols) * i
    o += L(`M${f(x)} 16V24M${f(x)} ${H - 24}V${H - 16}`, 0.8)
  }
  for (let i = 0; i < cols; i++) {
    const x = 24 + ((W - 48) / cols) * (i + 0.5)
    o += txt(f(x), 22.5, String(i + 1), 7, 'middle') + txt(f(x), H - 17.5, String(i + 1), 7, 'middle')
  }
  for (let j = 1; j < rows; j++) {
    const y = 24 + ((H - 48) / rows) * j
    o += L(`M16 ${f(y)}H24M${W - 24} ${f(y)}H${W - 16}`, 0.8)
  }
  for (let j = 0; j < rows; j++) {
    const y = 24 + ((H - 48) / rows) * (j + 0.5)
    o += txt(20, f(y + 2.5), 'ABCD'[j], 7, 'middle') + txt(W - 20, f(y + 2.5), 'ABCD'[j], 7, 'middle')
  }
  return o
}

function crop(x, y, w, h) {
  const s = 10
  return L(`M${x - 4} ${y}H${x - 4 - s}M${x} ${y - 4}V${y - 4 - s}M${x + w + 4} ${y}H${x + w + 4 + s}M${x + w} ${y - 4}V${y - 4 - s}M${x - 4} ${y + h}H${x - 4 - s}M${x} ${y + h + 4}V${y + h + 4 + s}M${x + w + 4} ${y + h}H${x + w + 4 + s}M${x + w} ${y + h + 4}V${y + h + 4 + s}`, 1, T.yellow)
}

function dimension(x1, x2, y, label) {
  const a = 6
  return (
    L(`M${x1} ${y - 8}V${y + 8}M${x2} ${y - 8}V${y + 8}M${x1} ${y}H${x2}`, 0.8, T.muted) +
    `<path d="M${x1} ${y}l${a} -2.5v5zM${x2} ${y}l${-a} -2.5v5z" fill="${T.muted}"/>` +
    `<rect x="${(x1 + x2) / 2 - label.length * 3.2 - 4}" y="${y - 7}" width="${label.length * 6.4 + 8}" height="14" fill="${T.bg}"/>` +
    txt((x1 + x2) / 2, y + 3, label, 8, 'middle', T.muted)
  )
}

const KPI_X = [44, 230, 416, 602, 788]
const bg = svg(
  W,
  H,
  `<rect width="${W}" height="${H}" fill="${T.bg}"/>` +
    grid() +
    frame() +
    KPI_X.map((x) => crop(x, 108, 170, 100)).join('') +
    crop(44, 236, 450, 250) +
    crop(520, 236, 440, 250) +
    crop(44, 512, 540, 170) +
    crop(608, 512, 270, 170) +
    dimension(44, 958, 96, 'SHEET 1:1  ·  914') +
    // title block
    `<rect x="900" y="560" width="340" height="122" fill="${T.bg}" stroke="${T.ink}" stroke-width="1.6"/>` +
    L('M900 590H1240M900 622H1240M900 652H1240M1070 590V682M1155 622V682', 0.8) +
    txt(906, 598, 'TITLE', 6, 'start', T.muted) +
    txt(906, 630, 'DRAWN', 6, 'start', T.muted) +
    txt(1076, 630, 'DWG NO.', 6, 'start', T.muted) +
    txt(1161, 630, 'REV', 6, 'start', T.muted) +
    txt(906, 660, 'SCALE', 6, 'start', T.muted) +
    txt(1076, 660, 'SHEET', 6, 'start', T.muted) +
    txt(1161, 660, 'UNITS', 6, 'start', T.muted)
)

function gear() {
  const cx = 130, cy = 150, R = 92, r0 = 78, teeth = 18
  const pts = []
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2
    const da = (Math.PI * 2) / teeth
    const seq = [
      [r0, a0],
      [r0, a0 + da * 0.12],
      [R, a0 + da * 0.25],
      [R, a0 + da * 0.5],
      [r0, a0 + da * 0.63],
      [r0, a0 + da]
    ]
    for (const [rad, a] of seq) pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad])
  }
  let o = `<path d="${pathOf(pts, true)}" fill="none" stroke="${T.ink}" stroke-width="2"/>`
  o += `<circle cx="${cx}" cy="${cy}" r="60" fill="none" stroke="${T.ink}" stroke-width="1" stroke-dasharray="8 3 2 3"/>`
  o += `<circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="${T.ink}" stroke-width="2"/><path d="M${cx - 6} ${cy - 26}V${cy - 33}H${cx + 6}V${cy - 26}" fill="none" stroke="${T.ink}" stroke-width="2"/>`
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    o += `<circle cx="${f(cx + Math.cos(a) * 44)}" cy="${f(cy + Math.sin(a) * 44)}" r="7" fill="none" stroke="${T.ink}" stroke-width="1.4"/>`
  }
  // centre lines
  o += L(`M${cx - 112} ${cy}H${cx + 112}M${cx} ${cy - 112}V${cy + 112}`, 0.7, T.yellow, 'stroke-dasharray="14 4 3 4"')
  // dimensions
  o += L(`M${cx - R} ${cy + 104}V${cy + 128}M${cx + R} ${cy + 104}V${cy + 128}M${cx - R} ${cy + 122}H${cx + R}`, 0.8, T.muted)
  o += `<path d="M${cx - R} ${cy + 122}l6 -2.5v5zM${cx + R} ${cy + 122}l-6 -2.5v5z" fill="${T.muted}"/>` + txt(cx, cy + 117, 'Ø184', 9, 'middle', T.muted)
  o += L(`M${cx + 18} ${cy - 18}L${cx + 92} ${cy - 112}H${cx + 136}`, 0.8, T.muted) + txt(cx + 94, cy - 116, 'Ø52 H7', 8, 'start', T.muted)
  o += L(`M${cx + 44} ${cy + 26}L${cx + 96} ${cy + 100}H${cx + 136}`, 0.8, T.muted) + txt(cx + 98, cy + 96, '6× Ø14', 8, 'start', T.muted)
  // side section
  o += `<rect x="40" y="300" width="180" height="34" fill="url(#hatch)" stroke="${T.ink}" stroke-width="1.6"/><rect x="104" y="300" width="52" height="34" fill="${T.bg}" stroke="${T.ink}" stroke-width="1.6"/>`
  o += txt(130, 352, 'SECTION A–A', 8, 'middle', T.muted)
  return svg(
    270,
    362,
    o,
    `<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" stroke="${T.ink}" stroke-width="0.8"/></pattern>`
  )
}

// ---------------------------------------------------------------- page
const panelBox = { background: { color: c(T.bg) }, border: { color: c(T.ink), width: 1, radius: 0 }, padding: 10 }
const head = (text) => ({ show: true, text, fontFamily: 'Consolas', fontSize: 10, bold: true, fontColor: c(T.ink) })
const sub = (text) => ({ show: true, text, fontFamily: 'Consolas', fontSize: 7.5, fontColor: c(T.muted) })

function kpi(k, i, label, value, accent = T.ink, size = 26) {
  const x = KPI_X[i]
  return [
    k.shape({ name: `k${i}`, x, y: 108, w: 170, h: 100, box: panelBox }),
    k.text({ name: `k${i}-l`, x: x + 10, y: 116, w: 150, h: 18, runs: [{ text: `${String(i + 1).padStart(2, '0')} / ${label}`, font: 'Consolas', size: 7.5, color: T.muted }] }),
    k.card({ name: `k${i}-v`, x: x + 6, y: 140, w: 160, h: 50, field: F(value), size, font: 'Consolas', color: accent })
  ]
}

export default {
  order: 9,
  id: 'blueprint',
  name: 'Blueprint',
  style: 'Technical',
  compatibility: 'powerbi',
  summary: 'An engineering drawing sheet: cyanotype grid, zone-marked frame, CAD gear, title block',
  description:
    'Plant OEE reported on an engineering drawing sheet: cyanotype blue with a fine grid, a zone-marked frame, crop-marked panels, a dimensioned CAD drawing of a gear with a section view, Consolas type and a classic title block in the corner. OEE and its three factors, OEE by line against target, a downtime pareto, output by shift and a line table. Opens in Power BI Desktop as is.',
  swatch: [T.bg, T.ink, T.yellow, T.grid],
  theme: themeOf(T),
  measures: { table: '_OEE', list: measures },
  tables: [
    {
      name: 'Production',
      columns: [
        { name: 'WeekNo', type: 'int64', hidden: true, summarize: 'none' },
        { name: 'Week', type: 'string', sortBy: 'WeekNo' },
        { name: 'Line', type: 'string' },
        { name: 'Shift', type: 'string' },
        { name: 'PlannedMin', type: 'int64' },
        { name: 'RunMin', type: 'int64' },
        { name: 'IdealUnits', type: 'int64' },
        { name: 'ActualUnits', type: 'int64' },
        { name: 'GoodUnits', type: 'int64' }
      ],
      rows: prod
    },
    {
      name: 'Downtime',
      columns: [
        { name: 'WeekNo', type: 'int64', summarize: 'none' },
        { name: 'Line', type: 'string' },
        { name: 'Cause', type: 'string' },
        { name: 'Minutes', type: 'int64' }
      ],
      rows: down
    }
  ],
  resources: { 'blueprint-bg.svg': bg, 'blueprint-gear.svg': gear() },
  pages: [
    {
      name: 'Sheet 1',
      background: { color: T.bg, image: 'blueprint-bg.svg' },
      wallpaper: '#0C2C59',
      visuals: (seed) => {
        const k = kit(seed, T)
        return [
          k.text({ name: 'title', x: 44, y: 36, w: 640, h: 32, runs: [{ text: 'PLANT 04 // LINE PERFORMANCE', font: 'Consolas', size: 18, bold: true, color: T.ink }] }),
          k.text({ name: 'sub', x: 44, y: 66, w: 640, h: 20, runs: [{ text: 'OVERALL EQUIPMENT EFFECTIVENESS = AVAILABILITY × PERFORMANCE × QUALITY', font: 'Consolas', size: 8, color: T.yellow }] }),
          k.slicer({ name: 'shift', x: 700, y: 38, w: 258, h: 40, field: D('Shift'), mode: 'Basic', horizontal: true, header: false, font: 'Consolas', size: 8.5, color: T.ink, itemBg: T.bg, outline: 'Frame', outlineColor: T.ink }),
          ...kpi(k, 0, 'OEE', 'OEE', T.yellow),
          ...kpi(k, 1, 'AVAILABILITY', 'Availability'),
          ...kpi(k, 2, 'PERFORMANCE', 'Performance'),
          ...kpi(k, 3, 'QUALITY', 'Quality'),
          ...kpi(k, 4, 'GOOD UNITS', 'Good Units', T.ink, 20),
          k.card({ name: 'k0-n', x: 50, y: 186, w: 160, h: 20, field: F('OEE Note'), size: 6.5, font: 'Consolas', color: T.yellow }),
          k.img({ name: 'gear', x: 974, y: 34, w: 270, h: 362, src: 'blueprint-gear.svg' }),
          k.text({ name: 'gear-cap', x: 990, y: 400, w: 250, h: 40, paragraphs: [{ runs: [{ text: 'DETAIL 1 — DRIVE GEAR', font: 'Consolas', size: 8, bold: true, color: T.ink }] }, { runs: [{ text: 'Replace with your own part, plant or line drawing.', font: 'Consolas', size: 7, color: T.muted }] }] }),
          k.combo({ name: 'by-line', x: 44, y: 236, w: 450, h: 250, cat: D('Line'), columns: [F('OEE')], lines: [F('OEE Target')], colors: [T.ink, T.yellow], legend: 'TopRight', secondAxis: false, box: { ...panelBox, title: head('FIG. 2  OEE BY LINE VS TARGET') }, objects: { lineStyles: { strokeWidth: 2, showMarker: false, lineStyle: 'dashed' } } }),
          k.column({ name: 'pareto', x: 520, y: 236, w: 440, h: 250, horizontal: true, cat: X('Cause'), val: [F('Downtime (h)')], colors: [T.red], labels: true, yAxis: false, grid: false, sort: { field: F('Downtime (h)') }, box: { ...panelBox, title: head('FIG. 3  DOWNTIME PARETO (HOURS)') } }),
          k.line({ name: 'by-shift', x: 44, y: 512, w: 540, h: 170, cat: D('Week'), val: [F('OEE')], series: D('Shift'), colorMap: { Day: T.ink, Swing: '#7FD1FF', Night: T.yellow }, legend: 'TopRight', width: 1.6, markers: true, markerSize: 3, box: { ...panelBox, title: head('FIG. 4  OEE BY SHIFT, WEEKLY') } }),
          k.table({
            name: 'lines',
            x: 608,
            y: 512,
            w: 270,
            h: 170,
            fields: [as(D('Line'), 'LINE'), as(F('OEE'), 'OEE'), as(F('Scrap Rate'), 'SCRAP')],
            headBg: T.bg,
            headColor: T.yellow,
            headFont: 'Consolas',
            rowBg: T.bg,
            color: T.ink,
            font: 'Consolas',
            size: 9,
            lineColor: T.grid,
            rowPadding: 2,
            sort: { field: F('OEE') },
            box: { ...panelBox }
          }),
          k.text({ name: 'tb-head', x: 906, y: 566, w: 330, h: 20, runs: [{ text: 'OPS ANALYTICS  ·  DRAWING SHEET', font: 'Consolas', size: 8, bold: true, color: T.yellow }] }),
          k.text({ name: 'tb-title', x: 906, y: 600, w: 330, h: 22, runs: [{ text: 'PLANT OEE REVIEW — WEEKS 1–12', font: 'Consolas', size: 10, bold: true, color: T.ink }] }),
          k.text({ name: 'tb-drawn', x: 906, y: 632, w: 160, h: 20, runs: [{ text: 'OPS ANALYTICS', font: 'Consolas', size: 8, color: T.ink }] }),
          k.text({ name: 'tb-dwg', x: 1076, y: 632, w: 80, h: 20, runs: [{ text: 'LM-0420', font: 'Consolas', size: 8, color: T.ink }] }),
          k.text({ name: 'tb-rev', x: 1161, y: 632, w: 76, h: 20, runs: [{ text: 'C', font: 'Consolas', size: 8, color: T.yellow }] }),
          k.text({ name: 'tb-scale', x: 906, y: 662, w: 160, h: 20, runs: [{ text: '1:1', font: 'Consolas', size: 8, color: T.ink }] }),
          k.text({ name: 'tb-sheet', x: 1076, y: 662, w: 80, h: 20, runs: [{ text: '1 OF 1', font: 'Consolas', size: 8, color: T.ink }] }),
          k.text({ name: 'tb-units', x: 1161, y: 662, w: 76, h: 20, runs: [{ text: 'UNITS', font: 'Consolas', size: 8, color: T.ink }] })
        ]
      }
    }
  ]
}

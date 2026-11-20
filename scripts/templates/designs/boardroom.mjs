/**
 * Boardroom: ultra-professional executive brief. Ivory paper, ink navy, brass hairlines, Georgia
 * headings over Segoe figures, a guilloché rosette and laurel crest like an annual report.
 * Layout: masthead, a ruled statement row (no boxes), then ruled sections. Power BI compatible.
 */
import { kit, themeOf } from '../kit.mjs'
import { m, col, as } from '../lib.mjs'
import { svg, rosette, f, pathOf } from '../art.mjs'
import { MONTHS, monthColumns, cross, season, jitter, round } from '../data.mjs'

const T = {
  bg: '#F7F4EC',
  ink: '#0B1F3A',
  muted: '#5E6B7C',
  grid: '#D9D2C1',
  brass: '#A8834A',
  teal: '#2F6F73',
  colors: ['#0B1F3A', '#A8834A', '#2F6F73', '#8C9BB0', '#C9B48A', '#5E6B7C', '#6E8F92', '#3E4E66'],
  fontBody: 'Segoe UI',
  fontHead: 'Georgia',
  fontNum: 'Georgia',
  good: '#2F6F73',
  bad: '#9A3B2E'
}

// ---------------------------------------------------------------- data
const SEGMENTS = [
  ['Advisory', 38, 0.46, 0.21],
  ['Asset Management', 52, 0.58, 0.18],
  ['Insurance', 44, 0.34, 0.15],
  ['Lending', 61, 0.41, 0.17]
]
const REGIONS = [
  ['Americas', 1.0],
  ['EMEA', 0.72],
  ['Asia Pacific', 0.55]
]
const rows = []
const jt = jitter('boardroom')
for (const [year, growth] of [
  [2024, 1],
  [2025, 1.083]
])
  for (const [seg, base, gm, opex] of SEGMENTS)
    for (const [reg, w] of REGIONS)
      MONTHS.forEach((mo, mi) => {
        const rev = (base / 12) * w * season(mi, 11, 0.12) * growth * jt() * (1 + mi * 0.004)
        const budget = (base / 12) * w * season(mi, 11, 0.1) * 1.06 * (year === 2025 ? 1.05 : 1)
        rows.push([year, `Q${Math.floor(mi / 3) + 1}`, mo, mi + 1, seg, reg, round(rev), round(rev * (1 - gm * jt())), round(rev * opex * jt()), round(budget)])
      })

const F = (p) => m('_Measures', p)
const D = (p) => col('Finance', p)

const LATEST = (expr) => `CALCULATE(${expr}, Finance[Year] = MAX(Finance[Year]))`
const PRIOR = (expr) => `VAR y = MAX(Finance[Year]) RETURN CALCULATE(${expr}, Finance[Year] = y - 1)`

const measures = [
  { name: 'Revenue', dax: 'SUM(Finance[Revenue])', format: '\\$#,0.0"M"' },
  { name: 'Revenue FY', dax: LATEST('SUM(Finance[Revenue])'), format: '\\$#,0.0"M"' },
  { name: 'Budget FY', dax: LATEST('SUM(Finance[Budget])'), format: '\\$#,0.0"M"' },
  { name: 'Gross Margin FY', dax: LATEST('SUM(Finance[Revenue]) - SUM(Finance[COGS])'), format: '\\$#,0.0"M"' },
  { name: 'Gross Margin %', dax: "DIVIDE([Gross Margin FY], [Revenue FY])", format: '0.0%' },
  { name: 'Operating Income FY', dax: LATEST('SUM(Finance[Revenue]) - SUM(Finance[COGS]) - SUM(Finance[Opex])'), format: '\\$#,0.0"M"' },
  { name: 'Operating Margin %', dax: 'DIVIDE([Operating Income FY], [Revenue FY])', format: '0.0%' },
  { name: 'Revenue PY', dax: PRIOR('SUM(Finance[Revenue])'), format: '\\$#,0.0"M"' },
  { name: 'Revenue YoY %', dax: 'DIVIDE([Revenue FY] - [Revenue PY], [Revenue PY])', format: '+0.0%;-0.0%' },
  { name: 'vs Budget %', dax: 'DIVIDE([Revenue FY] - [Budget FY], [Budget FY])', format: '+0.0%;-0.0%' },
  { name: 'Operating Income PY', dax: PRIOR('SUM(Finance[Revenue]) - SUM(Finance[COGS]) - SUM(Finance[Opex])'), format: '\\$#,0.0"M"' },
  { name: 'Gross Margin % PY', dax: PRIOR('DIVIDE(SUM(Finance[Revenue]) - SUM(Finance[COGS]), SUM(Finance[Revenue]))'), format: '0.0%' },
  {
    name: 'Revenue Note',
    dax: 'VAR d = [Revenue YoY %] RETURN IF(ISBLANK(d), BLANK(), IF(d >= 0, "▲ ", "▼ ") & FORMAT(ABS(d), "0.0%") & " vs prior year")'
  },
  {
    name: 'Margin Note',
    dax: 'VAR d = [Gross Margin %] - [Gross Margin % PY] RETURN IF(ISBLANK([Gross Margin % PY]), BLANK(), IF(d >= 0, "▲ ", "▼ ") & FORMAT(ABS(d) * 10000, "0") & " bps vs prior year")'
  },
  {
    name: 'Income Note',
    dax: 'VAR d = DIVIDE([Operating Income FY] - [Operating Income PY], [Operating Income PY]) RETURN IF(ISBLANK(d), BLANK(), IF(d >= 0, "▲ ", "▼ ") & FORMAT(ABS(d), "0.0%") & " vs prior year")'
  },
  {
    name: 'Budget Note',
    dax: 'VAR d = [vs Budget %] RETURN IF(ISBLANK(d), BLANK(), IF(d >= 0, "Ahead of plan by ", "Behind plan by ") & FORMAT(ABS(d), "0.0%"))'
  },
  { name: 'Fiscal Year Label', dax: '"Fiscal year " & MAX(Finance[Year]) & "  ·  " & DISTINCTCOUNT(Finance[Segment]) & " segments  ·  " & DISTINCTCOUNT(Finance[Region]) & " regions"' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720
function laurel(cx, cy, r, color) {
  let out = ''
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const a = Math.PI / 2 + side * (0.35 + i * 0.27)
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
      const rot = (a * 180) / Math.PI + (side > 0 ? -35 : 35) + 90
      out += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r * 0.11)}" ry="${f(r * 0.26)}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})" fill="${color}"/>`
    }
  }
  const arc = (s) => {
    const pts = []
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI / 2 + s * (0.2 + (i / 40) * 2.45)
      pts.push([cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86])
    }
    return `<path d="${pathOf(pts)}" fill="none" stroke="${color}" stroke-width="1.4"/>`
  }
  return out + arc(-1) + arc(1)
}
function compass(cx, cy, r, color) {
  const pts = []
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 8
    const rad = i % 4 === 0 ? r : i % 2 === 0 ? r * 0.55 : r * 0.22
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad])
  }
  return `<circle cx="${cx}" cy="${cy}" r="${f(r * 1.12)}" fill="none" stroke="${color}" stroke-width="0.8"/><path d="${pathOf(pts, true)}" fill="${color}"/>`
}

const crest = svg(
  96,
  96,
  `<circle cx="48" cy="48" r="45" fill="none" stroke="${T.brass}" stroke-width="1"/><circle cx="48" cy="48" r="41.5" fill="none" stroke="${T.brass}" stroke-width="0.5"/>` +
    laurel(48, 50, 30, T.brass) +
    compass(48, 46, 15, T.ink)
)

function page(sections) {
  const rule = (x1, x2, y, color = T.ink, w = 0.8) => `<path d="M${x1} ${y}H${x2}" stroke="${color}" stroke-width="${w}"/>`
  let b = `<rect width="${W}" height="${H}" fill="${T.bg}"/>`
  // paper grain: faint horizontal laid lines
  for (let y = 4; y < H; y += 6) b += `<path d="M0 ${y}H${W}" stroke="#E9E3D4" stroke-width="0.4" opacity="0.55"/>`
  b += `<rect width="${W}" height="7" fill="${T.ink}"/><rect y="7" width="${W}" height="1.5" fill="${T.brass}"/>`
  b += `<g>${rosette(1168, 62, 92, { stroke: T.ink, width: 0.45, opacity: 0.22, loops: 24, layers: 4 })}</g>`
  b += rule(40, 1240, 124, T.ink, 1.4) + rule(40, 1240, 128.5, T.brass, 0.6)
  b += sections
  b += rule(40, 1240, 690, T.grid, 0.8)
  return svg(W, H, b)
}

const overviewBg = page(
  // statement row separators
  [340, 640, 940].map((x) => `<path d="M${x} 146V254" stroke="${T.grid}" stroke-width="0.8"/>`).join('') +
    `<path d="M40 270H1240" stroke="${T.grid}" stroke-width="0.8"/>` +
    // section rules
    [
      [40, 800, 312],
      [840, 1240, 312],
      [40, 800, 540],
      [840, 1240, 540]
    ]
      .map(([a, b2, y]) => `<path d="M${a} ${y}H${b2}" stroke="${T.ink}" stroke-width="0.9"/><path d="M${a} ${y}H${a + 28}" stroke="${T.brass}" stroke-width="3"/>`)
      .join('') +
    `<path d="M820 292V676" stroke="${T.grid}" stroke-width="0.8"/>`
)

const segmentsBg = page(
  [
    [40, 620, 196],
    [660, 1240, 196],
    [40, 620, 466],
    [660, 1240, 466]
  ]
    .map(([a, b2, y]) => `<path d="M${a} ${y}H${b2}" stroke="${T.ink}" stroke-width="0.9"/><path d="M${a} ${y}H${a + 28}" stroke="${T.brass}" stroke-width="3"/>`)
    .join('') + `<path d="M640 176V676" stroke="${T.grid}" stroke-width="0.8"/>`
)

// ---------------------------------------------------------------- pages
function masthead(k, title, kicker) {
  return [
    k.img({ name: 'crest', x: 40, y: 22, w: 84, h: 84, src: 'boardroom-crest.svg' }),
    k.text({ name: 'kicker', x: 140, y: 26, w: 520, h: 20, runs: [{ text: kicker, font: 'Segoe UI Semibold', size: 8.5, color: T.brass }] }),
    k.text({ name: 'title', x: 140, y: 44, w: 620, h: 44, runs: [{ text: title, font: 'Georgia', size: 25, color: T.ink }] }),
    k.card({ name: 'fy', x: 136, y: 88, w: 560, h: 26, field: F('Fiscal Year Label'), size: 10.5, font: 'Georgia', italic: true, color: T.muted }),
    k.slicer({ name: 'year', x: 760, y: 50, w: 150, h: 54, field: D('Year'), header: 'FISCAL YEAR', headFont: 'Segoe UI Semibold', itemBg: '#FFFFFF', outline: 'Frame', outlineColor: T.grid }),
    k.slicer({ name: 'region', x: 924, y: 50, w: 150, h: 54, field: D('Region'), header: 'REGION', headFont: 'Segoe UI Semibold', itemBg: '#FFFFFF', outline: 'Frame', outlineColor: T.grid })
  ]
}

function sectionHead(k, name, x, y, w, title, note) {
  return [
    k.text({ name: `${name}-h`, x, y, w: w * 0.62, h: 24, runs: [{ text: title, font: 'Georgia', size: 13, color: T.ink }] }),
    note ? k.text({ name: `${name}-n`, x: x + w * 0.62, y: y + 5, w: w * 0.38, h: 18, align: 'right', runs: [{ text: note, font: 'Segoe UI Semibold', size: 7.5, color: T.muted }] }) : null
  ]
}

function statement(k, i, label, value, note, spark) {
  const x = 40 + i * 300 + (i ? 22 : 0)
  return [
    k.text({ name: `s${i}-l`, x, y: 146, w: 200, h: 18, runs: [{ text: label, font: 'Segoe UI Semibold', size: 8, color: T.muted }] }),
    k.card({ name: `s${i}-v`, x: x - 4, y: 164, w: 180, h: 54, field: F(value), size: 30, font: 'Georgia', color: T.ink }),
    k.card({ name: `s${i}-d`, x: x - 4, y: 222, w: 250, h: 24, field: F(note), size: 9, font: 'Segoe UI Semibold', color: T.teal }),
    k.line({ name: `s${i}-sp`, x: x + 172, y: 166, w: 100, h: 50, xAxis: false, yAxis: false, grid: false, scalar: true, cat: D('MonthNo'), val: [F(spark)], colors: [i % 2 ? T.brass : T.ink], width: 1.5 })
  ]
}

export default {
  order: 1,
  id: 'boardroom',
  name: 'Boardroom',
  style: 'Professional',
  compatibility: 'powerbi',
  summary: 'Annual-report executive brief: ruled statement figures, serif headings, brass hairlines',
  description: 'An executive financial brief on ivory paper: a crested masthead, a ruled row of headline figures with sparklines, revenue against budget, an operating income bridge, a segment scorecard and a segment deep-dive page. Opens in Power BI Desktop as is.',
  swatch: [T.bg, T.ink, T.brass, T.teal],
  theme: themeOf(T),
  measures: { table: '_Measures', list: measures },
  tables: [
    {
      name: 'Finance',
      columns: [
        { name: 'Year', type: 'int64', summarize: 'none' },
        { name: 'Quarter', type: 'string' },
        ...monthColumns,
        { name: 'Segment', type: 'string' },
        { name: 'Region', type: 'string' },
        { name: 'Revenue', type: 'double', format: '#,0.00' },
        { name: 'COGS', type: 'double', format: '#,0.00' },
        { name: 'Opex', type: 'double', format: '#,0.00' },
        { name: 'Budget', type: 'double', format: '#,0.00' }
      ],
      rows
    }
  ],
  resources: { 'boardroom-crest.svg': crest, 'boardroom-overview.svg': overviewBg, 'boardroom-segments.svg': segmentsBg },
  pages: [
    {
      name: 'Overview',
      background: { color: T.bg, image: 'boardroom-overview.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        return [
          ...masthead(k, 'Quarterly Performance Review', 'EXECUTIVE BRIEF  ·  BOARD OF DIRECTORS'),
          ...statement(k, 0, 'REVENUE', 'Revenue FY', 'Revenue Note', 'Revenue FY'),
          ...statement(k, 1, 'GROSS MARGIN', 'Gross Margin %', 'Margin Note', 'Gross Margin %'),
          ...statement(k, 2, 'OPERATING INCOME', 'Operating Income FY', 'Income Note', 'Operating Income FY'),
          ...statement(k, 3, 'AGAINST BUDGET', 'vs Budget %', 'Budget Note', 'Budget FY'),
          ...sectionHead(k, 'rev', 40, 286, 760, 'Revenue against budget', 'MONTHLY  ·  USD MILLIONS'),
          k.line({ name: 'rev-chart', x: 34, y: 318, w: 772, h: 190, cat: D('Month'), val: [F('Revenue FY'), F('Budget FY')], colors: [T.ink, T.brass], legend: 'TopRight', width: 2.2, markers: true }),
          ...sectionHead(k, 'bridge', 840, 286, 400, 'Operating income by segment', 'USD MILLIONS'),
          k.waterfall({ name: 'bridge-chart', x: 836, y: 318, w: 408, h: 186, cat: D('Segment'), val: F('Operating Income FY'), up: T.teal, down: '#9A3B2E', total: T.ink, labels: true, axisSize: 7.5 }),
          ...sectionHead(k, 'score', 40, 514, 760, 'Segment scorecard', 'FISCAL YEAR TO DATE'),
          k.table({
            name: 'score-table',
            x: 40,
            y: 546,
            w: 760,
            h: 136,
            fields: [D('Segment'), as(F('Revenue FY'), 'Revenue'), as(F('Revenue YoY %'), 'Growth'), as(F('Gross Margin %'), 'Gross margin'), as(F('Operating Income FY'), 'Op. income'), as(F('Operating Margin %'), 'Op. margin'), as(F('vs Budget %'), 'vs Budget')],
            headFont: 'Segoe UI Semibold',
            rowPadding: 3,
            sort: { field: F('Revenue FY') }
          }),
          ...sectionHead(k, 'region', 840, 514, 400, 'Revenue by region', 'SHARE OF TOTAL'),
          k.column({ name: 'region-chart', x: 836, y: 546, w: 408, h: 136, horizontal: true, cat: D('Region'), val: [F('Revenue FY')], colors: [T.ink], labels: true, labelColor: '#FFFFFF', labelPos: 'InsideEnd', yAxis: false, grid: false, sort: { field: F('Revenue FY') } }),
          k.text({ name: 'foot', x: 40, y: 694, w: 700, h: 18, runs: [{ text: 'Prepared for the Board of Directors  ·  Figures in USD millions  ·  Sample data', font: 'Segoe UI', size: 7.5, color: T.muted }] }),
          k.text({ name: 'folio', x: 1040, y: 694, w: 200, h: 18, align: 'right', runs: [{ text: 'I', font: 'Georgia', size: 8, italic: true, color: T.brass }] })
        ]
      }
    },
    {
      name: 'Segments',
      background: { color: T.bg, image: 'boardroom-segments.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        return [
          ...masthead(k, 'Segment Deep Dive', 'EXECUTIVE BRIEF  ·  SEGMENT ANALYSIS'),
          k.text({
            name: 'lede',
            x: 40,
            y: 140,
            w: 1200,
            h: 30,
            runs: [{ text: 'Each business line against plan and prior year: where revenue is earned, where margin is made, and how the cost base is shaped.', font: 'Georgia', size: 11, italic: true, color: T.muted }]
          }),
          ...sectionHead(k, 'q', 40, 170, 580, 'Revenue by quarter', 'USD MILLIONS'),
          k.matrix({ name: 'q-matrix', x: 40, y: 204, w: 580, h: 240, rows: [D('Segment')], columns: [D('Quarter')], values: [F('Revenue FY')], headFont: 'Segoe UI Semibold', rowPadding: 6, size: 10, subtotals: true }),
          ...sectionHead(k, 'mix', 660, 170, 580, 'Revenue mix by region', 'SHARE OF SEGMENT'),
          k.column({ name: 'mix-chart', x: 656, y: 204, w: 588, h: 240, horizontal: true, stacked: true, pct: true, cat: D('Segment'), val: [F('Revenue FY')], series: D('Region'), legend: 'TopRight', yAxis: false, grid: false, labels: true, labelColor: '#FFFFFF' }),
          ...sectionHead(k, 'yoy', 40, 440, 580, 'Growth against prior year', 'YEAR OVER YEAR'),
          k.column({ name: 'yoy-chart', x: 36, y: 474, w: 588, h: 206, cat: D('Segment'), val: [F('Revenue YoY %')], colors: [T.teal], labels: true, yAxis: false, grid: false }),
          ...sectionHead(k, 'margin', 660, 440, 580, 'Operating margin by month', 'FISCAL YEAR'),
          k.line({ name: 'margin-chart', x: 656, y: 474, w: 588, h: 206, cat: D('Month'), val: [F('Operating Margin %')], series: D('Segment'), legend: 'TopRight', width: 1.8 }),
          k.text({ name: 'foot', x: 40, y: 694, w: 700, h: 18, runs: [{ text: 'Prepared for the Board of Directors  ·  Figures in USD millions  ·  Sample data', font: 'Segoe UI', size: 7.5, color: T.muted }] }),
          k.text({ name: 'folio', x: 1040, y: 694, w: 200, h: 18, align: 'right', runs: [{ text: 'II', font: 'Georgia', size: 8, italic: true, color: T.brass }] })
        ]
      }
    }
  ]
}

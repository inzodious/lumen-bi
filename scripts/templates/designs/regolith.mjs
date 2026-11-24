/**
 * Regolith: deep-space mining operations. Basalt-dark command deck with a cratered asteroid on the horizon and a
 * molten copper glow, a navigation rail on the left (page navigator, filters), panels with a copper edge glow
 * (Lumen_Style), Barlow and Roboto Condensed (fonts bundled with Lumen). Lumen-only: Power BI shows the panels as
 * plain dark boxes. The live dashboard built from it (scripts/dashboards/designs/regolith.mjs) shows off every
 * Lumen page transition.
 */
import { kit, themeOf } from '../kit.mjs'
import { as, c, col, m, rng } from '../lib.mjs'
import { f, pathOf, stars, svg } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round } from '../data.mjs'

export const T = {
  bg: '#0A0C10',
  panel: '#11151B',
  ink: '#EEF1F5',
  muted: '#8B95A5',
  grid: '#262D37',
  copper: '#FF7A3D',
  gold: '#FFC24B',
  teal: '#2FD6C3',
  ice: '#7FB8FF',
  violet: '#A48BFF',
  rose: '#FF5C7A',
  colors: ['#FF7A3D', '#2FD6C3', '#FFC24B', '#7FB8FF', '#A48BFF', '#FF5C7A', '#C9D1DC', '#6EE7A0'],
  fontBody: 'Barlow',
  fontHead: 'Barlow Semibold',
  fontNum: 'Barlow',
  good: '#2FD6C3',
  bad: '#FF5C7A'
}

export const W = 1280
export const H = 720
/** Left rail width and the content area. */
export const RAIL = 208
export const X0 = 228
export const X1 = 1256

// ---------------------------------------------------------------- art
function asteroid(cx, cy, R) {
  const r = rng('regolith-asteroid')
  const pts = []
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const rad = R * (0.92 + r() * 0.1 + 0.04 * Math.sin(a * 3))
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.94])
  }
  let craters = ''
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(r()) * R * 0.8
    const s = R * (0.03 + r() * 0.09)
    const x = cx + Math.cos(a) * d
    const y = cy + Math.sin(a) * d * 0.94
    craters += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s)}" fill="#05070A" opacity="0.45"/><circle cx="${f(x - s * 0.25)}" cy="${f(y - s * 0.25)}" r="${f(s * 0.8)}" fill="none" stroke="#3A332E" stroke-opacity="0.6" stroke-width="0.8"/>`
  }
  return `<path d="${pathOf(pts, true)}" fill="url(#rock)"/>${craters}<path d="${pathOf(pts, true)}" fill="url(#shade)"/><path d="${pathOf(pts, true)}" fill="none" stroke="${T.copper}" stroke-opacity="0.35" stroke-width="1.2"/>`
}

/** Hex-cut corner ticks around a box (decoration drawn into the backdrop under a panel). */
function corners(x, y, w, h, color = T.copper, op = 0.55, s = 10) {
  const p = (d) => `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="1.4"/>`
  return p(`M${x} ${y + s}V${y}H${x + s}`) + p(`M${x + w - s} ${y}H${x + w}V${y + s}`) + p(`M${x} ${y + h - s}V${y + h}H${x + s}`) + p(`M${x + w - s} ${y + h}H${x + w}V${y + h - s}`)
}

const defs =
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07090D"/><stop offset="1" stop-color="#0D0F14"/></linearGradient>` +
  `<radialGradient id="melt" cx="1040" cy="820" r="620" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${T.copper}" stop-opacity="0.34"/><stop offset="0.45" stop-color="#8A2E12" stop-opacity="0.16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="vein" cx="360" cy="-60" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${T.teal}" stop-opacity="0.13"/><stop offset="1" stop-color="${T.teal}" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="rock" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#5A4B40"/><stop offset="0.6" stop-color="#2B2420"/><stop offset="1" stop-color="#14110F"/></radialGradient>` +
  `<radialGradient id="shade" cx="0.75" cy="0.85" r="0.9"><stop offset="0.35" stop-color="#05070A" stop-opacity="0"/><stop offset="1" stop-color="#05070A" stop-opacity="0.9"/></radialGradient>` +
  `<linearGradient id="rail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0E1116"/><stop offset="1" stop-color="#0B0E12"/></linearGradient>` +
  `<linearGradient id="rule" x1="0" x2="1"><stop offset="0" stop-color="${T.copper}" stop-opacity="0.9"/><stop offset="0.55" stop-color="${T.gold}" stop-opacity="0.35"/><stop offset="1" stop-color="${T.teal}" stop-opacity="0"/></linearGradient>` +
  `<linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.copper}" stop-opacity="0"/><stop offset="0.5" stop-color="${T.copper}" stop-opacity="0.7"/><stop offset="1" stop-color="${T.copper}" stop-opacity="0"/></linearGradient>`

/**
 * The backdrop: basalt sky with a star field, a molten glow and an asteroid low on the right, the navigation rail
 * and the header rule. `rock` false leaves the asteroid out (busier detail pages).
 */
export function backdrop({ rock = true } = {}) {
  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
      stars(W, H, 260, 'regolith-stars', { color: '#E6E9F0', max: 1.3 }) +
      `<rect width="${W}" height="${H}" fill="url(#vein)"/><rect width="${W}" height="${H}" fill="url(#melt)"/>` +
      (rock ? asteroid(1150, 690, 230) : '') +
      `<rect width="${RAIL}" height="${H}" fill="url(#rail)"/><rect x="${RAIL}" width="1.5" height="${H}" fill="url(#edge)"/>` +
      `<rect x="${X0}" y="66" width="${X1 - X0}" height="1.2" fill="url(#rule)"/>` +
      `<path d="M24 92H184" stroke="${T.grid}" stroke-width="1"/><path d="M24 404H184" stroke="${T.grid}" stroke-width="1"/>` +
      corners(16, 14, 176, 60),
    defs
  )
}

export const logo = svg(
  64,
  64,
  `<path d="M32 4L56 18V46L32 60L8 46V18Z" fill="#14181E" stroke="${T.copper}" stroke-width="2.4"/>` +
    `<path d="M20 40L30 22L36 32L40 26L46 40Z" fill="url(#ore)"/>` +
    `<circle cx="44" cy="20" r="3" fill="${T.teal}"/>`,
  `<linearGradient id="ore" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.gold}"/><stop offset="1" stop-color="${T.copper}"/></linearGradient>`
)

// ---------------------------------------------------------------- page kit
/** A panel: dark plate with a copper edge glow (Lumen_Style); Power BI shows the plate and its border. */
export function panel(accent = T.copper) {
  return {
    box: { background: { color: c(T.panel), transparency: 6 }, border: { color: c('#2A313C'), width: 1, radius: 12 }, padding: 12 },
    style: { gradient: { angle: 160, stops: ['#1A1F27F2', '#10141AF2'] }, glow: { color: accent, size: 18, opacity: 0.16 } }
  }
}

export const head = (text) => ({ show: true, text, fontFamily: 'Barlow Semibold', fontSize: 11, fontColor: c(T.ink) })
export const sub = (text) => ({ show: true, text, fontFamily: 'Roboto Condensed', fontSize: 8, fontColor: c(T.muted) })

/** A visual in its own titled panel. */
export function framed(spec, title, subtitle, accent) {
  const p = panel(accent)
  return { ...spec, style: p.style, box: { ...p.box, title: head(title), ...(subtitle ? { subTitle: sub(subtitle) } : {}) } }
}

/** KPI tile: the value card is the panel (its title is the label); the note card sits inside it. */
export function tile(k, name, x, y, w, label, value, note, accent, motion) {
  const p = panel(accent)
  return [
    k.card({ name: `${name}-v`, x, y, w, h: 96, field: value, size: 24, font: 'Barlow Semibold', color: T.ink, vAlign: 'top', style: p.style, box: { ...p.box, padding: { top: 10, left: 14, right: 10, bottom: 10 }, title: { show: true, text: label, fontFamily: 'Roboto Condensed', fontSize: 8.5, fontColor: c(accent) } }, motion }),
    note ? k.card({ name: `${name}-n`, x: x + 10, y: y + 66, w: w - 16, h: 24, field: note, size: 8, font: 'Barlow', color: T.muted, motion }) : null
  ]
}

/**
 * The rail and header every page carries. pages: the navigator lists the report's pages itself; `filters` are slicer
 * visuals to place under /// FILTERS (built by the caller), `period` a card field for the footer.
 */
export function chrome(k, { title, kicker, filters = [], period, extra = [], navH = 226 }) {
  return [
    k.img({ name: 'logo', x: 24, y: 22, w: 44, h: 44, src: 'regolith-logo.svg', motion: { entrance: 'none' } }),
    k.text({ name: 'brand', x: 76, y: 22, w: 124, h: 26, runs: [{ text: 'REGOLITH', font: 'Barlow Black', size: 15, color: T.ink }] }),
    k.text({ name: 'brand-k', x: 77, y: 46, w: 124, h: 18, runs: [{ text: 'MINING OPERATIONS', font: 'Roboto Condensed', size: 7, color: T.copper }] }),
    k.text({ name: 'nav-h', x: 24, y: 100, w: 160, h: 18, runs: [{ text: '/// MODULES', font: 'Roboto Condensed', size: 7.5, color: T.muted }] }),
    k.pageNav({ name: 'nav', x: 16, y: 120, w: 176, h: navH, gap: 6, radius: 8, font: 'Barlow', size: 10, color: T.muted, selColor: T.ink, hoverColor: T.ink, selFill: '#1C222B', hoverFill: '#161B22', selLine: T.copper, margin: 16, motion: { entrance: 'none' } }),
    k.text({ name: 'filters-h', x: 24, y: 412, w: 160, h: 18, runs: [{ text: '/// FILTERS', font: 'Roboto Condensed', size: 7.5, color: T.muted }] }),
    ...filters,
    period ? k.card({ name: 'period', x: 20, y: 668, w: 172, h: 22, field: period, size: 7.5, font: 'Roboto Condensed', color: T.muted, motion: { entrance: 'none' } }) : null,
    k.text({ name: 'page-t', x: X0, y: 14, w: 560, h: 34, runs: [{ text: title, font: 'Barlow Black', size: 20, color: T.ink }] }),
    k.text({ name: 'page-k', x: X0 + 2, y: 42, w: 560, h: 18, runs: [{ text: kicker, font: 'Roboto Condensed', size: 8, color: T.copper }] }),
    ...extra
  ]
}

/** Slicer look for the rail. */
export const railSlicer = { color: T.ink, itemBg: '#151A21', outline: 'Frame', outlineColor: '#2E3642', font: 'Barlow', size: 9, headColor: T.muted, headFont: 'Roboto Condensed', headSize: 7.5 }

// ---------------------------------------------------------------- sample data (the gallery template)
const SITES = [
  ['Psyche-119', 'Psyche', 'Platinum', 3.1],
  ['Hygiea-691', 'Hygiea', 'Water Ice', 6.4],
  ['Eros-204', 'Eros', 'Iron-Nickel Ore', 5.2],
  ['Ganymede-58', 'Ganymede', 'Helium-3', 1.6],
  ['Pallas-311', 'Pallas', 'Palladium', 2.7],
  ['Ryugu-77', 'Ryugu', 'Carbonaceous Chondrites', 4.1],
  ['Titan-399', 'Titan', 'Silicates', 4.8],
  ['Vesta-12', 'Vesta', 'Rare Earth Elements', 2.2]
]
const rows = []
const jt = jitter('regolith', 0.18)
const r = rng('regolith-sample')
SITES.forEach(([site, body, material, scale]) =>
  MONTHS.forEach((mo, mi) => {
    const tons = scale * 1650 * jt() * (1 + mi * 0.012)
    const hours = scale * 2900 * jt()
    const down = hours * (0.04 + r() * 0.05)
    rows.push([mo, mi + 1, site, body, material, round(tons, 1), round(hours, 0), round(down, 1), round(tons * (material === 'Platinum' || material === 'Palladium' ? 2.4 : 0.06) * jt(), 2)])
  })
)

const F = (p) => m('_Ops', p)
const D = (p) => col('Sites', p)
const measures = [
  { name: 'Ore Extracted', dax: 'SUM(Sites[Tons])', format: '#,0" t"' },
  { name: 'Operating Hours', dax: 'SUM(Sites[Hours])', format: '#,0' },
  { name: 'Downtime Hours', dax: 'SUM(Sites[Downtime])', format: '#,0" h"' },
  { name: 'Availability', dax: 'DIVIDE([Operating Hours] - [Downtime Hours], [Operating Hours])', format: '0.0%' },
  { name: 'Market Value', dax: 'SUM(Sites[ValueM])', format: '\\$#,0"M"' },
  { name: 'Tons per Hour', dax: 'DIVIDE([Ore Extracted], [Operating Hours])', format: '0.00' },
  { name: 'Active Sites', dax: 'DISTINCTCOUNT(Sites[Site])', format: '0' },
  { name: 'Ore Note', dax: 'FORMAT([Tons per Hour], "0.00") & " t per operating hour"' },
  { name: 'Availability Note', dax: 'FORMAT([Downtime Hours], "#,0") & " h of downtime"' },
  { name: 'Value Note', dax: '"across " & [Active Sites] & " active sites"' },
  { name: 'Period', dax: '"FY 2070  ·  SAMPLE DATA"' }
]

const BODY_COLORS = { Psyche: T.copper, Hygiea: T.teal, Eros: T.gold, Ganymede: T.ice, Pallas: T.violet, Ryugu: T.rose, Titan: '#C9D1DC', Vesta: '#6EE7A0' }

export default {
  order: 11,
  id: 'regolith',
  name: 'Regolith',
  style: 'Industrial sci-fi',
  compatibility: 'lumen',
  lumenFeatures: ['Panels with a copper edge glow (Lumen_Style)', 'Bundled Barlow and Roboto Condensed fonts', 'Page navigator rail'],
  summary: 'Deep-space mining command deck: a navigation rail, copper-glow panels and an asteroid on the horizon',
  description:
    'Mining operations on a basalt-dark command deck: a left rail with a page navigator and filters, KPI tiles with a copper edge glow, an extraction trend, a celestial-body donut and a site leaderboard over a cratered asteroid and a molten horizon. Uses Lumen-only effects; in Power BI the panels show as plain dark boxes.',
  swatch: [T.bg, T.copper, T.teal, T.gold],
  theme: themeOf(T),
  measures: { table: '_Ops', list: measures },
  tables: [
    {
      name: 'Sites',
      columns: [
        ...monthColumns,
        { name: 'Site', type: 'string' },
        { name: 'Body', type: 'string' },
        { name: 'Material', type: 'string' },
        { name: 'Tons', type: 'double', format: '#,0' },
        { name: 'Hours', type: 'double', format: '#,0' },
        { name: 'Downtime', type: 'double', format: '#,0' },
        { name: 'ValueM', type: 'double', format: '#,0.0' }
      ],
      rows
    }
  ],
  resources: { 'regolith-bg.svg': backdrop(), 'regolith-logo.svg': logo },
  pages: [
    {
      name: 'Command',
      background: { color: T.bg, image: 'regolith-bg.svg' },
      wallpaper: '#050608',
      visuals: (seed) => {
        const k = kit(seed, T)
        const w = 196, gap = 12, xs = [0, 1, 2, 3, 4].map((i) => X0 + i * (w + gap))
        return [
          ...chrome(k, {
            navH: 40,
            title: 'Command',
            kicker: 'FLEET-WIDE EXTRACTION  //  FY SUMMARY',
            period: F('Period'),
            filters: [k.slicer({ name: 'body', x: 20, y: 434, w: 172, h: 60, field: D('Body'), header: 'CELESTIAL BODY', ...railSlicer })]
          }),
          ...tile(k, 't1', xs[0], 80, w, 'ORE EXTRACTED', F('Ore Extracted'), F('Ore Note'), T.copper),
          ...tile(k, 't2', xs[1], 80, w, 'AVAILABILITY', F('Availability'), F('Availability Note'), T.teal),
          ...tile(k, 't3', xs[2], 80, w, 'DOWNTIME', F('Downtime Hours'), null, T.rose),
          ...tile(k, 't4', xs[3], 80, w, 'MARKET VALUE', F('Market Value'), F('Value Note'), T.gold),
          ...tile(k, 't5', xs[4], 80, w, 'ACTIVE SITES', F('Active Sites'), null, T.ice),
          k.line(framed({ name: 'trend', x: X0, y: 190, w: 620, h: 262, area: true, stacked: true, cat: D('Month'), val: [as(F('Ore Extracted'), 'Ore extracted')], series: D('Body'), colorMap: BODY_COLORS, legend: 'TopRight', grid: true, smooth: true, axisSize: 7.5 }, 'Ore extracted', 'TONNES PER MONTH BY CELESTIAL BODY')),
          k.donut(framed({ name: 'bodies', x: 860, y: 190, w: 396, h: 262, cat: D('Body'), val: as(F('Ore Extracted'), 'Ore extracted'), innerRadius: 62, labelStyle: 'Category, percent of total', labelColor: T.ink, colorMap: BODY_COLORS }, 'Share by body', 'TONNES EXTRACTED', T.teal)),
          k.column(framed({ name: 'sites', x: X0, y: 464, w: 500, h: 236, horizontal: true, cat: D('Site'), val: [as(F('Ore Extracted'), 'Ore extracted')], colors: [T.copper], labels: true, yAxis: false, grid: false, sort: { field: F('Ore Extracted') }, axisSize: 8 }, 'Site leaderboard', 'TONNES EXTRACTED')),
          k.table(
            framed(
              {
                name: 'materials',
                x: 740,
                y: 464,
                w: 516,
                h: 236,
                fields: [as(D('Material'), 'Material'), as(F('Ore Extracted'), 'Tonnes'), as(F('Availability'), 'Availability'), as(F('Market Value'), 'Value')],
                headBg: '#00000000',
                rowBg: '#00000000',
                color: T.ink,
                headColor: T.copper,
                font: 'Barlow',
                headFont: 'Roboto Condensed',
                lineColor: T.grid,
                size: 9,
                rowPadding: 5,
                sort: { field: F('Ore Extracted') }
              },
              'Materials',
              'OUTPUT, AVAILABILITY AND VALUE',
              T.gold
            )
          )
        ]
      }
    }
  ]
}

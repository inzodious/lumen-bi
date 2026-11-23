/**
 * Orbital: futuristic mission-control telemetry. Deep-space gradient with nebulae and a star field, a HUD
 * ring around the headline figure, frosted-glass panels with a cyan glow (Lumen_Style), Barlow and
 * Roboto Condensed (fonts bundled with Lumen). Lumen-only: Power BI shows the panels as plain translucent boxes.
 */
import { kit, themeOf } from '../kit.mjs'
import { m, col, as } from '../lib.mjs'
import { svg, stars, f, pathOf } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round } from '../data.mjs'
import { rng } from '../lib.mjs'

export const T = {
  bg: '#070817',
  ink: '#E9F1FF',
  muted: '#8C9AC4',
  grid: '#2A3160',
  cyan: '#3BF0FF',
  violet: '#8B6BFF',
  magenta: '#FF4FB8',
  amber: '#FFB347',
  colors: ['#3BF0FF', '#8B6BFF', '#FF4FB8', '#FFB347', '#5CFFB0', '#4D7CFF', '#C9D6FF', '#FF7A59'],
  fontBody: 'Barlow',
  fontHead: 'Barlow Semibold',
  fontNum: 'Barlow',
  good: '#5CFFB0',
  bad: '#FF4FB8'
}

// ---------------------------------------------------------------- data
const MISSIONS = [
  ['Helios', 'LEO', 8.2],
  ['Kestrel', 'LEO', 6.1],
  ['Lyra', 'MEO', 4.4],
  ['Nimbus', 'GEO', 3.1],
  ['Corvid', 'Polar', 5.2],
  ['Vanta', 'MEO', 2.6],
  ['Aster', 'GEO', 1.9],
  ['Tern', 'Polar', 3.4]
]
const rows = []
const jt = jitter('orbital', 0.25)
const r = rng('orbital-launch')
MISSIONS.forEach(([mission, orbit, scale]) =>
  MONTHS.forEach((mo, mi) => {
    const launches = Math.max(0, Math.round((scale / 4) * jt() * (1 + mi * 0.04) + (r() < 0.3 ? 1 : 0)))
    const payload = launches * (orbit === 'GEO' ? 4200 : orbit === 'MEO' ? 2100 : 820) * jt()
    const uptime = 0.965 + r() * 0.033 - (orbit === 'Polar' ? 0.01 : 0)
    const data = scale * 38 * jt() * (1 + mi * 0.05)
    const anomalies = Math.round(r() * (orbit === 'LEO' ? 3 : 2))
    rows.push([mo, mi + 1, mission, orbit, launches, round(payload, 0), round(uptime, 4), round(data, 1), anomalies])
  })
)

const F = (p) => m('_Telemetry', p)
const D = (p) => col('Missions', p)
const measures = [
  { name: 'Launches', dax: 'SUM(Missions[Launches])', format: '#,0' },
  { name: 'Payload (t)', dax: 'SUM(Missions[PayloadKg]) / 1000', format: '#,0.0" t"' },
  { name: 'Uptime', dax: 'AVERAGE(Missions[Uptime])', format: '0.00%' },
  { name: 'Data Downlinked', dax: 'SUM(Missions[DataTB])', format: '#,0" TB"' },
  { name: 'Anomalies', dax: 'SUM(Missions[Anomalies])', format: '#,0' },
  { name: 'Anomaly Rate', dax: 'DIVIDE([Anomalies], [Launches])', format: '0.0%' },
  { name: 'Active Missions', dax: 'DISTINCTCOUNT(Missions[Mission])', format: '0' },
  { name: 'Launch Note', dax: '"across " & [Active Missions] & " active missions"' },
  { name: 'Data Note', dax: 'FORMAT(DIVIDE([Data Downlinked], 12), "#,0") & " TB per month on average"' },
  { name: 'Payload Note', dax: 'FORMAT(DIVIDE(SUM(Missions[PayloadKg]), [Launches]), "#,0") & " kg per launch"' },
  { name: 'Uptime Note', dax: '[Anomalies] & " anomalies logged  ·  " & FORMAT([Anomaly Rate], "0.0%") & " of launches"' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720
const CX = 640, CY = 338, R = 214

function ring() {
  let o = ''
  o += `<circle cx="${CX}" cy="${CY}" r="${R + 34}" fill="none" stroke="${T.cyan}" stroke-opacity="0.18" stroke-width="1"/>`
  o += `<circle cx="${CX}" cy="${CY}" r="${R + 50}" fill="none" stroke="${T.violet}" stroke-opacity="0.25" stroke-width="0.8" stroke-dasharray="2 6"/>`
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2
    const long = i % 10 === 0
    const r1 = R + 38, r2 = R + 38 + (long ? 10 : 4)
    o += `<path d="M${f(CX + Math.cos(a) * r1)} ${f(CY + Math.sin(a) * r1)}L${f(CX + Math.cos(a) * r2)} ${f(CY + Math.sin(a) * r2)}" stroke="${long ? T.cyan : T.muted}" stroke-opacity="${long ? 0.8 : 0.35}" stroke-width="${long ? 1.4 : 0.8}"/>`
  }
  const arc = (a0, a1, rad, color, w, op) => {
    const pts = []
    for (let i = 0; i <= 60; i++) {
      const a = a0 + ((a1 - a0) * i) / 60
      pts.push([CX + Math.cos(a) * rad, CY + Math.sin(a) * rad])
    }
    return `<path d="${pathOf(pts)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-opacity="${op}" stroke-linecap="round"/>`
  }
  o += arc(-2.6, -1.2, R + 62, T.cyan, 2.5, 0.85) + arc(0.4, 1.3, R + 62, T.magenta, 2.5, 0.75) + arc(2.0, 2.4, R + 62, T.amber, 2.5, 0.8)
  // tilted orbit with a satellite
  o += `<ellipse cx="${CX}" cy="${CY}" rx="${R + 120}" ry="${R * 0.42}" transform="rotate(-14 ${CX} ${CY})" fill="none" stroke="${T.cyan}" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="1 5"/>`
  // inner glow disc
  o += `<circle cx="${CX}" cy="${CY}" r="${R - 6}" fill="url(#core)"/>`
  return o
}

function nebula(id, cx, cy, rad, color, op) {
  return [`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${rad}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`, `<rect width="${W}" height="${H}" fill="url(#${id})"/>`]
}

function moon(cx, cy, rad) {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#moon)"/>` +
    [
      [-0.3, -0.2, 0.18],
      [0.25, 0.1, 0.12],
      [-0.05, 0.4, 0.09],
      [0.4, -0.35, 0.07]
    ]
      .map(([dx, dy, s]) => `<circle cx="${f(cx + dx * rad)}" cy="${f(cy + dy * rad)}" r="${f(s * rad)}" fill="#2A2F5C" opacity="0.55"/>`)
      .join('') +
    `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#terminator)"/>`
  )
}

const neb = [nebula('n1', 1090, 70, 460, '#B23A9E', 0.42), nebula('n2', 930, 260, 360, '#4B2AA8', 0.35), nebula('n3', 120, 660, 470, '#0E6E8C', 0.38), nebula('n4', 420, 40, 300, '#2B3FA8', 0.25)]
const defs =
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05061A"/><stop offset="1" stop-color="#0A0920"/></linearGradient>` +
  neb.map((n) => n[0]).join('') +
  `<radialGradient id="core" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#3BF0FF" stop-opacity="0.10"/><stop offset="0.7" stop-color="#3BF0FF" stop-opacity="0.03"/><stop offset="1" stop-color="#3BF0FF" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="moon" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#C9D2FF"/><stop offset="1" stop-color="#5A63A8"/></radialGradient>` +
  `<radialGradient id="terminator" cx="0.75" cy="0.8" r="0.9"><stop offset="0.45" stop-color="#05061A" stop-opacity="0"/><stop offset="1" stop-color="#05061A" stop-opacity="0.85"/></radialGradient>` +
  `<linearGradient id="rule" x1="0" x2="1"><stop offset="0" stop-color="${T.cyan}" stop-opacity="0.9"/><stop offset="0.5" stop-color="${T.violet}" stop-opacity="0.5"/><stop offset="1" stop-color="${T.magenta}" stop-opacity="0"/></linearGradient>`

/** The deep-space backdrop; `hud` adds the ring around the headline (the dashboards' detail pages leave it out). */
export function backdrop({ hud = true } = {}) {
  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
      neb.map((n) => n[1]).join('') +
      stars(W, H, 340, 'orbital-stars', { color: '#DDE6FF', max: 1.5 }) +
      moon(574, 52, 20) +
      (hud ? ring() : '') +
      `<rect x="40" y="86" width="1200" height="1.2" fill="url(#rule)"/>`,
    defs
  )
}
const bg = backdrop()

export const logo = svg(
  64,
  64,
  `<circle cx="32" cy="32" r="15" fill="url(#p)"/><ellipse cx="32" cy="32" rx="29" ry="9" transform="rotate(-24 32 32)" fill="none" stroke="${T.cyan}" stroke-width="2.2"/><path d="M17.5 36.5a15 15 0 0 0 29-9" fill="none" stroke="#070817" stroke-width="0"/><circle cx="56" cy="21" r="2.6" fill="${T.amber}"/>`,
  `<linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.violet}"/><stop offset="1" stop-color="${T.magenta}"/></linearGradient>`
)

export const satellite = svg(
  220,
  120,
  `<g transform="rotate(-18 110 60)">` +
    // panels
    [12, 146].map((x) => `<rect x="${x}" y="44" width="62" height="32" rx="2" fill="#1B2A6B" stroke="${T.cyan}" stroke-width="1.2"/>` + [1, 2, 3].map((i) => `<path d="M${x + i * 15.5} 44V76" stroke="${T.cyan}" stroke-opacity="0.5" stroke-width="0.8"/>`).join('') + `<path d="M${x} 60H${x + 62}" stroke="${T.cyan}" stroke-opacity="0.5" stroke-width="0.8"/>`).join('') +
    `<path d="M74 60H92M128 60H146" stroke="#C9D6FF" stroke-width="2"/>` +
    `<rect x="92" y="38" width="36" height="44" rx="6" fill="#D9E2FF"/><rect x="92" y="38" width="36" height="12" rx="4" fill="${T.amber}"/>` +
    `<circle cx="110" cy="66" r="6" fill="#070817" stroke="${T.cyan}" stroke-width="1.5"/>` +
    `<path d="M110 38V22" stroke="#C9D6FF" stroke-width="1.6"/><path d="M98 22a12 7 0 0 0 24 0z" fill="#C9D6FF"/>` +
    `</g>` +
    `<path d="M4 108l40-14M14 116l30-10" stroke="${T.cyan}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 4"/>`
)

const ORBIT_COLORS = { LEO: T.cyan, MEO: T.violet, GEO: T.magenta, Polar: T.amber }

// ---------------------------------------------------------------- page
export const glass = (extra = {}) => ({
  box: { background: { color: c('#FFFFFF'), transparency: 93 }, border: { color: c('#7F8CFF'), width: 1, radius: 14 }, padding: 14, ...extra.box },
  style: { blur: 14, gradient: { angle: 155, stops: ['#FFFFFF1F', '#8B6BFF14', '#FFFFFF08'] }, glow: { color: extra.glow ?? T.cyan, size: 22, opacity: 0.22 } }
})
import { c } from '../lib.mjs'

function kpi(k, name, x, y, label, value, note, accent) {
  const g = glass({ glow: accent })
  return [
    k.shape({ name: `${name}-panel`, x, y, w: 320, h: 104, shape: 'rectangle', ...g, box: { ...g.box, padding: 0 } }),
    k.shape({ name: `${name}-bar`, x: x + 16, y: y + 18, w: 4, h: 68, fill: accent, shape: 'rectangle' }),
    k.text({ name: `${name}-l`, x: x + 32, y: y + 14, w: 270, h: 20, runs: [{ text: label, font: 'Roboto Condensed', size: 9, color: T.muted }] }),
    k.card({ name: `${name}-v`, x: x + 28, y: y + 30, w: 280, h: 44, field: F(value), size: 28, font: 'Barlow Semibold', color: T.ink }),
    k.card({ name: `${name}-n`, x: x + 28, y: y + 72, w: 280, h: 26, field: F(note), size: 9, font: 'Barlow', color: accent })
  ]
}

function panelTitle(k, name, x, y, w, text, sub) {
  return [
    k.text({ name: `${name}-t`, x, y, w, h: 22, runs: [{ text, font: 'Barlow Semibold', size: 11, color: T.ink }] }),
    sub ? k.text({ name: `${name}-s`, x, y: y + 20, w, h: 18, runs: [{ text: sub, font: 'Roboto Condensed', size: 8, color: T.muted }] }) : null
  ]
}

export default {
  order: 4,
  id: 'orbital',
  name: 'Orbital',
  style: 'Futuristic',
  compatibility: 'lumen',
  lumenFeatures: ['Frosted-glass panels with glow (Lumen_Style)', 'Bundled Barlow and Roboto Condensed fonts'],
  summary: 'Mission control in deep space: a HUD ring around the headline, frosted-glass panels, nebulae',
  description:
    'Satellite operations telemetry over a deep-space backdrop: a HUD ring with an orbit-mix donut around constellation uptime, frosted-glass KPI panels with a cyan glow, a mission roster and launch trends. Uses Lumen-only effects; in Power BI the panels show as plain translucent boxes.',
  swatch: [T.bg, T.cyan, T.violet, T.magenta],
  theme: themeOf(T),
  measures: { table: '_Telemetry', list: measures },
  tables: [
    {
      name: 'Missions',
      columns: [
        ...monthColumns,
        { name: 'Mission', type: 'string' },
        { name: 'Orbit', type: 'string' },
        { name: 'Launches', type: 'int64' },
        { name: 'PayloadKg', type: 'double', format: '#,0' },
        { name: 'Uptime', type: 'double', format: '0.00%', summarize: 'average' },
        { name: 'DataTB', type: 'double', format: '#,0.0' },
        { name: 'Anomalies', type: 'int64' }
      ],
      rows
    }
  ],
  resources: { 'orbital-bg.svg': bg, 'orbital-logo.svg': logo, 'orbital-satellite.svg': satellite },
  pages: [
    {
      name: 'Mission Control',
      background: { color: T.bg, image: 'orbital-bg.svg' },
      wallpaper: '#03040C',
      visuals: (seed) => {
        const k = kit(seed, T)
        const g = glass()
        return [
          k.img({ name: 'logo', x: 36, y: 20, w: 52, h: 52, src: 'orbital-logo.svg' }),
          k.text({ name: 'title', x: 96, y: 18, w: 420, h: 38, runs: [{ text: 'ORBITAL', font: 'Barlow Black', size: 24, color: T.ink }, { text: '  mission control', font: 'Barlow', size: 15, color: T.muted }] }),
          k.text({ name: 'kicker', x: 98, y: 54, w: 520, h: 20, runs: [{ text: 'CONSTELLATION TELEMETRY  //  LIVE ORBIT SUMMARY', font: 'Roboto Condensed', size: 8.5, color: T.cyan }] }),
          k.slicer({
            name: 'orbit',
            x: 820,
            y: 26,
            w: 420,
            h: 44,
            field: D('Orbit'),
            mode: 'Basic',
            horizontal: true,
            header: false,
            color: T.ink,
            itemBg: '#11163A',
            outline: 'Frame',
            outlineColor: '#3A4590',
            font: 'Roboto Condensed',
            size: 9
          }),
          ...kpi(k, 'k1', 40, 112, 'LAUNCHES', 'Launches', 'Launch Note', T.cyan),
          ...kpi(k, 'k2', 40, 232, 'PAYLOAD TO ORBIT', 'Payload (t)', 'Payload Note', T.violet),
          ...kpi(k, 'k3', 40, 352, 'DATA DOWNLINKED', 'Data Downlinked', 'Data Note', T.magenta),
          k.shape({ name: 'anom-panel', x: 40, y: 472, w: 320, h: 220, shape: 'rectangle', ...g, box: { ...g.box, padding: 0 } }),
          ...panelTitle(k, 'anom', 58, 484, 280, 'Anomalies by mission', 'EVENTS LOGGED THIS YEAR'),
          k.column({ name: 'anom-chart', x: 50, y: 526, w: 300, h: 160, cat: D('Mission'), val: [F('Anomalies')], colors: [T.magenta], labels: true, yAxis: false, grid: false, sort: { field: F('Anomalies') }, axisColor: T.muted, axisSize: 7 }),

          // the ring
          k.donut({ name: 'ring', x: CX - 214, y: CY - 214, w: 428, h: 428, cat: D('Orbit'), val: F('Launches'), innerRadius: 90, labels: false, colorMap: ORBIT_COLORS }),
          k.text({ name: 'ring-k', x: CX - 150, y: CY - 92, w: 300, h: 20, align: 'center', runs: [{ text: 'CONSTELLATION UPTIME', font: 'Roboto Condensed', size: 9, color: T.cyan }] }),
          k.card({ name: 'ring-v', x: CX - 160, y: CY - 70, w: 320, h: 92, field: F('Uptime'), size: 54, font: 'Barlow Semibold', color: T.ink, align: 'center' }),
          k.card({ name: 'ring-n', x: CX - 160, y: CY + 22, w: 320, h: 22, field: F('Uptime Note'), size: 9.5, font: 'Barlow', color: T.muted, align: 'center' }),
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
          k.img({ name: 'satellite', x: 790, y: 92, w: 170, h: 93, src: 'orbital-satellite.svg' }),

          // bottom center trend
          k.shape({ name: 'trend-panel', x: 384, y: 592, w: 512, h: 100, shape: 'rectangle', ...g, box: { ...g.box, padding: 0 } }),
          ...panelTitle(k, 'trend', 400, 600, 200, 'Data downlink', 'TB PER MONTH'),
          k.line({ name: 'trend-chart', x: 520, y: 598, w: 368, h: 92, area: true, cat: D('Month'), val: [F('Data Downlinked')], colors: [T.cyan], yAxis: false, grid: false, smooth: true, axisSize: 7, objects: { lineStyles: { strokeWidth: 2, areaTransparency: 70 } } }),

          // right column
          k.shape({ name: 'roster-panel', x: 920, y: 112, w: 320, h: 344, shape: 'rectangle', ...g, box: { ...g.box, padding: 0 } }),
          ...panelTitle(k, 'roster', 938, 124, 280, 'Mission roster', 'LAUNCHES, UPTIME AND PAYLOAD BY MISSION'),
          k.table({
            name: 'roster-table',
            x: 932,
            y: 168,
            w: 296,
            h: 280,
            fields: [D('Mission'), D('Orbit'), as(F('Launches'), 'Launches'), as(F('Uptime'), 'Uptime'), as(F('Payload (t)'), 'Payload')],
            headBg: '#00000000',
            rowBg: '#00000000',
            color: T.ink,
            headColor: T.cyan,
            font: 'Barlow',
            headFont: 'Roboto Condensed',
            lineColor: '#2A3160',
            size: 9,
            rowPadding: 5,
            sort: { field: F('Launches') }
          }),
          k.shape({ name: 'launch-panel', x: 920, y: 472, w: 320, h: 220, shape: 'rectangle', ...glass({ glow: T.violet }), box: { ...g.box, padding: 0 } }),
          ...panelTitle(k, 'launch', 938, 484, 280, 'Launch cadence', 'LAUNCHES PER MONTH BY ORBIT'),
          k.column({ name: 'launch-chart', x: 930, y: 526, w: 300, h: 160, stacked: true, cat: D('Month'), val: [F('Launches')], series: D('Orbit'), colorMap: ORBIT_COLORS, yAxis: false, grid: false, axisSize: 7 })
        ]
      }
    }
  ]
}

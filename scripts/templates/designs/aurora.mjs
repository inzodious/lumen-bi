/**
 * Aurora: soft, light and iridescent. Blurred pastel light blobs and flowing aurora ribbons behind
 * frosted-glass panels (Lumen_Style blur and gradient), a tall hero slab with the headline figures,
 * a sound-wave illustration, Barlow and Open Sans (bundled with Lumen). Lumen-only: Power BI shows the
 * glass as plain translucent white panels.
 */
import { kit, themeOf, colorMap } from '../kit.mjs'
import { m, col, as, c, rng } from '../lib.mjs'
import { svg, f, smooth } from '../art.mjs'
import { MONTHS, monthColumns, jitter, round, season } from '../data.mjs'

const T = {
  bg: '#F4F1FF',
  ink: '#1E1838',
  muted: '#6B6489',
  grid: '#E3DDF7',
  violet: '#7B5CFF',
  pink: '#FF5FA2',
  peach: '#FFA374',
  aqua: '#2FD6C3',
  sky: '#5C9DFF',
  colors: ['#7B5CFF', '#FF5FA2', '#2FD6C3', '#FFA374', '#5C9DFF', '#C77DFF', '#1E1838', '#B9B0E8'],
  fontBody: 'Open Sans',
  fontHead: 'Barlow Semibold',
  fontNum: 'Barlow'
}

// ---------------------------------------------------------------- data
const TRACKS = [
  ['Glasshouse', 1.4],
  ['Northern Lights', 1.15],
  ['Soft Static', 0.9],
  ['Paper Moons', 0.75],
  ['Afterglow', 0.6],
  ['Tidal', 0.45]
]
const REGIONS = [
  ['North America', 0.36],
  ['Europe', 0.31],
  ['Latin America', 0.19],
  ['Asia Pacific', 0.14]
]
const SOURCES = [
  ['Playlists', 0.46],
  ['Search', 0.18],
  ['Radio', 0.2],
  ['Profile', 0.16]
]
const rows = []
const jt = jitter('aurora', 0.1)
MONTHS.forEach((mo, mi) =>
  TRACKS.forEach(([tr, pop]) =>
    REGIONS.forEach(([rg, rs]) =>
      SOURCES.forEach(([src, ss]) => {
        const streams = 52000 * pop * rs * ss * (1 + mi * 0.06) * jt()
        rows.push([mo, mi + 1, tr, rg, src, Math.round(streams), Math.round(streams * 0.31 * jt()), Math.round(streams * 0.045 * jt()), Math.round(streams * 0.006 * jt())])
      })
    )
  )
)

const F = (p) => m('_Pulse', p)
const D = (p) => col('Streams', p)
const measures = [
  { name: 'Streams', dax: 'SUM(Streams[Streams])', format: '#,0' },
  { name: 'Listeners', dax: 'SUM(Streams[Listeners])', format: '#,0' },
  { name: 'Saves', dax: 'SUM(Streams[Saves])', format: '#,0' },
  { name: 'New Followers', dax: 'SUM(Streams[Followers])', format: '#,0' },
  { name: 'Save Rate', dax: 'DIVIDE([Saves], [Listeners])', format: '0.0%' },
  { name: 'Streams Growth', dax: 'VAR m = MAX(Streams[MonthNo]) VAR a = CALCULATE([Streams], Streams[MonthNo] = m) VAR b = CALCULATE([Streams], Streams[MonthNo] = m - 1) RETURN DIVIDE(a - b, b)', format: '+0.0%;-0.0%' },
  { name: 'Streams Note', dax: 'FORMAT([Streams Growth], "+0.0%;-0.0%") & " vs last month"' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720

function ribbon(seed, y0, amp, color1, color2, width, op) {
  const r = rng(seed)
  const pts = []
  for (let x = -60; x <= W + 60; x += 120) pts.push([x, y0 + Math.sin(x / 210 + r() * 2) * amp + (r() - 0.5) * amp * 0.4])
  const id = `g${seed}`
  return [
    `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${color1}" stop-opacity="0"/><stop offset="0.35" stop-color="${color1}"/><stop offset="0.7" stop-color="${color2}"/><stop offset="1" stop-color="${color2}" stop-opacity="0"/></linearGradient>`,
    `<path d="${smooth(pts)}" fill="none" stroke="url(#${id})" stroke-width="${width}" stroke-linecap="round" opacity="${op}"/>`
  ]
}

const blobs = [
  [180, 120, 260, T.violet, 0.55],
  [1120, 90, 240, T.pink, 0.45],
  [980, 640, 300, T.aqua, 0.42],
  [420, 700, 240, T.peach, 0.5],
  [700, 300, 200, T.sky, 0.32]
]
const ribbons = [ribbon('a', 250, 70, T.violet, T.pink, 46, 0.35), ribbon('b', 330, 60, T.aqua, T.violet, 26, 0.35), ribbon('c', 420, 80, T.pink, T.peach, 14, 0.45), ribbon('d', 300, 50, '#FFFFFF', T.sky, 6, 0.8)]
const bg = svg(
  W,
  H,
  `<rect width="${W}" height="${H}" fill="${T.bg}"/>` +
    `<g filter="url(#soft)">${blobs.map(([x, y, r, col2, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col2}" opacity="${o}"/>`).join('')}</g>` +
    `<g filter="url(#glow)">${ribbons.map((r) => r[1]).join('')}</g>` +
    Array.from({ length: 40 }, (_, i) => {
      const r = rng('spark' + i)
      return `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(0.8 + r() * 1.8)}" fill="#FFFFFF" opacity="${f(0.5 + r() * 0.5)}"/>`
    }).join(''),
  `<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="70"/></filter><filter id="glow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>` + ribbons.map((r) => r[0]).join('')
)

const wave = svg(
  320,
  120,
  Array.from({ length: 40 }, (_, i) => {
    const h = 10 + Math.abs(Math.sin(i * 0.45) * Math.cos(i * 0.13)) * 92
    return `<rect x="${i * 8}" y="${f(60 - h / 2)}" width="4.5" height="${f(h)}" rx="2.25" fill="url(#w)"/>`
  }).join(''),
  `<linearGradient id="w" x1="0" x2="1"><stop offset="0" stop-color="${T.violet}"/><stop offset="0.5" stop-color="${T.pink}"/><stop offset="1" stop-color="${T.peach}"/></linearGradient>`
)

const orb = svg(
  120,
  120,
  `<circle cx="60" cy="60" r="52" fill="url(#o)"/><ellipse cx="44" cy="38" rx="20" ry="12" fill="#FFFFFF" opacity="0.6" transform="rotate(-30 44 38)"/><circle cx="60" cy="60" r="52" fill="none" stroke="#FFFFFF" stroke-opacity="0.8" stroke-width="2"/>`,
  `<radialGradient id="o" cx="0.35" cy="0.3" r="0.85"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="${T.aqua}"/><stop offset="0.7" stop-color="${T.violet}"/><stop offset="1" stop-color="${T.pink}"/></radialGradient>`
)

// ---------------------------------------------------------------- page
const glass = (extra = {}) => ({
  box: { background: { color: c('#FFFFFF'), transparency: 45 }, border: { color: c('#FFFFFF'), width: 1.5, radius: 22 }, padding: 16, ...(extra.box ?? {}) },
  style: { blur: 22, gradient: { angle: 145, stops: ['#FFFFFFB8', '#FFFFFF59'] }, glow: { color: extra.glow ?? T.violet, size: 26, opacity: 0.16 } }
})
const head = (text) => ({ show: true, text, fontFamily: 'Barlow Semibold', fontSize: 12, fontColor: c(T.ink) })

function stat(k, i, label, value) {
  const y = 432 + i * 76
  return [
    k.text({ name: `s${i}-l`, x: 60, y, w: 160, h: 20, runs: [{ text: label, font: 'Open Sans', size: 9, color: T.muted }] }),
    k.card({ name: `s${i}-v`, x: 56, y: y + 18, w: 300, h: 46, field: F(value), size: 26, font: 'Barlow Semibold', color: T.ink })
  ]
}

export default {
  order: 10,
  id: 'aurora',
  name: 'Aurora',
  style: 'Glass',
  compatibility: 'lumen',
  lumenFeatures: ['Frosted-glass panels (Lumen_Style blur and gradient)', 'Bundled Barlow type'],
  summary: 'Soft iridescent glass: pastel light blobs, aurora ribbons, frosted panels and a hero slab',
  description:
    'A creator analytics dashboard in soft, light glass: blurred pastel light and flowing aurora ribbons behind frosted panels, a tall hero slab with streams and three headline figures over a sound-wave illustration, streams over time, top tracks, listeners by region and discovery sources. Uses Lumen-only effects; in Power BI the glass shows as plain translucent white panels.',
  swatch: [T.bg, T.violet, T.pink, T.aqua],
  theme: themeOf(T),
  measures: { table: '_Pulse', list: measures },
  tables: [
    {
      name: 'Streams',
      columns: [
        ...monthColumns,
        { name: 'Track', type: 'string' },
        { name: 'Region', type: 'string' },
        { name: 'Source', type: 'string' },
        { name: 'Streams', type: 'int64' },
        { name: 'Listeners', type: 'int64' },
        { name: 'Saves', type: 'int64' },
        { name: 'Followers', type: 'int64' }
      ],
      rows
    }
  ],
  resources: { 'aurora-bg.svg': bg, 'aurora-wave.svg': wave, 'aurora-orb.svg': orb },
  pages: [
    {
      name: 'Creator Pulse',
      background: { color: T.bg, image: 'aurora-bg.svg' },
      visuals: (seed) => {
        const k = kit(seed, T)
        const g = glass()
        const trackColors = { Glasshouse: T.violet, 'Northern Lights': T.pink, 'Soft Static': T.aqua, 'Paper Moons': T.peach, Afterglow: T.sky, Tidal: '#C77DFF' }
        return [
          // hero slab
          k.shape({ name: 'hero', x: 30, y: 30, w: 360, h: 660, ...glass({ glow: T.pink }), box: { ...g.box, padding: 0 } }),
          k.img({ name: 'orb', x: 54, y: 52, w: 54, h: 54, src: 'aurora-orb.svg' }),
          k.text({ name: 'brand', x: 116, y: 56, w: 260, h: 30, runs: [{ text: 'aurora', font: 'Barlow Semibold', size: 18, color: T.ink }] }),
          k.text({ name: 'brand-s', x: 117, y: 84, w: 260, h: 20, runs: [{ text: 'creator pulse · all releases', font: 'Open Sans', size: 9, color: T.muted }] }),
          k.text({ name: 'hero-l', x: 60, y: 150, w: 300, h: 22, runs: [{ text: 'Total streams', font: 'Open Sans', size: 10, color: T.muted }] }),
          k.card({ name: 'hero-v', x: 54, y: 170, w: 330, h: 80, field: F('Streams'), size: 46, font: 'Barlow Semibold', color: T.ink }),
          k.card({ name: 'hero-n', x: 56, y: 248, w: 300, h: 26, field: F('Streams Note'), size: 10, font: 'Open Sans', color: T.violet }),
          k.img({ name: 'wave', x: 56, y: 290, w: 308, h: 116, src: 'aurora-wave.svg' }),
          ...stat(k, 0, 'Monthly listeners', 'Listeners'),
          ...stat(k, 1, 'Saves to library', 'Saves'),
          ...stat(k, 2, 'New followers', 'New Followers'),

          // track chips
          k.slicer({ name: 'tracks', x: 412, y: 30, w: 838, h: 44, field: D('Track'), mode: 'Basic', horizontal: true, header: false, font: 'Open Sans', size: 9, color: T.ink, itemBg: '#FFFFFF', outline: 'Frame', outlineColor: '#E3DDF7' }),

          k.line({ name: 'trend', x: 412, y: 92, w: 838, h: 262, area: true, stacked: true, cat: D('Month'), val: [F('Streams')], series: D('Track'), colorMap: trackColors, legend: 'TopRight', smooth: true, yAxis: false, grid: false, ...glass(), box: { ...g.box, title: head('Streams over time') }, objects: { lineStyles: { strokeWidth: 1.5, areaTransparency: 30, lineChartType: 'smooth' } } }),
          k.column({ name: 'top', x: 412, y: 372, w: 300, h: 318, horizontal: true, cat: D('Track'), val: [F('Streams')], colorMap: trackColors, labels: true, yAxis: false, grid: false, sort: { field: F('Streams') }, ...glass({ glow: T.pink }), box: { ...g.box, title: head('Top tracks') } }),
          k.donut({ name: 'regions', x: 730, y: 372, w: 250, h: 318, cat: D('Region'), val: F('Listeners'), innerRadius: 58, labelStyle: 'Category, percent of total', colorMap: { 'North America': T.violet, Europe: T.aqua, 'Latin America': T.pink, 'Asia Pacific': T.peach }, ...glass({ glow: T.aqua }), box: { ...g.box, title: head('Listeners by region') } }),
          k.column({ name: 'sources', x: 998, y: 372, w: 252, h: 318, cat: D('Source'), val: [F('Streams')], colorMap: { Playlists: T.violet, Search: T.sky, Radio: T.pink, Profile: T.peach }, labels: true, yAxis: false, grid: false, axisSize: 8, sort: { field: F('Streams') }, ...glass({ glow: T.peach }), box: { ...g.box, title: head('How they find you') } })
        ]
      }
    }
  ]
}

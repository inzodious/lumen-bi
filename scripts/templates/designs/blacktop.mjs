/**
 * Blacktop: streetball summer league, in the spirit of early-2000s street basketball games. An outdoor
 * court at dusk behind a chain-link fence, a city skyline, sprayed graffiti lettering (an original tag
 * drawn from Barlow outlines), a bouncing ball, and sticker cards slapped on at angles with tape.
 * Lumen-only: the tilted stickers and spray glow use Lumen_Style, the type uses the bundled Barlow.
 * No logos, characters or assets from any game: everything here is drawn for this template.
 */
import { kit, themeOf, colorMap } from '../kit.mjs'
import { m, col, as, c, rng } from '../lib.mjs'
import { svg, f, pathOf, smooth, word } from '../art.mjs'
import { round } from '../data.mjs'

const T = {
  bg: '#1E1F23',
  ink: '#111111',
  paper: '#F4F1E8',
  muted: '#6E6A62',
  grid: '#3A3B40',
  orange: '#FF6A13',
  yellow: '#FFE135',
  blue: '#1FA2FF',
  pink: '#FF3D7F',
  colors: ['#FF6A13', '#FFE135', '#1FA2FF', '#FF3D7F', '#7CFF4F', '#B48CFF', '#F4F1E8', '#9AA0A8'],
  fontBody: 'Barlow Semibold',
  fontHead: 'Barlow Black',
  fontNum: 'Barlow Black'
}

// ---------------------------------------------------------------- data
const PLAYERS = [
  ['Lil Rocket', 'Rim Rattlers', 24, 5, 4, 0.5],
  ['Downtown Dee', 'Court Kings', 27, 4, 3, 0.1],
  ['Glide', 'Night Owls', 21, 8, 5, 0.7],
  ['The Mayor', 'Court Kings', 18, 10, 6, 0.2],
  ['Static', 'Concrete Crew', 22, 3, 9, 0.9],
  ['Biscuit', 'Rim Rattlers', 15, 7, 8, 0.3],
  ['Ice Pick', 'Night Owls', 19, 6, 4, 0.4],
  ['Jumpshot Jo', 'Concrete Crew', 25, 3, 3, 0.05]
]
const COURTS = ['Pier 9', 'The Cage', 'The Rooftop', 'Union Park']
const rows = []
const r = rng('blacktop')
PLAYERS.forEach(([p, crew, pts, ast, reb, dunk], pi) => {
  for (let wk = 1; wk <= 10; wk++) {
    const k = 0.75 + r() * 0.5
    const court = COURTS[(pi + wk) % 4]
    const win = r() < (crew === 'Court Kings' ? 0.7 : crew === 'Night Owls' ? 0.58 : crew === 'Rim Rattlers' ? 0.5 : 0.38)
    rows.push([wk, `WK ${wk}`, p, crew, court, Math.round(pts * k), Math.round(ast * k), Math.round(reb * k), Math.round(dunk * 3 * r()), Math.round(r() * 4 * (pts / 20)), win ? 1 : 0, round(88 + r() * 18 + wk * 0.6, 1)])
  }
})

const F = (p) => m('_Stats', p)
const D = (p) => col('Games', p)
const measures = [
  { name: 'Points', dax: 'SUM(Games[Points])', format: '#,0' },
  { name: 'Assists', dax: 'SUM(Games[Assists])', format: '#,0' },
  { name: 'Boards', dax: 'SUM(Games[Rebounds])', format: '#,0' },
  { name: 'Dunks', dax: 'SUM(Games[Dunks])', format: '#,0' },
  { name: 'Threes', dax: 'SUM(Games[Threes])', format: '#,0' },
  { name: 'Games', dax: 'COUNTROWS(Games)', format: '#,0' },
  { name: 'PPG', dax: 'DIVIDE([Points], [Games])', format: '0.0' },
  { name: 'Wins', dax: 'SUM(Games[Win])', format: '#,0' },
  { name: 'Win %', dax: 'DIVIDE([Wins], [Games])', format: '0%' },
  { name: 'Crowd Hype', dax: 'AVERAGE(Games[CrowdDb])', format: '0" dB"' },
  { name: 'Top Scorer', dax: 'FIRSTNONBLANK(TOPN(1, VALUES(Games[Player]), [Points]), 1)' },
  { name: 'Points Note', dax: '"top dog: " & [Top Scorer]' },
  { name: 'Assists Note', dax: 'FORMAT(DIVIDE([Assists], [Games]), "0.0") & " dimes a game"' },
  { name: 'Boards Note', dax: 'FORMAT(DIVIDE([Boards], [Games]), "0.0") & " per run"' },
  { name: 'Dunks Note', dax: '[Threes] & " threes splashed"' }
]

// ---------------------------------------------------------------- art
const W = 1280, H = 720
const SKY_H = 268

function skyline(seed) {
  const rr = rng(seed)
  let o = ''
  let x = -10
  while (x < W) {
    const w = 40 + rr() * 70
    const h = 60 + rr() * 150
    const y = SKY_H - h
    o += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h + 4)}" fill="#1B0F2A"/>`
    if (rr() < 0.3) o += `<rect x="${f(x + w / 2 - 2)}" y="${f(y - 18)}" width="3" height="18" fill="#1B0F2A"/>`
    for (let wy = y + 8; wy < SKY_H - 10; wy += 12)
      for (let wx = x + 6; wx < x + w - 8; wx += 10) if (rr() < 0.18) o += `<rect x="${f(wx)}" y="${f(wy)}" width="4" height="5" fill="#FFC56B" opacity="${f(0.5 + rr() * 0.5)}"/>`
    x += w + 2
  }
  return o
}

function fence() {
  let d = ''
  const step = 22
  for (let x = -SKY_H; x < W + SKY_H; x += step) {
    d += `M${x} 0L${x + SKY_H} ${SKY_H}M${x} 0L${x - SKY_H} ${SKY_H}`
  }
  const posts = [0, 320, 640, 960, 1280].map((x) => `<rect x="${x - 5}" y="0" width="10" height="${SKY_H + 8}" fill="#5D636B"/><rect x="${x - 5}" y="0" width="3" height="${SKY_H + 8}" fill="#8E959E"/>`).join('')
  return `<path d="${d}" stroke="#AEB4BC" stroke-width="1.4" opacity="0.42" fill="none"/>` + posts + `<rect x="0" y="4" width="${W}" height="7" fill="#6E747C"/><rect x="0" y="${SKY_H - 2}" width="${W}" height="6" fill="#4A4F56"/>`
}

function asphalt(seed) {
  const rr = rng(seed)
  let o = `<rect y="${SKY_H}" width="${W}" height="${H - SKY_H}" fill="#26272B"/>`
  for (let i = 0; i < 2600; i++) {
    const x = rr() * W, y = SKY_H + rr() * (H - SKY_H)
    o += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + rr() * 1.3)}" fill="${rr() < 0.5 ? '#3A3B41' : '#18191C'}"/>`
  }
  // cracks
  for (let k = 0; k < 7; k++) {
    let x = rr() * W, y = SKY_H + 20 + rr() * 400
    const pts = [[x, y]]
    for (let i = 0; i < 6; i++) {
      x += (rr() - 0.3) * 40
      y += (rr() - 0.5) * 30
      pts.push([x, y])
    }
    o += `<path d="${pathOf(pts)}" stroke="#141518" stroke-width="1.6" fill="none"/>`
  }
  return o
}

function courtPaint() {
  const paint = (d, extra = '') => `<path d="${d}" stroke="#F4F1E8" stroke-width="7" fill="none" opacity="0.28" stroke-dasharray="80 3 40 2 120 4" ${extra}/>`
  return (
    paint(`M90 ${H + 10}A560 470 0 0 1 1190 ${H + 10}`) +
    paint(`M470 ${H + 10}V470H810V${H + 10}`) +
    paint(`M470 470A170 120 0 0 1 810 470`) +
    paint(`M470 470A170 120 0 0 0 810 470`, 'stroke-opacity="0.6"') +
    paint(`M0 ${SKY_H + 40}H${W}`)
  )
}

function splatter(cx, cy, color, seed, s = 1) {
  const rr = rng(seed)
  let o = `<circle cx="${cx}" cy="${cy}" r="${f(18 * s)}" fill="${color}"/>`
  for (let i = 0; i < 26; i++) {
    const a = rr() * Math.PI * 2, d = (20 + rr() * 50) * s
    o += `<circle cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" r="${f((0.8 + rr() * 4) * s)}" fill="${color}"/>`
  }
  for (let i = 0; i < 3; i++) {
    const x = cx + (rr() - 0.5) * 20 * s
    o += `<path d="M${f(x)} ${cy}V${f(cy + (24 + rr() * 50) * s)}" stroke="${color}" stroke-width="${f(3 * s)}" stroke-linecap="round"/>`
  }
  return `<g opacity="0.55">${o}</g>`
}

const bg = svg(
  W,
  H,
  `<rect width="${W}" height="${SKY_H}" fill="url(#dusk)"/>` +
    `<circle cx="980" cy="${SKY_H - 30}" r="90" fill="#FFB347" opacity="0.55"/>` +
    skyline('bt-sky') +
    fence() +
    asphalt('bt-asphalt') +
    courtPaint() +
    splatter(1160, 420, T.orange, 'sp1', 1.2) +
    splatter(120, 640, T.blue, 'sp2', 1) +
    splatter(900, 690, T.yellow, 'sp3', 0.8) +
    splatter(620, 330, T.pink, 'sp4', 0.7),
  `<linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#21103F"/><stop offset="0.55" stop-color="#7A2C8F"/><stop offset="1" stop-color="#FF7A2F"/></linearGradient>`
)

function graffiti() {
  const { letters, width } = word('barlow-black-italic', 'BLACKTOP', {
    x: 30,
    y: 150,
    size: 150,
    track: -0.045,
    each: (i) => ({ dy: [0, -10, 6, -6, 10, -12, 4, -4][i], rot: [-6, 4, -3, 5, -4, 6, -5, 3][i], scale: [1.08, 0.94, 1, 0.96, 1.02, 0.95, 1.04, 0.98][i] })
  })
  const all = (style) => letters.map((l) => `<path d="${l.d}" transform="${l.transform}" ${style}/>`).join('')
  const ext = [6, 5, 4, 3, 2, 1].map((k) => `<g transform="translate(${k * 1.6} ${k * 1.6})">${all('fill="#120A1C"')}</g>`).join('')
  // drips under a few letters
  const drips = [1, 3, 6]
    .map((i, j) => {
      const l = letters[i]
      const x = l.x + l.w * (0.35 + j * 0.1)
      const len = 22 + j * 12
      return `<path d="M${f(x - 5)} 140Q${f(x - 5)} ${140 + len} ${f(x)} ${140 + len + 6}Q${f(x + 5)} ${140 + len} ${f(x + 5)} 140Z" fill="url(#paint)" stroke="#120A1C" stroke-width="4"/>`
    })
    .join('')
  const shine = letters.map((l, i) => `<path d="M${f(l.x + l.w * 0.3)} ${f(58 + (i % 3) * 6)}l${f(l.w * 0.22)} -6" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.85"/>`).join('')
  const sparkles = [
    [width + 22, 40, 14],
    [18, 30, 10],
    [width - 40, 168, 9]
  ]
    .map(([x, y, s]) => `<path d="M${x} ${y - s}L${x + s * 0.25} ${y - s * 0.25}L${x + s} ${y}L${x + s * 0.25} ${y + s * 0.25}L${x} ${y + s}L${x - s * 0.25} ${y + s * 0.25}L${x - s} ${y}L${x - s * 0.25} ${y - s * 0.25}Z" fill="#FFFFFF"/>`)
    .join('')
  return svg(
    Math.ceil(width + 60),
    210,
    `<g filter="url(#halo)">${all(`fill="${T.blue}" stroke="${T.blue}" stroke-width="40" stroke-linejoin="round"`)}</g>` +
      all('fill="none" stroke="#FFFFFF" stroke-width="30" stroke-linejoin="round"') +
      ext +
      all('fill="none" stroke="#120A1C" stroke-width="16" stroke-linejoin="round"') +
      drips +
      all('fill="url(#paint)"') +
      all('fill="url(#stripe)" opacity="0.35"') +
      shine +
      sparkles,
    `<linearGradient id="paint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.yellow}"/><stop offset="0.55" stop-color="${T.orange}"/><stop offset="1" stop-color="${T.pink}"/></linearGradient>` +
      `<pattern id="stripe" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="5" height="12" fill="#FFFFFF"/></pattern>` +
      `<filter id="halo" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="12"/></filter>`
  )
}

const ball = svg(
  200,
  200,
  `<path d="M8 120L52 112M4 150L48 136M20 178L60 156" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.55"/>` +
    `<ellipse cx="120" cy="190" rx="44" ry="7" fill="#000000" opacity="0.35"/>` +
    `<circle cx="120" cy="96" r="70" fill="url(#ball)" stroke="#120A1C" stroke-width="5"/>` +
    `<path d="M120 26V166M50 96H190" stroke="#120A1C" stroke-width="4.5" fill="none"/>` +
    `<path d="M70 46C100 74 100 118 70 146M170 46C140 74 140 118 170 146" stroke="#120A1C" stroke-width="4.5" fill="none"/>` +
    `<path d="M84 52C94 44 108 40 120 40" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0.6" fill="none"/>`,
  `<radialGradient id="ball" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FF9A4D"/><stop offset="1" stop-color="#D9480F"/></radialGradient>`
)

const tape = svg(110, 34, `<path d="M4 6L10 2L16 7L24 3L32 6L104 4L108 10L104 16L108 22L104 30L30 31L22 27L14 32L6 28L2 20L6 14Z" fill="#E9E1C8" opacity="0.82"/><path d="M14 10H96" stroke="#FFFFFF" stroke-width="2" opacity="0.4"/>`)

const crown = svg(
  70,
  56,
  `<path d="M6 46L10 14L24 30L35 6L46 30L60 14L64 46Z" fill="${T.yellow}" stroke="#120A1C" stroke-width="4" stroke-linejoin="round"/><path d="M8 50H62" stroke="#120A1C" stroke-width="5" stroke-linecap="round"/><circle cx="35" cy="34" r="4" fill="${T.pink}" stroke="#120A1C" stroke-width="2"/>`
)

// ---------------------------------------------------------------- page
const stickerBox = (fill, border = '#120A1C') => ({ background: { color: c(fill) }, border: { color: c(border), width: 4, radius: 6 }, shadow: { preset: 'Custom', color: c('#000000'), transparency: 35, angle: 60, shadowDistance: 8, shadowBlur: 0, shadowSpread: 0, position: 'Outer' } })

function kpi(k, i, label, value, note, fill, fg, rot) {
  const x = 30 + i * 214
  const y = 206 + [0, 10, 2, 12][i]
  return [
    k.shape({ name: `k${i}`, x, y, w: 196, h: 118, box: stickerBox(fill), style: { rotate: rot } }),
    k.text({ name: `k${i}-l`, x: x + 14, y: y + 10, w: 170, h: 22, runs: [{ text: label, font: 'Barlow Black', size: 11, italic: true, color: fg }], style: { rotate: rot } }),
    k.card({ name: `k${i}-v`, x: x + 10, y: y + 30, w: 176, h: 56, field: F(value), size: 36, font: 'Barlow Black', italic: true, color: fg, style: { rotate: rot } }),
    k.card({ name: `k${i}-n`, x: x + 12, y: y + 86, w: 176, h: 24, field: F(note), size: 9, font: 'Barlow Semibold', color: fg, style: { rotate: rot } }),
    k.img({ name: `k${i}-tape`, x: x + 60, y: y - 14, w: 76, h: 24, src: 'blacktop-tape.svg' })
  ]
}

const titleRun = (text, color = '#120A1C') => ({ show: true, text, fontFamily: 'Barlow Black', fontSize: 14, fontColor: c(color), italic: true })

export default {
  order: 6,
  id: 'blacktop',
  name: 'Blacktop',
  style: 'Streetball',
  compatibility: 'lumen',
  lumenFeatures: ['Tilted sticker cards (Lumen_Style rotation)', 'Bundled Barlow Black Italic type'],
  summary: 'Streetball at dusk: graffiti title, chain-link fence, court paint and tilted sticker cards',
  description:
    'A summer streetball league scoreboard in an early-2000s street style: a dusk skyline behind a chain-link fence, worn court paint on cracked asphalt, an original sprayed graffiti title with drips, a bouncing ball, and stat stickers slapped on at angles with tape. Scoring leaders, crew standings, crowd hype and court heat. Lumen-only: Power BI shows the stickers straight.',
  swatch: ['#26272B', T.orange, T.yellow, T.blue],
  theme: themeOf(T),
  measures: { table: '_Stats', list: measures },
  tables: [
    {
      name: 'Games',
      columns: [
        { name: 'WeekNo', type: 'int64', hidden: true, summarize: 'none' },
        { name: 'Week', type: 'string', sortBy: 'WeekNo' },
        { name: 'Player', type: 'string' },
        { name: 'Crew', type: 'string' },
        { name: 'Court', type: 'string' },
        { name: 'Points', type: 'int64' },
        { name: 'Assists', type: 'int64' },
        { name: 'Rebounds', type: 'int64' },
        { name: 'Dunks', type: 'int64' },
        { name: 'Threes', type: 'int64' },
        { name: 'Win', type: 'int64' },
        { name: 'CrowdDb', type: 'double', format: '0.0', summarize: 'average' }
      ],
      rows
    }
  ],
  resources: { 'blacktop-bg.svg': bg, 'blacktop-title.svg': graffiti(), 'blacktop-ball.svg': ball, 'blacktop-tape.svg': tape, 'blacktop-crown.svg': crown },
  pages: [
    {
      name: 'Summer League',
      background: { color: '#26272B', image: 'blacktop-bg.svg' },
      wallpaper: '#111111',
      visuals: (seed) => {
        const k = kit(seed, T)
        return [
          k.img({ name: 'title', x: 14, y: 6, w: 640, h: 175, src: 'blacktop-title.svg' }),
          k.text({
            name: 'tag',
            x: 660,
            y: 52,
            w: 290,
            h: 40,
            align: 'center',
            runs: [{ text: 'SUMMER LEAGUE  ·  WEEKS 1–10', font: 'Barlow Black', size: 13, italic: true, color: '#120A1C' }],
            box: { background: { color: c(T.yellow) }, border: { color: c('#120A1C'), width: 3, radius: 2 }, padding: { top: 8, left: 8, right: 8, bottom: 4 } },
            style: { rotate: -4 }
          }),
          k.slicer({
            name: 'crew',
            x: 680,
            y: 112,
            w: 250,
            h: 58,
            field: D('Crew'),
            header: 'PICK YOUR CREW',
            headColor: '#FFFFFF',
            headFont: 'Barlow Black',
            headSize: 10,
            font: 'Barlow Semibold',
            itemBg: '#F4F1E8',
            outline: 'Frame',
            outlineColor: '#120A1C',
            box: { background: { color: c('#120A1C') }, padding: 6 },
            style: { rotate: 2 }
          }),
          k.img({ name: 'ball', x: 1050, y: 14, w: 200, h: 200, src: 'blacktop-ball.svg' }),
          ...kpi(k, 0, 'POINTS', 'Points', 'Points Note', T.orange, '#120A1C', -3),
          ...kpi(k, 1, 'ASSISTS', 'Assists', 'Assists Note', T.yellow, '#120A1C', 2),
          ...kpi(k, 2, 'BOARDS', 'Boards', 'Boards Note', T.blue, '#FFFFFF', -1.5),
          ...kpi(k, 3, 'DUNKS', 'Dunks', 'Dunks Note', '#F4F1E8', '#120A1C', 3),
          k.column({
            name: 'leaders',
            x: 30,
            y: 360,
            w: 430,
            h: 330,
            horizontal: true,
            cat: D('Player'),
            val: [F('Points')],
            colors: [T.orange],
            labels: true,
            labelColor: '#120A1C',
            yAxis: false,
            grid: false,
            axisColor: '#120A1C',
            axisSize: 10,
            sort: { field: F('Points') },
            box: { ...stickerBox('#F4F1E8'), padding: 14, title: titleRun('SCORING LEADERS') },
            style: { rotate: -1.2 }
          }),
          k.img({ name: 'crown', x: 380, y: 342, w: 60, h: 48, src: 'blacktop-crown.svg' }),
          k.table({
            name: 'standings',
            x: 486,
            y: 366,
            w: 400,
            h: 236,
            fields: [as(D('Crew'), 'CREW'), as(F('Wins'), 'W'), as(F('Win %'), 'WIN %'), as(F('PPG'), 'PPG'), as(F('Dunks'), 'DUNKS')],
            headBg: T.yellow,
            headColor: '#120A1C',
            headFont: 'Barlow Black',
            headSize: 10,
            rowBg: '#120A1C',
            rowAlt: '#1F1A26',
            color: '#F4F1E8',
            font: 'Barlow Semibold',
            size: 12,
            lineColor: '#3A3340',
            rowPadding: 6,
            sort: { field: F('Wins') },
            box: { ...stickerBox('#120A1C', T.yellow), padding: 12, title: titleRun('CREW STANDINGS', T.yellow) },
            style: { rotate: 1 }
          }),
          k.text({ name: 'hype-tag', x: 500, y: 622, w: 380, h: 70, runs: [{ text: 'NEXT RUN', font: 'Barlow Black', size: 10, italic: true, color: T.yellow }, { text: ' Saturday at The Rooftop. Winners stay on, losers buy the drinks.', font: 'Barlow Semibold', size: 10, color: '#F4F1E8' }] }),
          k.line({
            name: 'hype',
            x: 910,
            y: 250,
            w: 340,
            h: 210,
            cat: D('Week'),
            val: [F('Crowd Hype')],
            colors: [T.pink],
            width: 3.5,
            markers: true,
            markerSize: 5,
            yAxis: false,
            grid: false,
            labels: true,
            axisColor: '#120A1C',
            axisSize: 7,
            box: { ...stickerBox('#F4F1E8'), padding: 12, title: titleRun('CROWD HYPE') },
            style: { rotate: 2.5 }
          }),
          k.donut({
            name: 'courts',
            x: 920,
            y: 488,
            w: 330,
            h: 200,
            cat: D('Court'),
            val: F('Points'),
            innerRadius: 45,
            legend: 'Right',
            labelStyle: 'Percent of total',
            colorMap: { 'Pier 9': T.orange, 'The Cage': T.blue, 'The Rooftop': T.yellow, 'Union Park': T.pink },
            box: { ...stickerBox('#120A1C', '#F4F1E8'), padding: 12, title: titleRun('COURT HEAT', '#F4F1E8') },
            objects: { legend: { show: true, position: 'Right', labelColor: c('#F4F1E8'), fontFamily: 'Barlow Semibold', fontSize: 9 }, labels: { show: true, color: c('#F4F1E8'), fontSize: 9, fontFamily: 'Barlow Semibold', labelStyle: 'Percent of total', percentageLabelPrecision: 0 } },
            style: { rotate: -2 }
          })
        ]
      }
    }
  ]
}

/**
 * Conditional-formatting icons (PBI "Icons" format style) and KPI status/trend graphics.
 *
 * Power BI persists icon names as string literals. The built-in names (the set the format pane's
 * icon styles write, e.g. 'CircleHigh', 'SignMedium', 'SignLow', 'ColoredArrowUp', 'FlagLow',
 * 'SignalBarMedium2Colored', 'Quadrant75') are resolved exactly through `PBI_ICONS`. Other spellings
 * (older reports, hand-written rules: 'circleGreen', 'ArrowDownRed', 'quarters2'...) fall back to
 * keyword resolution (shape + color + direction) so they still render sensibly.
 *
 * Icon names source: the community-documented list of PBI icon ids (RADACAD "Power BI Icon Names
 * for Conditional Formatting Using DAX"; Fabric community "What are the icon IDs in July update").
 * Shapes/colors follow the matching Excel/PBI icon sets: Signs = green circle / yellow triangle /
 * red diamond; Symbols = check / exclamation / x; 5 colored arrows = green, yellow ×3, red; Harvey
 * balls ("Circle25"...); rating bars ("SignalBar..."); 2×2 boxes ("Quadrant..."). Approximation:
 * the exact PBI glyph art and the tint of the "...Light" variants are not published; we draw
 * close vector equivalents.
 */

/**
 * PBI icon palette (green / yellow / red / near-black as rendered by the built-in icon sets). Sampled
 * from a Power BI Desktop rendering of the KPI status graphics (SQLBI, "KPI in Tabular models for
 * Power BI and Excel"), which uses the same glyphs as the conditional-formatting icon sets.
 */
export const ICON_COLORS = {
  green: '#79C75B',
  red: '#C0433A',
  yellow: '#E8D62E',
  amber: '#E8D62E',
  orange: '#E66C37',
  gray: '#A19F9D',
  grey: '#A19F9D',
  black: '#252423',
  blue: '#118DFF',
  white: '#FFFFFF',
  pink: '#F1A7A9',
  gold: '#F2C80F'
} as const
/** unfilled parts of leveled icons (bars, boxes) and the light-gray KPI star (same source) */
export const ICON_EMPTY = '#C7C7C7'
const COLORS: Record<string, string> = ICON_COLORS

/** lighter tints used by the "...Light" icon variants (approximation) */
const LIGHT = { green: '#8DD5A0', yellow: '#F8E387', red: '#EBA2A9', gold: '#F8E387' }

export type IconShape =
  | 'circle'
  | 'trafficLight'
  | 'triangleUp'
  | 'triangleDown'
  | 'diamond'
  | 'square'
  | 'arrowUp'
  | 'arrowDown'
  | 'arrowRight'
  | 'arrowUpRight'
  | 'arrowDownRight'
  | 'check'
  | 'x'
  | 'exclamation'
  | 'flag'
  | 'star'
  | 'starHalf'
  | 'starEmpty'
  | 'quarter'
  | 'bars'
  | 'boxes'
  | 'dash'
  /** thin stroked arrow (KPI "Standard Arrow" / "Status Arrow" graphics); direction in `dir` */
  | 'thinArrow'

export interface IconSpec {
  shape: IconShape
  color: string
  /** quarters / bars / boxes fill level 0..4 */
  level?: number
  /** circle drawn as a ring (cut-out center) */
  ring?: boolean
  /** check / x / exclamation without the circle/triangle background ("Symbols (uncircled)") */
  plain?: boolean
  /** thinArrow direction */
  dir?: 'up' | 'upRight' | 'right' | 'downRight' | 'down'
  /** stars: fill the unfilled part with this color instead of outlining it (KPI stars) */
  emptyFill?: string
}

const G = ICON_COLORS.green
const Y = ICON_COLORS.yellow
const R = ICON_COLORS.red
const K = ICON_COLORS.black
const GR = ICON_COLORS.gray
const BLUE = ICON_COLORS.blue

/** Built-in Power BI icon names → icon. Keys are lower-case. */
export const PBI_ICONS: Record<string, IconSpec> = Object.fromEntries(
  (
    [
      // Signs (High = green circle, Medium = yellow triangle, Low = red diamond)
      ['SignHigh', { shape: 'circle', color: G }],
      ['SignMedium', { shape: 'triangleUp', color: Y }],
      ['SignLow', { shape: 'diamond', color: R }],
      // Circles (3 traffic lights unrimmed) and the red-to-black set
      ['CircleHigh', { shape: 'circle', color: G }],
      ['CircleMedium', { shape: 'circle', color: Y }],
      ['CircleLow', { shape: 'circle', color: R }],
      ['CircleMedium1', { shape: 'circle', color: ICON_COLORS.pink }],
      ['4CircleMedium2', { shape: 'circle', color: GR }],
      ['4CircleLow', { shape: 'circle', color: K }],
      // Harvey balls
      ['CircleEmpty', { shape: 'quarter', color: K, level: 0 }],
      ['Circle25', { shape: 'quarter', color: K, level: 1 }],
      ['CircleHalf', { shape: 'quarter', color: K, level: 2 }],
      ['Circle75', { shape: 'quarter', color: K, level: 3 }],
      ['CircleFilled', { shape: 'quarter', color: K, level: 4 }],
      // Symbols (uncircled / circled)
      ['SymbolHigh', { shape: 'check', color: G, plain: true }],
      ['SymbolMedium', { shape: 'exclamation', color: Y, plain: true }],
      ['SymbolLow', { shape: 'x', color: R, plain: true }],
      ['CircleSymbolHigh', { shape: 'check', color: G }],
      ['CircleSymbolMedium', { shape: 'exclamation', color: Y }],
      ['CircleSymbolLow', { shape: 'x', color: R }],
      // Traffic lights (rimmed)
      ['TrafficHigh', { shape: 'trafficLight', color: G }],
      ['TrafficMedium', { shape: 'trafficLight', color: Y }],
      ['TrafficLow', { shape: 'trafficLight', color: R }],
      ['TrafficBlackRimmed', { shape: 'trafficLight', color: K }],
      ['TrafficHighLight', { shape: 'trafficLight', color: LIGHT.green }],
      ['TrafficMediumLight', { shape: 'trafficLight', color: LIGHT.yellow }],
      ['TrafficLowLight', { shape: 'trafficLight', color: LIGHT.red }],
      ['TrafficBlackRimmedLight', { shape: 'trafficLight', color: GR }],
      // Arrows (colored: 5 arrows green / yellow ×3 / red; grey)
      ['ColoredArrowUp', { shape: 'arrowUp', color: G }],
      ['ColoredArrowUpRight', { shape: 'arrowUpRight', color: Y }],
      ['ColoredArrowRight', { shape: 'arrowRight', color: Y }],
      ['ColoredArrowDownRight', { shape: 'arrowDownRight', color: Y }],
      ['ColoredArrowDown', { shape: 'arrowDown', color: R }],
      ['GreyArrowUp', { shape: 'arrowUp', color: GR }],
      ['GreyArrowUpRight', { shape: 'arrowUpRight', color: GR }],
      ['GreyArrowRight', { shape: 'arrowRight', color: GR }],
      ['GreyArrowDownRight', { shape: 'arrowDownRight', color: GR }],
      ['GreyArrowDown', { shape: 'arrowDown', color: GR }],
      // Flags
      ['FlagHigh', { shape: 'flag', color: G }],
      ['FlagMedium', { shape: 'flag', color: Y }],
      ['FlagLow', { shape: 'flag', color: R }],
      ['FlagBlack', { shape: 'flag', color: K }],
      // Stars (3 stars: full / half / empty)
      ['StarHigh', { shape: 'star', color: ICON_COLORS.gold }],
      ['StarMedium', { shape: 'starHalf', color: ICON_COLORS.gold }],
      ['StarLow', { shape: 'starEmpty', color: ICON_COLORS.gold }],
      ['StarHighLight', { shape: 'star', color: LIGHT.gold }],
      ['StarMediumLight', { shape: 'starHalf', color: LIGHT.gold }],
      // Triangles (3 triangles: up green / dash yellow / down red)
      ['TriangleHigh', { shape: 'triangleUp', color: G }],
      ['TriangleMedium', { shape: 'dash', color: Y }],
      ['TriangleLow', { shape: 'triangleDown', color: R }],
      // Rating bars
      ['SignalBarEmpty', { shape: 'bars', color: K, level: 0 }],
      ['SignalBarLow', { shape: 'bars', color: K, level: 1 }],
      ['SignalBarMedium', { shape: 'bars', color: K, level: 2 }],
      ['SignalBarMedium2', { shape: 'bars', color: K, level: 3 }],
      ['SignalBarFull', { shape: 'bars', color: K, level: 4 }],
      ['SignalBarLowColored', { shape: 'bars', color: BLUE, level: 1 }],
      ['SignalBarMediumColored', { shape: 'bars', color: BLUE, level: 2 }],
      ['SignalBarMedium2Colored', { shape: 'bars', color: BLUE, level: 3 }],
      ['SignalBarFullColored', { shape: 'bars', color: BLUE, level: 4 }],
      // Boxes (2×2 quadrants)
      ['QuadrantEmpty', { shape: 'boxes', color: K, level: 0 }],
      ['Quadrant25', { shape: 'boxes', color: K, level: 1 }],
      ['Quadrant50', { shape: 'boxes', color: K, level: 2 }],
      ['Quadrant75', { shape: 'boxes', color: K, level: 3 }],
      ['QuadrantFull', { shape: 'boxes', color: K, level: 4 }],
      ['Quadrant25Colored', { shape: 'boxes', color: BLUE, level: 1 }],
      ['Quadrant50Colored', { shape: 'boxes', color: BLUE, level: 2 }],
      ['Quadrant75Colored', { shape: 'boxes', color: BLUE, level: 3 }],
      ['QuadrantFullColored', { shape: 'boxes', color: BLUE, level: 4 }]
    ] as Array<[string, IconSpec]>
  ).map(([k, v]) => [k.toLowerCase(), v])
)

/** Power BI's built-in icon styles (format pane "Style" list), best icon first. */
export const PBI_ICON_SETS: Array<{ id: string; label: string; icons: string[] }> = [
  { id: 'arrows3', label: '3 arrows (colored)', icons: ['ColoredArrowUp', 'ColoredArrowRight', 'ColoredArrowDown'] },
  { id: 'arrows3Gray', label: '3 arrows (gray)', icons: ['GreyArrowUp', 'GreyArrowRight', 'GreyArrowDown'] },
  { id: 'arrows4', label: '4 arrows (colored)', icons: ['ColoredArrowUp', 'ColoredArrowUpRight', 'ColoredArrowDownRight', 'ColoredArrowDown'] },
  { id: 'arrows4Gray', label: '4 arrows (gray)', icons: ['GreyArrowUp', 'GreyArrowUpRight', 'GreyArrowDownRight', 'GreyArrowDown'] },
  { id: 'arrows5', label: '5 arrows (colored)', icons: ['ColoredArrowUp', 'ColoredArrowUpRight', 'ColoredArrowRight', 'ColoredArrowDownRight', 'ColoredArrowDown'] },
  { id: 'arrows5Gray', label: '5 arrows (gray)', icons: ['GreyArrowUp', 'GreyArrowUpRight', 'GreyArrowRight', 'GreyArrowDownRight', 'GreyArrowDown'] },
  { id: 'triangles', label: '3 triangles', icons: ['TriangleHigh', 'TriangleMedium', 'TriangleLow'] },
  { id: 'lights', label: '3 traffic lights (unrimmed)', icons: ['CircleHigh', 'CircleMedium', 'CircleLow'] },
  { id: 'lightsRimmed', label: '3 traffic lights (rimmed)', icons: ['TrafficHigh', 'TrafficMedium', 'TrafficLow'] },
  { id: 'lights4', label: '4 traffic lights', icons: ['TrafficHigh', 'TrafficMedium', 'TrafficLow', 'TrafficBlackRimmed'] },
  { id: 'redToBlack', label: 'Red to black', icons: ['CircleLow', 'CircleMedium1', '4CircleMedium2', '4CircleLow'] },
  { id: 'signs', label: '3 signs', icons: ['CircleHigh', 'SignMedium', 'SignLow'] },
  { id: 'symbolsCircled', label: '3 symbols (circled)', icons: ['CircleSymbolHigh', 'CircleSymbolMedium', 'CircleSymbolLow'] },
  { id: 'symbols', label: '3 symbols (uncircled)', icons: ['SymbolHigh', 'SymbolMedium', 'SymbolLow'] },
  { id: 'flags', label: '3 flags', icons: ['FlagHigh', 'FlagMedium', 'FlagLow'] },
  { id: 'stars', label: '3 stars', icons: ['StarHigh', 'StarMedium', 'StarLow'] },
  { id: 'harvey', label: '5 quarters', icons: ['CircleFilled', 'Circle75', 'CircleHalf', 'Circle25', 'CircleEmpty'] },
  { id: 'bars', label: '5 rating bars', icons: ['SignalBarFullColored', 'SignalBarMedium2Colored', 'SignalBarMediumColored', 'SignalBarLowColored', 'SignalBarEmpty'] },
  { id: 'boxes', label: '5 boxes', icons: ['QuadrantFullColored', 'Quadrant75Colored', 'Quadrant50Colored', 'Quadrant25Colored', 'QuadrantEmpty'] }
]

/** Keyword fallback for non-built-in spellings. */
function resolveByKeyword(n: string): IconSpec | undefined {
  const colorKey = Object.keys(COLORS).find((c) => n.includes(c))
  // <Shape><High|Medium|Low> pattern: map the level to the KPI colors
  const lvl = /(high|medium|low)\d*$/.exec(n)?.[1]
  let color = colorKey ? COLORS[colorKey] : lvl === 'high' ? G : lvl === 'medium' ? Y : lvl === 'low' ? R : undefined
  const level = /(\d)/.exec(n)?.[1]
  if (n.includes('star'))
    return { shape: n.includes('half') || lvl === 'medium' ? 'starHalf' : n.includes('empty') || n.includes('outline') || lvl === 'low' ? 'starEmpty' : 'star', color: colorKey ? color! : ICON_COLORS.gold }
  if (n.includes('quarter') || n.includes('pie') || n.includes('harvey')) return { shape: 'quarter', color: color ?? K, level: level ? Number(level) : 2 }
  if (n.includes('quadrant') || n.includes('box')) return { shape: 'boxes', color: color ?? K, level: level ? Number(level) : 2 }
  if (n.includes('bar') || n.includes('signal')) return { shape: 'bars', color: color ?? BLUE, level: level ? Number(level) : 2 }
  if (n.includes('flag')) return { shape: 'flag', color: color ?? R }
  if (n.includes('check') || n.includes('tick')) return { shape: 'check', color: color ?? G }
  if (n.includes('exclamation') || n.includes('warning') || n.includes('alert')) return { shape: 'exclamation', color: color ?? Y }
  if (n.includes('cross') || n === 'x' || /^x[a-z]*$/.test(n) || n.includes('xmark')) return { shape: 'x', color: color ?? R }
  if (n.includes('symbol')) {
    const shape = lvl === 'high' ? 'check' : lvl === 'low' ? 'x' : 'exclamation'
    return { shape, color: color ?? Y, plain: !n.includes('circle') }
  }
  if (n.includes('traffic')) return { shape: 'trafficLight', color: color ?? GR }
  if (n.includes('arrow') || /(^|[^a-z])(up|down|right|side)/.test(n) || n.includes('up') || n.includes('down') || n.includes('right') || n.includes('side')) {
    const shape: IconShape =
      n.includes('upright') || n.includes('diagonalup') ? 'arrowUpRight' : n.includes('downright') || n.includes('diagonaldown') ? 'arrowDownRight' : n.includes('up') ? 'arrowUp' : n.includes('down') ? 'arrowDown' : 'arrowRight'
    if (!color) color = shape === 'arrowUp' ? G : shape === 'arrowDown' ? R : Y
    if (n.includes('triangle')) return { shape: shape === 'arrowDown' ? 'triangleDown' : shape === 'arrowUp' ? 'triangleUp' : 'dash', color }
    return { shape, color }
  }
  if (n.includes('triangle')) return lvl === 'high' ? { shape: 'triangleUp', color: G } : lvl === 'low' ? { shape: 'triangleDown', color: R } : { shape: 'triangleUp', color: color ?? Y }
  if (n.includes('sign')) return lvl === 'high' ? { shape: 'circle', color: G } : lvl === 'low' ? { shape: 'diamond', color: R } : { shape: 'triangleUp', color: color ?? Y }
  if (n.includes('diamond')) return { shape: 'diamond', color: color ?? R }
  if (n.includes('square')) return { shape: 'square', color: color ?? GR }
  if (n.includes('dash') || n.includes('minus') || n.includes('flat')) return { shape: 'dash', color: color ?? Y }
  if (n.includes('circle') || n.includes('dot') || n.includes('light') || color) return { shape: 'circle', color: color ?? GR, ring: n.includes('cut') || n.includes('ring') }
  return undefined
}

export function resolveIcon(name: string): IconSpec | undefined {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!n) return undefined
  return PBI_ICONS[n] ?? KPI_ICONS[n] ?? resolveByKeyword(n)
}

// ---------------------------------------------------------------------------------------------
// KPI status / trend (AS-style KPIs: hidden `_<m> Status` / `_<m> Trend` measures)
// ---------------------------------------------------------------------------------------------

/**
 * KPI-only glyphs (Power BI draws them for AS/tabular KPI status graphics but they are not in the
 * conditional-formatting icon list): thin "Standard Arrow" / "Status Arrow" arrows and the black /
 * light-gray stars of "Three Stars Colored". Keys are lower-case like PBI_ICONS.
 */
export const KPI_ICONS: Record<string, IconSpec> = Object.fromEntries(
  (
    [
      ['KpiArrowDown', { shape: 'thinArrow', dir: 'down', color: K }],
      ['KpiArrowDownRight', { shape: 'thinArrow', dir: 'downRight', color: K }],
      ['KpiArrowRight', { shape: 'thinArrow', dir: 'right', color: K }],
      ['KpiArrowUpRight', { shape: 'thinArrow', dir: 'upRight', color: K }],
      ['KpiArrowUp', { shape: 'thinArrow', dir: 'up', color: K }],
      ['KpiArrowDownRed', { shape: 'thinArrow', dir: 'down', color: R }],
      ['KpiArrowDownRightYellow', { shape: 'thinArrow', dir: 'downRight', color: Y }],
      ['KpiArrowRightYellow', { shape: 'thinArrow', dir: 'right', color: Y }],
      ['KpiArrowUpRightYellow', { shape: 'thinArrow', dir: 'upRight', color: Y }],
      ['KpiArrowUpGreen', { shape: 'thinArrow', dir: 'up', color: G }],
      ['KpiStarEmpty', { shape: 'starEmpty', color: '#000000', emptyFill: ICON_EMPTY }],
      ['KpiStarHalf', { shape: 'starHalf', color: '#000000', emptyFill: ICON_EMPTY }],
      ['KpiStarFull', { shape: 'star', color: '#000000' }]
    ] as Array<[string, IconSpec]>
  ).map(([k, v]) => [k.toLowerCase(), v])
)

/**
 * Power BI's rendering of TOM KPI status graphics, value -2..2 → icon (null = no icon). Source: the
 * Power BI Desktop table of every status graphic × status value in SQLBI's "KPI in Tabular models for
 * Power BI and Excel" (Marco Russo). Three-state graphics only recognize -1/0/1; graphics PBI supports
 * with five states also take -2/2 (the three-color ones show a black / empty icon there). Cylinder,
 * Smiley Face and Thermometer render exactly like Shapes in Power BI (not as their names suggest).
 */
const N = null
const SHAPES3 = [N, 'SignLow', 'SignMedium', 'CircleHigh', N]
export const KPI_STATUS_GRAPHICS: Record<string, Array<string | null>> = {
  shapes: SHAPES3,
  cylinder: SHAPES3,
  smileyface: SHAPES3,
  thermometer: SHAPES3,
  roadsigns: [N, 'CircleSymbolLow', 'CircleSymbolMedium', 'CircleSymbolHigh', N],
  threesymbolsuncircledcolored: [N, 'SymbolLow', 'SymbolMedium', 'SymbolHigh', N],
  trafficlight: ['TrafficBlackRimmed', 'TrafficLow', 'TrafficMedium', 'TrafficHigh', 'TrafficBlackRimmed'],
  trafficlightsingle: ['4CircleLow', 'CircleLow', 'CircleMedium', 'CircleHigh', '4CircleLow'],
  threecirclescolored: ['4CircleLow', 'CircleLow', 'CircleMedium', 'CircleHigh', '4CircleLow'],
  threeflagscolored: ['FlagBlack', 'FlagLow', 'FlagMedium', 'FlagHigh', 'FlagBlack'],
  threestarscolored: ['KpiStarEmpty', 'KpiStarEmpty', 'KpiStarHalf', 'KpiStarFull', 'KpiStarEmpty'],
  fivebarscolored: ['SignalBarEmpty', 'SignalBarLow', 'SignalBarMedium', 'SignalBarMedium2', 'SignalBarFull'],
  fiveboxescolored: ['QuadrantEmpty', 'Quadrant25', 'Quadrant50', 'Quadrant75', 'QuadrantFull'],
  gaugeascending: ['CircleEmpty', 'Circle25', 'CircleHalf', 'Circle75', 'CircleFilled'],
  gaugedescending: ['CircleFilled', 'Circle75', 'CircleHalf', 'Circle25', 'CircleEmpty'],
  standardarrow: ['KpiArrowDown', 'KpiArrowDownRight', 'KpiArrowRight', 'KpiArrowUpRight', 'KpiArrowUp'],
  statusarrowascending: ['KpiArrowDownRed', 'KpiArrowDownRightYellow', 'KpiArrowRightYellow', 'KpiArrowUpRightYellow', 'KpiArrowUpGreen'],
  statusarrowdescending: ['KpiArrowUpGreen', 'KpiArrowUpRightYellow', 'KpiArrowRightYellow', 'KpiArrowDownRightYellow', 'KpiArrowDownRed']
}

/** Default when a KPI has no status graphic: Traffic Light - Single (the tabular designer default). */
const DEFAULT_STATUS_GRAPHIC = 'trafficlightsingle'
/** Trend graphic when the model doesn't expose one: thin arrows, as PBI draws KPI trends. */
const DEFAULT_TREND_GRAPHIC = 'standardarrow'

function graphicKey(g: string | undefined): string {
  return (g ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Is this status graphic one Power BI draws (else PBI shows the raw status number)? */
export function isSupportedKpiGraphic(graphic: string | undefined): boolean {
  return !graphic || graphicKey(graphic) in KPI_STATUS_GRAPHICS
}

/**
 * Icon for a KPI value rendered with a status graphic, following Power BI: only integer values are
 * drawn (a decimal status shows the number), unknown graphics show the number, values outside the
 * graphic's states show nothing ('' = empty cell).
 */
export function kpiGraphicIcon(value: unknown, graphic: string | undefined, fallback = DEFAULT_STATUS_GRAPHIC): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined
  const icons = KPI_STATUS_GRAPHICS[graphic ? graphicKey(graphic) : fallback]
  if (!icons) return undefined
  if (value < -2 || value > 2) return ''
  return icons[value + 2] ?? ''
}

/**
 * Icon name for a KPI status value (-1 bad, 0 neutral, 1 good; five-state graphics -2..2) rendered
 * with the KPI's status graphic. Undefined → show the value as a number; '' → empty cell.
 */
export function kpiStatusIcon(value: unknown, statusGraphic?: string): string | undefined {
  return kpiGraphicIcon(value, statusGraphic)
}

/** Icon name for a KPI trend value (-1 down, 0 flat, 1 up; -2..2 with five-state graphics). */
export function kpiTrendIcon(value: unknown, trendGraphic?: string): string | undefined {
  return kpiGraphicIcon(value, trendGraphic, DEFAULT_TREND_GRAPHIC)
}

/** KPI part of a field description → icon name for a value (undefined when not a status/trend field or not drawable). */
export function kpiIconFor(kpi: { part: string; statusGraphic?: string; trendGraphic?: string } | undefined, value: unknown): string | undefined {
  if (!kpi) return undefined
  if (kpi.part === 'status') return kpiStatusIcon(value, kpi.statusGraphic)
  if (kpi.part === 'trend') return kpiTrendIcon(value, kpi.trendGraphic)
  return undefined
}

/**
 * Code visual: the data the author's code receives (structured-clonable: it crosses the frame boundary by
 * postMessage). Built by renderer/src/visuals/code/codeModel.ts from the visual's query, consumed by the template evaluator
 * (template.ts, in the host) and the frame runtime (renderer/codeframe, for JSX).
 */

export type CellType = 'number' | 'text' | 'date' | 'boolean' | 'blank'

export interface CodeCell {
  /** raw value: numbers as numbers, dates as ISO strings (`2024-01-31` or `2024-01-31T08:00:00`), blank = null */
  value: number | string | boolean | null
  /** text formatted with the field's format string (Lumen's formatter, as native visuals) */
  formatted: string
  type: CellType
  /** cross-highlight: the value under the other visual's highlight (null = not highlighted); absent when none active */
  highlight?: number | string | boolean | null
  highlightFormatted?: string
}

export type CodeRole = 'rows' | 'values' | 'tooltips'

export interface CodeColumn {
  /** display name (visual-level rename, else the field's name) */
  name: string
  /** CSS identifier (naming.ts) */
  css: string
  /** JavaScript identifier (naming.ts) */
  js: string
  role: CodeRole
  /** 'group' = a grouping column (Rows / Categories well), 'value' = a measure or aggregation */
  kind: 'group' | 'value'
  /** engine data type (`string`, `int64`, `double`, `decimal`, `dateTime`, `boolean`…) */
  dataType: string
  formatString?: string
  /** grouping columns: hierarchy level index in the Rows well */
  level?: number
}

export interface CodeRow {
  index: number
  /** stable key of the row's identity (the same string while the row exists; selection uses it) */
  key: string
  /** the row's grouping values formatted and joined with " " (empty for a single total row) */
  label: string
  /** cells by column display name */
  cells: Record<string, CodeCell>
  /** this visual's own selection contains the row (false when nothing is selected) */
  selected: boolean
  /** cross-highlight from another visual: true / false, null when no highlight is active */
  highlighted: boolean | null
  /** expanded hierarchy: 0 = outermost level shown; the keys of the enclosing rows (outermost first) */
  depth: number
  parentKeys: string[]
  /** a drill-down from this row is possible (a lower level exists in the Rows well) */
  canDrill: boolean
}

export interface DrillLevelInfo {
  index: number
  name: string
}

export interface DrillInfo {
  /** levels of the Rows well (a hierarchy when there are two or more) */
  levels: DrillLevelInfo[]
  /** current (innermost shown) level */
  level: number
  levelName: string
  /** expanded "all down one level": the outermost level shown; equals `level` when not expanded */
  fromLevel: number
  /** drilled path: one entry per level drilled through */
  path: Array<{ level: number; field: string; value: CodeCell['value']; formatted: string }>
  /** the path as text: "Bikes > Road Bikes" (empty at the top) */
  breadcrumb: string
  canDrillDown: boolean
  canDrillUp: boolean
  /** drill mode (header "Drill down" toggle): a click on a row drills instead of selecting */
  drillMode: boolean
}

export interface ParamDef {
  /** identifier used in code (`params.accent`, `--param-accent`) */
  name: string
  label: string
  type: 'color' | 'number' | 'text' | 'toggle'
  default: string | number | boolean
}

export interface CodeData {
  columns: CodeColumn[]
  rows: CodeRow[]
  /** the measures at the grand total (all grouping removed); for a visual without Rows, the single row's values */
  totals: Record<string, CodeCell>
  /** rows were cut at the row limit (`rowLimit`) */
  truncated: boolean
  rowLimit: number
  hasHighlight: boolean
  hasSelection: boolean
  drill: DrillInfo
  params: Record<string, string | number | boolean>
  /** the declared type of each parameter (decides its CSS form: colour, number, string, 1 / 0) */
  paramTypes?: Record<string, ParamDef['type']>
  warnings: string[]
}

export interface ThemeInfo {
  /** data colours, 1-based in CSS (`--theme-color-1`) */
  colors: string[]
  foreground: string
  foregroundSecondary: string
  foregroundTertiary: string
  background: string
  backgroundLight: string
  backgroundNeutral: string
  good: string
  neutral: string
  bad: string
  accent: string
  hyperlink: string
  fontFamily: string
  /** text classes: px sizes and colours (`title`, `header`, `label`, `callout`…) */
  text: Record<string, { size: number; color: string; font: string }>
}

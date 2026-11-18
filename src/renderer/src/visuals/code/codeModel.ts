/**
 * Code visual: format resolution, theme summary and the data query (pure: no React, no DOM; unit-tested).
 *
 * Wells: Rows (`Category`, grouping, drillable hierarchy), Values (`Y`: measures and aggregated columns), Tooltips.
 * The query follows the native pipeline: the visual's filters (slicers, cross-filters, drill path), its sort definition,
 * "Show items with no data", field parameters, visual calculations, cross-highlight values, a row limit with a notice.
 */
import type { Scalar } from '@core/model/data'
import type { SortSpec, SummarizeRequest, SummarizeResult } from '@core/engine/api'
import { identityKey, type DataPointIdentity } from '@core/report/sq'
import type { ResolvedTheme } from '@core/report/theme'
import { uniqueNames } from '@core/codevisual/naming'
import { FORMAT_OBJECT, PARAMS_OBJECT, normaliseParam, readParamDefs } from '@core/codevisual/model'
import type { CellType, CodeCell, CodeColumn, CodeData, CodeRow, DrillInfo, ThemeInfo } from '@core/codevisual/types'
import type { VisualHostContext } from '../contract'
import { FormatReader } from '../common/fmtProps'
import { expandParameters, getProjections, labelOf, sortSpecs, valueId, type Projection } from '../common/query'
import { activeLevels, fieldRef, formatCategoryValue, type FieldRef } from '../common/categorical'
import { identityMatches } from '../common/interaction'
import { isVisualCalc, summarizeWithVisualCalcs } from '../common/visualCalcs'

export const ROWS_ROLE = 'Category'
export const VALUES_ROLE = 'Y'
export const TOOLTIPS_ROLE = 'Tooltips'
export const DEFAULT_ROW_LIMIT = 1000
export const MAX_ROW_LIMIT = 30000

export interface CodeFormat {
  overflow: 'hidden' | 'visible' | 'auto'
  /** row order when the visual has no sort of its own: the first value descending, or the Rows fields ascending */
  defaultSort: 'value' | 'category'
  rowLimit: number
  rowTooltips: boolean
  params: Record<string, string | number | boolean>
}

/** Every property the renderer reads, with its default (also run by `formatDefaults`). */
export function readCodeFormat(visualJson: any, theme: ResolvedTheme): CodeFormat {
  const f = new FormatReader(visualJson, theme)
  const ov = f.str(FORMAT_OBJECT, 'overflow', 'hidden')
  const params: Record<string, string | number | boolean> = {}
  for (const p of readParamDefs(visualJson)) {
    if (p.type === 'color') {
      // an automatic colour (empty) is left out: the code's own fallback (a theme colour) applies
      const c = f.color(PARAMS_OBJECT, p.name, String(p.default))
      if (c) params[p.name] = c
    }
    else if (p.type === 'number') params[p.name] = f.num(PARAMS_OBJECT, p.name, Number(p.default))
    else if (p.type === 'toggle') params[p.name] = f.bool(PARAMS_OBJECT, p.name, p.default === true)
    else params[p.name] = normaliseParam('text', f.str(PARAMS_OBJECT, p.name, String(p.default)))
  }
  return {
    overflow: ov === 'visible' || ov === 'auto' ? ov : 'hidden',
    defaultSort: f.str(FORMAT_OBJECT, 'defaultSort', 'value') === 'category' ? 'category' : 'value',
    rowLimit: Math.max(1, Math.min(MAX_ROW_LIMIT, Math.round(f.num(FORMAT_OBJECT, 'rowLimit', DEFAULT_ROW_LIMIT)))),
    rowTooltips: f.bool(FORMAT_OBJECT, 'rowTooltips', true),
    params
  }
}

/** The theme as the code sees it (`theme` prop, `--theme-*` variables). Text sizes in px. */
export function themeInfo(theme: ResolvedTheme): ThemeInfo {
  const text: ThemeInfo['text'] = {}
  const defaults: Record<string, number> = { title: 12, header: 12, label: 10, callout: 45, largeTitle: 14, dataTitle: 14, smallLabel: 9, lightLabel: 10 }
  const baseFont = "'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif"
  for (const [cls, pt] of Object.entries(defaults)) {
    const tc = theme.textClasses?.[cls] ?? {}
    text[cls] = { size: Math.round(((tc.fontSize ?? pt) * 96) / 72 * 100) / 100, color: tc.color ?? theme.foreground, font: tc.fontFace ?? baseFont }
  }
  return {
    colors: [...theme.dataColors],
    foreground: theme.foreground,
    foregroundSecondary: theme.foregroundNeutralSecondary,
    foregroundTertiary: theme.foregroundNeutralTertiary,
    background: theme.background,
    backgroundLight: theme.backgroundLight,
    backgroundNeutral: theme.backgroundNeutral,
    good: theme.good,
    neutral: theme.neutral,
    bad: theme.bad,
    accent: theme.tableAccent,
    hyperlink: theme.hyperlink,
    fontFamily: theme.textClasses?.label?.fontFace ?? baseFont,
    text
  }
}

// ---------------------------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------------------------

export interface CodeQuery {
  data: CodeData
  /** identity of each row key (selection, drill, tooltips, context menu) */
  identities: Map<string, DataPointIdentity>
  /** tooltip lines per row key (Rows + Values + Tooltips fields) */
  tooltip(key: string): Array<{ label: string; value: string }>
  /** flat table for Show as a table / Export data */
  table: { columns: string[]; rows: Scalar[][] }
}

export function hasCodeFields(visualJson: any): boolean {
  const r = getProjections(visualJson)
  return (r[ROWS_ROLE]?.length ?? 0) + (r[VALUES_ROLE]?.length ?? 0) + (r[TOOLTIPS_ROLE]?.length ?? 0) > 0
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Dates as ISO text (UTC fields = wall clock); time omitted at midnight. */
export function isoOf(d: Date): string {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  if (!d.getUTCHours() && !d.getUTCMinutes() && !d.getUTCSeconds()) return date
  return `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function plain(v: Scalar): { value: CodeCell['value']; type: CellType } {
  if (v === null || v === undefined) return { value: null, type: 'blank' }
  if (v instanceof Date) return { value: isoOf(v), type: 'date' }
  if (typeof v === 'number') return { value: Number.isFinite(v) ? v : null, type: Number.isFinite(v) ? 'number' : 'blank' }
  if (typeof v === 'boolean') return { value: v, type: 'boolean' }
  if (v instanceof Uint8Array) return { value: null, type: 'blank' }
  return { value: String(v), type: 'text' }
}

interface Field {
  proj: Projection
  ref: FieldRef
  col: CodeColumn
}

export function queryCodeData(visualJson: any, ctx: VisualHostContext, fmt: CodeFormat): CodeQuery {
  const roles = getProjections(visualJson)
  const allLevels = expandParameters(roles[ROWS_ROLE] ?? [], ctx)
  const levelsP = activeLevels(allLevels, ctx)
  const valuesP = expandParameters(roles[VALUES_ROLE] ?? [], ctx)
  const tipsP = expandParameters(roles[TOOLTIPS_ROLE] ?? [], ctx).filter((p) => p.isMeasure)

  const levelIndex = (p: Projection) => allLevels.indexOf(p)
  const names = uniqueNames([...levelsP, ...valuesP, ...tipsP].map((p) => labelOf(ctx, p)))
  const fields: Field[] = []
  ;[...levelsP, ...valuesP, ...tipsP].forEach((p, i) => {
    const ref = fieldRef(ctx, p)
    const role = i < levelsP.length ? 'rows' : i < levelsP.length + valuesP.length ? 'values' : 'tooltips'
    const desc = ref.desc
    fields.push({
      proj: p,
      ref,
      col: {
        name: labelOf(ctx, p),
        css: names[i].css,
        js: names[i].js,
        role,
        kind: role === 'rows' ? 'group' : 'value',
        dataType: String(desc?.dataType ?? (role === 'rows' ? 'string' : 'double')),
        ...(desc?.formatString ? { formatString: desc.formatString } : {}),
        ...(role === 'rows' ? { level: levelIndex(p) } : {})
      }
    })
  })
  const groupF = fields.filter((f) => f.col.role === 'rows')
  const valueF = fields.filter((f) => f.col.kind === 'value')

  const showAll = levelsP.some((p) => p.raw?.showAll === true)
  const highlight = ctx.highlightFilters?.length ? ctx.highlightFilters : undefined
  const defaultSort = (groups: Projection[]): SortSpec[] =>
    fmt.defaultSort === 'value' && valuesP.length && groups.length
      ? [{ target: { value: valueId(valuesP[0]) }, direction: 'desc' }]
      : groups.map((_, i) => ({ target: { group: i }, direction: 'asc' as const }))

  const run = (groups: Projection[], limit: number | undefined): SummarizeResult => {
    const values = [...valuesP, ...tipsP]
    const s = sortSpecs(visualJson, groups, values)
    const req: SummarizeRequest = {
      groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
      values: values.map((v) => ({ id: valueId(v), expr: { kind: 'sq', expr: v.expr } })),
      filters: ctx.filters,
      orderBy: s.length ? s : defaultSort(groups),
      limit,
      showItemsWithNoData: showAll && groups.length > 0,
      keepBlankRows: groups.length === 0,
      highlightFilters: highlight
    }
    return values.some(isVisualCalc) ? summarizeWithVisualCalcs(ctx, req, groups, values) : ctx.engine.summarize(req)
  }

  const warnings: string[] = []
  const limit = fmt.rowLimit
  const cellsOf = (res: SummarizeResult, ri: number, groups: Field[]): { cells: Record<string, CodeCell>; values: Scalar[]; highlighted: boolean | null } => {
    const row = res.rows[ri]
    const cells: Record<string, CodeCell> = {}
    const flat: Scalar[] = []
    groups.forEach((g, gi) => {
      const v = row[gi] ?? null
      flat.push(v)
      cells[g.col.name] = { ...plain(v), formatted: v === null ? '(Blank)' : formatCategoryValue(ctx, g.ref, v) }
    })
    let anyHighlight = false
    valueF.forEach((f, vi) => {
      const v = row[groups.length + vi] ?? null
      flat.push(v)
      const fs = res.formats?.[ri]?.[vi] ?? res.columns[groups.length + vi]?.formatString ?? f.col.formatString
      const cell: CodeCell = { ...plain(v), formatted: v === null ? '' : ctx.format(v, fs) }
      if (res.highlights) {
        const h = res.highlights[ri]?.[vi] ?? null
        cell.highlight = plain(h).value
        cell.highlightFormatted = h === null ? '' : ctx.format(h, fs)
        if (h !== null) anyHighlight = true
      }
      cells[f.col.name] = cell
    })
    return { cells, values: flat, highlighted: res.highlights ? anyHighlight : null }
  }

  const identities = new Map<string, DataPointIdentity>()
  const tipLines = new Map<string, Array<{ label: string; value: string }>>()
  const rows: CodeRow[] = []
  const tableRows: Scalar[][] = []
  let truncated = false
  const selection = ctx.selection ?? []
  const hasSelection = selection.length > 0
  const nLevels = allLevels.length
  const innermost = levelsP.length ? levelIndex(levelsP[levelsP.length - 1]) : 0

  const pushRow = (res: SummarizeResult, ri: number, depth: number, parentKeys: string[]): string => {
    const groups = groupF.slice(0, depth + 1 > groupF.length ? groupF.length : depth + 1)
    const { cells, values, highlighted } = cellsOf(res, ri, groups)
    const identity: DataPointIdentity = { fields: groups.map((g, gi) => ({ expr: g.ref.identityExpr, value: res.rows[ri][gi] ?? null })) }
    const key = groups.length ? identityKey(identity) : 'total'
    const label = groups.map((g) => cells[g.col.name].formatted).join(' ')
    const fieldLevel = groups.length ? levelIndex(groups[groups.length - 1].proj) : -1
    const row: CodeRow = {
      index: rows.length,
      key,
      label,
      cells,
      selected: hasSelection && groups.length > 0 && selection.some((s) => identityMatches(s, identity)),
      highlighted,
      depth,
      parentKeys,
      canDrill: groups.length > 0 && fieldLevel >= 0 && fieldLevel < nLevels - 1
    }
    rows.push(row)
    identities.set(key, identity)
    tipLines.set(key, [...groups, ...valueF].map((f) => ({ label: f.col.name, value: cells[f.col.name]?.formatted ?? '' })))
    tableRows.push(values)
    return key
  }

  if (groupF.length <= 1) {
    const res = run(levelsP, limit + 1)
    warnings.push(...(res.warnings ?? []))
    const n = Math.min(res.rows.length, limit)
    truncated = res.rows.length > limit || !!res.truncated
    for (let i = 0; i < n; i++) pushRow(res, i, 0, [])
  } else {
    // expanded hierarchy (Expand all down one level): every prefix level, parents before their children
    const byDepth = groupF.map((_, d) => run(levelsP.slice(0, d + 1), undefined))
    for (const r of byDepth) warnings.push(...(r.warnings ?? []))
    const prefixKey = (res: SummarizeResult, ri: number, d: number) => JSON.stringify(res.rows[ri].slice(0, d + 1).map((v) => (v instanceof Date ? v.getTime() : v)))
    const children = byDepth.map((res, d) => {
      const m = new Map<string, number[]>()
      if (d === 0) return m
      res.rows.forEach((_, ri) => {
        const k = prefixKey(res, ri, d - 1)
        m.set(k, [...(m.get(k) ?? []), ri])
      })
      return m
    })
    const walk = (d: number, ri: number, parents: string[]) => {
      if (rows.length >= limit) {
        truncated = true
        return
      }
      const key = pushRow(byDepth[d], ri, d, parents)
      if (d + 1 >= byDepth.length) return
      for (const ci of children[d + 1].get(prefixKey(byDepth[d], ri, d)) ?? []) walk(d + 1, ci, [...parents, key])
    }
    byDepth[0].rows.forEach((_, ri) => walk(0, ri, []))
  }

  // totals: the measures with all grouping removed (a visual without Rows: its single row)
  const totals: Record<string, CodeCell> = {}
  if (valueF.length) {
    if (!groupF.length && rows[0]) Object.assign(totals, Object.fromEntries(valueF.map((f) => [f.col.name, rows[0].cells[f.col.name]])))
    else {
      const t = run([], undefined)
      if (t.rows.length) {
        const c = cellsOf(t, 0, [])
        Object.assign(totals, c.cells)
      }
    }
  }

  const drill = drillInfo(ctx, allLevels, levelsP, innermost)
  const data: CodeData = {
    columns: fields.map((f) => f.col),
    rows,
    totals,
    truncated,
    rowLimit: limit,
    hasHighlight: !!highlight,
    hasSelection,
    drill,
    params: fmt.params,
    warnings
  }
  return {
    data,
    identities,
    tooltip: (key) => tipLines.get(key) ?? [],
    table: { columns: [...groupF, ...valueF].map((f) => f.col.name), rows: tableRows }
  }
}

/** The Rows well's levels as identity expressions (hierarchy levels resolved to their columns), for drill. */
export function drillLevelExprs(visualJson: any, ctx: VisualHostContext) {
  return expandParameters(getProjections(visualJson)[ROWS_ROLE] ?? [], ctx).map((p) => fieldRef(ctx, p).identityExpr)
}

function drillInfo(ctx: VisualHostContext, all: Projection[], active: Projection[], innermost: number): DrillInfo {
  const levels = all.map((p, i) => ({ index: i, name: labelOf(ctx, p) }))
  const from = active.length ? all.indexOf(active[0]) : 0
  const path = (ctx.drill?.path ?? []).map((id, i) => {
    const f = id.fields[id.fields.length - 1]
    const proj = all[i]
    const ref = proj ? fieldRef(ctx, proj) : undefined
    const formatted = f ? (f.value === null ? '(Blank)' : ref ? formatCategoryValue(ctx, ref, f.value) : String(f.value)) : ''
    return { level: i, field: levels[i]?.name ?? '', value: f ? plain(f.value).value : null, formatted }
  })
  return {
    levels,
    level: innermost,
    levelName: levels[innermost]?.name ?? '',
    fromLevel: from,
    path,
    breadcrumb: path.map((p) => p.formatted).join(' > '),
    canDrillDown: all.length > 1 && innermost < all.length - 1,
    canDrillUp: (ctx.drill?.level ?? 0) > 0 || (ctx.drill?.expandedLevel ?? 0) > 0 || innermost > 0,
    drillMode: !!ctx.drill?.drillMode
  }
}

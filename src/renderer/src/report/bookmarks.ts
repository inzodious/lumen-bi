/**
 * Bookmarks: capture the current report state into a PBIR bookmark and plan its application.
 *
 * PBIR bookmark (`definition/bookmarks/<name>.bookmark.json`):
 * {
 *   displayName, name,
 *   options?: { targetVisualNames?: string[], applyOnlyToTargetVisuals?, suppressData?, suppressDisplay?, suppressActiveSection? },
 *   explorationState: {
 *     version, activeSection,
 *     filters?: { byExpr: FilterCard-like[] },                       // report filters
 *     sections: { [page]: {
 *       filters?: { byExpr: [...] },                                  // page filters
 *       visualContainers?: { [visual]: {
 *         filters?: { byExpr: [...] },                                // visual filters
 *         singleVisual: { visualType, objects?: { merge: { general: [{ properties: { filter: { filter } } }] } },
 *                         display?: { mode: 'hidden' | 'spotlight' }, orderBy?: [{ Direction, Expression }],
 *                         activeProjections?: { [role]: [field] } } } },
 *       visualContainerGroups?: { [group]: { isHidden: true } } } }
 *   }
 * }
 * Bookmark filter entries use the legacy shape (`expression` instead of `field`); both are accepted.
 *
 * Focus mode / Show as a table: `singleVisual.display = { mode: 'maximize', maximizedOptions?: { dataTable: 'normal' } }`.
 * Cross-filter / cross-highlight selections: `visualContainers[v].highlight = { selection: SelectorsByColumn[],
 * filterExpressionMetadata }` (bookmark schema 1.4.0) — each selected data point is a `dataMap` from the field's
 * queryRef to `scopeId` Comparison selectors.
 */
import type { BookmarkDocument, PageDocument, ReportDocument } from '@core/report/types'
import { fieldKey, identitiesToFilter, literalValue, type DataPointIdentity, type SQFilter } from '@core/report/sq'
import { encodeLiteral } from '@core/report/literal'
import type { DrillState } from '../visuals/contract'
import { filterCards, isGroup, isSlicerType, newObjectName, savedSlicerFilter, visualFields, visualTypeOf, writeSlicerFilter, type FilterCard } from './pbir'
import { cloneDeep } from '@core/clone'

const BOOKMARK_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmark/1.4.0/schema.json'

export interface RuntimeSnapshot {
  activePage: string
  /** effective slicer filter (runtime overlay or saved) */
  slicerFilter(page: string, visual: string): SQFilter | undefined
  drill(page: string, visual: string): DrillState
  spotlight?: { page: string; visual: string } | null
  /** focus mode / show as table */
  focus?: { page: string; visual: string; mode: 'focus' | 'table' } | null
  /** data point selection per page (source visual + identities) */
  crossFilter?(page: string): { source: string; identities: DataPointIdentity[] } | undefined
}

// ---------------------------------------------------------------------------------------------
// Cross-highlight selections ⇄ PBIR HighlightState
// ---------------------------------------------------------------------------------------------

function queryRefFor(visualJson: any, expr: any): string {
  const key = fieldKey(expr)
  for (const role of Object.values<any>(visualJson?.visual?.query?.queryState ?? {})) {
    for (const p of role?.projections ?? []) if (fieldKey(p.field) === key && p.queryRef) return p.queryRef
  }
  return key
}

/** Selected data points → `highlight` state (SelectorsByColumn per identity + filter expression metadata). */
export function identitiesToHighlight(visualJson: any, ids: DataPointIdentity[]): any | undefined {
  if (!ids.length) return undefined
  const selection = ids.map((id) => {
    const dataMap: Record<string, any[]> = {}
    for (const f of id.fields) {
      const ref = queryRefFor(visualJson, f.expr)
      ;(dataMap[ref] ??= []).push({ scopeId: { Comparison: { ComparisonKind: 0, Left: cloneDeep(f.expr), Right: { Literal: { Value: encodeLiteral(f.value) } } } } })
    }
    return { dataMap }
  })
  const exprs = ids[0].fields.map((f) => cloneDeep(f.expr))
  return { selection, filterExpressionMetadata: { expressions: exprs } }
}

// ---------------------------------------------------------------------------------------------
// DecomposedSelectors (compressed HighlightState.selection, bookmark schema 1.4.0)
// ---------------------------------------------------------------------------------------------
//
// Power BI may store a selection as `DecomposedSelectors` instead of `SelectorsByColumn[]`. The format is not documented
// beyond Microsoft's bookmark JSON schema descriptions, and none of the public sample reports contain one, so this is
// derived from the schema (an APPROXIMATION of what Desktop writes; unknown parts are tolerated and the raw value is
// always kept in the bookmark file — Lumen only decodes it to apply the selection):
//   decomposedIdentities.columns  DecomposedTree[]: the boolean shape of a scope identity with the column expressions at
//                                 the leaves ({ value }) and And nodes as { left, right }
//   decomposedIdentities.values   [selector][identity] = { "<column index>": [expressions in leaf order] }
//   queryNames                    the dataMap keys (queryRefs)
//   queryNameMap                  [selector] = { "<queryName index>": [column index of each of its identities] }
//   metadata / id                 per selector (SelectorsByColumn.metadata / .id)
// A leaf + its expression is the Comparison `Left = Right` (ComparisonKind 0) of the expanded scopeId.

interface DecomposedTree {
  left?: DecomposedTree
  right?: DecomposedTree
  value?: any
}

function treeOf(scopeId: any): DecomposedTree | null {
  if (scopeId?.And) {
    const l = treeOf(scopeId.And.Left)
    const r = treeOf(scopeId.And.Right)
    return l && r ? { left: l, right: r } : null
  }
  const c = scopeId?.Comparison
  if (c && (c.ComparisonKind ?? 0) === 0 && c.Left) return { value: c.Left }
  return null
}

function leafValues(scopeId: any, out: any[]): void {
  if (scopeId?.And) {
    leafValues(scopeId.And.Left, out)
    leafValues(scopeId.And.Right, out)
  } else if (scopeId?.Comparison) out.push(scopeId.Comparison.Right)
}

function rebuild(tree: DecomposedTree | undefined, values: any[], at: { i: number }): any {
  if (!tree) return undefined
  if (tree.left || tree.right) {
    const l = rebuild(tree.left, values, at)
    const r = rebuild(tree.right, values, at)
    return l && r ? { And: { Left: l, Right: r } } : (l ?? r)
  }
  if (tree.value === undefined || at.i >= values.length) return undefined
  return { Comparison: { ComparisonKind: 0, Left: tree.value, Right: values[at.i++] } }
}

/** Expand a DecomposedSelectors value to the equivalent `SelectorsByColumn[]` (empty when it can't be read). */
export function decodeDecomposedSelectors(sel: any): any[] {
  const columns: DecomposedTree[] = sel?.decomposedIdentities?.columns ?? []
  const values: any[][] = sel?.decomposedIdentities?.values ?? []
  const names: string[] = sel?.queryNames ?? []
  if (!Array.isArray(values) || !Array.isArray(columns)) return []
  return values.map((identities, si) => {
    const dataMap: Record<string, any[]> = {}
    const ids = Array.isArray(identities) ? identities : []
    // identity j → queryName: walk queryNameMap[si] in key order, one identity per listed column index
    const order: Array<{ name: string; col: number }> = []
    const qm = sel?.queryNameMap?.[si]
    if (qm && typeof qm === 'object')
      for (const k of Object.keys(qm).sort((a, b) => Number(a) - Number(b))) for (const col of qm[k] ?? []) order.push({ name: names[Number(k)] ?? `q${k}`, col: Number(col) })
    ids.forEach((identity, j) => {
      const keys = Object.keys(identity ?? {})
      const col = order[j]?.col ?? Number(keys[0])
      const exprs: any[] = identity?.[String(col)] ?? identity?.[keys[0]] ?? []
      const scopeId = rebuild(columns[col], exprs, { i: 0 })
      if (!scopeId) return
      ;(dataMap[order[j]?.name ?? names[0] ?? 'selection'] ??= []).push({ scopeId })
    })
    const out: any = { dataMap }
    if (Array.isArray(sel?.metadata?.[si]) && sel.metadata[si].length) out.metadata = sel.metadata[si]
    if (typeof sel?.id?.[si] === 'string' && sel.id[si]) out.id = sel.id[si]
    return out
  })
}

/** Compress `SelectorsByColumn[]` (Comparison / And scope identities) to the DecomposedSelectors form. */
export function encodeDecomposedSelectors(selectors: any[]): any {
  const columns: DecomposedTree[] = []
  const colKeys: string[] = []
  const queryNames: string[] = []
  const values: any[][] = []
  const queryNameMap: Array<Record<string, number[]>> = []
  const metadata: string[][] = []
  const id: string[] = []
  let anyMeta = false
  let anyId = false
  for (const s of selectors) {
    const idents: any[] = []
    const qm: Record<string, number[]> = {}
    for (const [name, list] of Object.entries<any[]>(s?.dataMap ?? {})) {
      let qi = queryNames.indexOf(name)
      if (qi < 0) qi = queryNames.push(name) - 1
      for (const d of list ?? []) {
        const tree = treeOf(d?.scopeId)
        if (!tree) continue
        const key = JSON.stringify(tree)
        let ci = colKeys.indexOf(key)
        if (ci < 0) {
          ci = colKeys.push(key) - 1
          columns.push(tree)
        }
        const exprs: any[] = []
        leafValues(d.scopeId, exprs)
        idents.push({ [String(ci)]: exprs })
        ;(qm[String(qi)] ??= []).push(ci)
      }
    }
    values.push(idents)
    queryNameMap.push(qm)
    metadata.push(s?.metadata ?? [])
    anyMeta ||= !!s?.metadata
    id.push(s?.id ?? '')
    anyId ||= s?.id !== undefined
  }
  return { decomposedIdentities: { columns, values }, queryNameMap, queryNames, ...(anyMeta ? { metadata } : {}), ...(anyId ? { id } : {}) }
}

/** `highlight` state → data point identities (inverse of identitiesToHighlight; ignores shapes it can't read). */
export function highlightToIdentities(highlight: any): DataPointIdentity[] {
  const raw = highlight?.selection
  // DecomposedSelectors (compressed form): expand first; the raw bookmark value itself is never rewritten
  const sel = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? decodeDecomposedSelectors(raw) : []
  const out: DataPointIdentity[] = []
  for (const s of sel) {
    const fields: DataPointIdentity['fields'] = []
    for (const selectors of Object.values<any>(s?.dataMap ?? {})) {
      for (const d of selectors ?? []) {
        // a scope identity is one Comparison or an And tree of them (multi-field data points)
        const walk = (n: any): void => {
          if (n?.And) {
            walk(n.And.Left)
            walk(n.And.Right)
            return
          }
          const c = n?.Comparison
          if (c?.Left && c?.Right?.Literal) fields.push({ expr: c.Left, value: literalValue(c.Right) })
        }
        walk(d?.scopeId)
      }
    }
    if (fields.length) out.push({ fields })
  }
  return out
}

export interface CaptureOptions {
  displayName: string
  name?: string
  /** capture filters / slicers / sort / drill (default true) */
  data?: boolean
  /** capture visibility / spotlight (default true) */
  display?: boolean
  /** bookmark switches to its page (default true) */
  currentPage?: boolean
  /** "Selected visuals" — restrict to these visual names */
  targetVisualNames?: string[]
}

function cardToBookmarkFilter(c: FilterCard): any {
  const { field, ...rest } = c
  const out: any = { ...cloneDeep(rest) }
  if (field) out.expression = cloneDeep(field)
  return out
}

function byExpr(cards: FilterCard[]): { byExpr: any[] } | undefined {
  if (!cards.length) return undefined
  return { byExpr: cards.map(cardToBookmarkFilter) }
}

function drillToProjection(visualJson: any, drill: DrillState): Record<string, any[]> | undefined {
  if (!drill.level) return undefined
  const fields = visualFields(visualJson)
  const roles = new Map<string, any[]>()
  for (const f of fields) {
    if (!roles.has(f.role)) roles.set(f.role, [])
    roles.get(f.role)!.push(f.expr)
  }
  for (const role of ['Category', 'Rows', 'Axis', 'Columns', 'Series']) {
    const list = roles.get(role)
    if (list && list.length > drill.level) return { [role]: [cloneDeep(list[drill.level])] }
  }
  return undefined
}

function drillPathCards(path: DataPointIdentity[]): any[] {
  const out: any[] = []
  for (const id of path) {
    const f = identitiesToFilter([id])
    if (!f) continue
    out.push({ name: newObjectName(), type: 'Categorical', howCreated: 'Drill', expression: id.fields[id.fields.length - 1]?.expr, filter: f })
  }
  return out
}

export function captureBookmark(report: ReportDocument, rt: RuntimeSnapshot, opts: CaptureOptions): BookmarkDocument {
  const data = opts.data !== false
  const display = opts.display !== false
  const name = opts.name ?? `Bookmark${newObjectName()}`
  const targets = opts.targetVisualNames?.length ? new Set(opts.targetVisualNames) : null
  const sections: Record<string, any> = {}
  for (const page of report.pages) {
    const sec: any = {}
    if (data) {
      const f = byExpr(filterCards(page.json))
      if (f) sec.filters = f
    }
    const containers: Record<string, any> = {}
    const groups: Record<string, any> = {}
    for (const v of page.visuals) {
      if (targets && !targets.has(v.name)) continue
      if (isGroup(v)) {
        if (display && v.json?.isHidden) groups[v.name] = { isHidden: true }
        continue
      }
      const type = visualTypeOf(v)
      const sv: any = { visualType: type }
      const entry: any = {}
      if (data) {
        const vf = byExpr(filterCards(v.json))
        const drill = rt.drill(page.name, v.name)
        const drillCards = drillPathCards(drill.path)
        if (vf || drillCards.length) entry.filters = { byExpr: [...(vf?.byExpr ?? []), ...drillCards] }
        if (isSlicerType(type)) {
          const sf = rt.slicerFilter(page.name, v.name)
          sv.objects = { merge: { general: [{ properties: sf ? { filter: { filter: cloneDeep(sf) } } : {} }] } }
        }
        const sort: any[] = v.json?.visual?.query?.sortDefinition?.sort ?? []
        if (sort.length) sv.orderBy = sort.map((s) => ({ Direction: s.direction === 'Descending' ? 2 : 1, Expression: cloneDeep(s.field) }))
        const ap = drillToProjection(v.json, drill)
        if (ap) sv.activeProjections = ap
      }
      if (display) {
        if (v.json?.isHidden) sv.display = { mode: 'hidden' }
        else if (rt.focus && rt.focus.page === page.name && rt.focus.visual === v.name) sv.display = rt.focus.mode === 'table' ? { mode: 'maximize', maximizedOptions: { dataTable: 'normal' } } : { mode: 'maximize' }
        else if (rt.spotlight && rt.spotlight.page === page.name && rt.spotlight.visual === v.name) sv.display = { mode: 'spotlight' }
      }
      if (data) {
        const cf = rt.crossFilter?.(page.name)
        if (cf && cf.source === v.name) {
          const hl = identitiesToHighlight(v.json, cf.identities)
          if (hl) entry.highlight = hl
        }
      }
      entry.singleVisual = sv
      containers[v.name] = entry
    }
    if (Object.keys(containers).length) sec.visualContainers = containers
    if (Object.keys(groups).length) sec.visualContainerGroups = groups
    sections[page.name] = sec
  }
  const explorationState: any = { version: '1.3', activeSection: rt.activePage, sections }
  if (data) {
    const rf = byExpr(filterCards(report.report))
    if (rf) explorationState.filters = rf
  }
  const options: any = {}
  if (targets) {
    options.targetVisualNames = [...targets]
    options.applyOnlyToTargetVisuals = true
  }
  if (!data) options.suppressData = true
  if (!display) options.suppressDisplay = true
  if (opts.currentPage === false) options.suppressActiveSection = true
  const json: any = { $schema: BOOKMARK_SCHEMA, displayName: opts.displayName, name, explorationState }
  if (Object.keys(options).length) json.options = options
  return { name, json }
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

export interface BookmarkApplyPlan {
  /** page to activate (undefined = stay) */
  activePage?: string
  /** apply filters / visibility / sort / saved slicer state to a draft report */
  mutate(report: ReportDocument): void
  /** runtime slicer selections to set */
  slicers: Array<{ page: string; visual: string; filter: SQFilter | null }>
  /** runtime drill states */
  drill: Array<{ page: string; visual: string; state: DrillState | undefined }>
  /** spotlight to set (undefined = leave) */
  spotlight?: { page: string; visual: string } | null
  /** pages whose cross-filter selection should be cleared */
  clearCrossFilterPages: string[]
  /** data point selections to restore (after clearing) */
  crossFilters: Array<{ page: string; source: string; identities: DataPointIdentity[] }>
  /** focus mode to set (null = leave focus mode; undefined = leave as is) */
  focus?: { page: string; visual: string; mode: 'focus' | 'table' } | null
}

function bookmarkFilterToCard(f: any): FilterCard {
  const { expression, ...rest } = f
  const out: FilterCard = { ...cloneDeep(rest) }
  if (expression && !out.field) out.field = cloneDeep(expression)
  return out
}

/** Merge bookmark filter entries into existing cards: matching names get the bookmark's value (or none). */
function applyCards(json: any, entries: any[] | undefined): void {
  if (!entries) return
  const cards: FilterCard[] = json.filterConfig?.filters ?? []
  const byName = new Map(entries.filter((e) => e.howCreated !== 'Drill').map((e) => [e.name, bookmarkFilterToCard(e)]))
  for (const c of cards) {
    const b = byName.get(c.name)
    if (!b) continue
    if (b.filter) c.filter = b.filter
    else delete c.filter
    byName.delete(c.name)
  }
  // filters that exist in the bookmark but not in the report anymore are re-added (PBI restores them)
  if (byName.size) {
    json.filterConfig ??= { filters: [] }
    json.filterConfig.filters ??= []
    for (const b of byName.values()) json.filterConfig.filters.push(b)
  }
}

function drillFromBookmark(visualJson: any, entry: any): DrillState | undefined {
  const sv = entry?.singleVisual
  const drillCards: any[] = (entry?.filters?.byExpr ?? []).filter((f: any) => f.howCreated === 'Drill')
  let level = 0
  if (sv?.activeProjections) {
    const fields = visualFields(visualJson)
    for (const [role, list] of Object.entries<any>(sv.activeProjections)) {
      const key = list?.[0] ? fieldKey(list[0]) : undefined
      const inRole = fields.filter((f) => f.role === role)
      const idx = inRole.findIndex((f) => fieldKey(f.expr) === key)
      if (idx > 0) level = idx
    }
  }
  const path: DataPointIdentity[] = []
  for (const c of drillCards) {
    const inn = c.filter?.Where?.[0]?.Condition?.In
    if (!inn?.Expressions || !inn.Values?.[0]) continue
    path.push({ fields: inn.Expressions.map((e: any, i: number) => ({ expr: e, value: literalValue(inn.Values[0][i]) })) })
  }
  if (!level && !path.length) return undefined
  return { level: Math.max(level, path.length), path }
}

export function planBookmarkApply(report: ReportDocument, bookmark: BookmarkDocument): BookmarkApplyPlan {
  const json = bookmark.json ?? {}
  const es = json.explorationState ?? {}
  const opts = json.options ?? {}
  const applyData = !opts.suppressData
  const applyDisplay = !opts.suppressDisplay
  const targets: Set<string> | null = opts.applyOnlyToTargetVisuals && Array.isArray(opts.targetVisualNames) ? new Set(opts.targetVisualNames) : null
  const sections: Record<string, any> = es.sections ?? {}
  const pageExists = (n: string) => report.pages.some((p) => p.name === n)

  const plan: BookmarkApplyPlan = { mutate: () => {}, slicers: [], drill: [], clearCrossFilterPages: [], crossFilters: [] }
  if (!opts.suppressActiveSection && es.activeSection && pageExists(es.activeSection)) plan.activePage = es.activeSection

  const inScope = (visual: string) => !targets || targets.has(visual)

  if (applyData) {
    for (const [pageName, sec] of Object.entries<any>(sections)) {
      const page = report.pages.find((p) => p.name === pageName)
      if (!page) continue
      plan.clearCrossFilterPages.push(pageName)
      for (const v of page.visuals) {
        if (isGroup(v) || !inScope(v.name)) continue
        const entry = sec?.visualContainers?.[v.name]
        if (isSlicerType(visualTypeOf(v))) {
          const general = entry?.singleVisual?.objects?.merge?.general
          if (general) {
            const f = general.map((g: any) => g?.properties?.filter?.filter).find(Boolean) as SQFilter | undefined
            plan.slicers.push({ page: pageName, visual: v.name, filter: f ?? null })
          }
        }
        plan.drill.push({ page: pageName, visual: v.name, state: drillFromBookmark(v.json, entry) })
        const ids = highlightToIdentities(entry?.highlight)
        if (ids.length && !plan.crossFilters.some((c) => c.page === pageName)) plan.crossFilters.push({ page: pageName, source: v.name, identities: ids })
      }
    }
  }

  if (applyDisplay) {
    const sp = Object.entries<any>(sections).flatMap(([pageName, sec]) =>
      Object.entries<any>(sec?.visualContainers ?? {})
        .filter(([vn, e]) => e?.singleVisual?.display?.mode === 'spotlight' && inScope(vn))
        .map(([vn]) => ({ page: pageName, visual: vn }))
    )
    plan.spotlight = sp[0] ?? null
    const fm = Object.entries<any>(sections).flatMap(([pageName, sec]) =>
      Object.entries<any>(sec?.visualContainers ?? {})
        .filter(([vn, e]) => e?.singleVisual?.display?.mode === 'maximize' && inScope(vn))
        .map(([vn, e]) => ({ page: pageName, visual: vn, mode: (e.singleVisual.display.maximizedOptions?.dataTable ? 'table' : 'focus') as 'focus' | 'table' }))
    )
    plan.focus = fm[0] ?? null
  }

  plan.mutate = (draft: ReportDocument) => {
    if (applyData && !targets && es.filters?.byExpr) applyCards(draft.report, es.filters.byExpr)
    for (const [pageName, sec] of Object.entries<any>(sections)) {
      const page: PageDocument | undefined = draft.pages.find((p) => p.name === pageName)
      if (!page) continue
      if (applyData && !targets && sec?.filters?.byExpr) applyCards(page.json, sec.filters.byExpr)
      for (const v of page.visuals) {
        if (!inScope(v.name)) continue
        if (isGroup(v)) {
          if (applyDisplay) {
            if (sec?.visualContainerGroups?.[v.name]?.isHidden) v.json.isHidden = true
            else if (v.json.isHidden) delete v.json.isHidden
          }
          continue
        }
        const entry = sec?.visualContainers?.[v.name]
        if (applyDisplay) {
          if (entry?.singleVisual?.display?.mode === 'hidden') v.json.isHidden = true
          else if (v.json.isHidden) delete v.json.isHidden
        }
        if (!applyData || !entry) continue
        if (entry.filters?.byExpr) applyCards(v.json, entry.filters.byExpr)
        const sv = entry.singleVisual
        if (sv?.orderBy && v.json.visual?.query) {
          v.json.visual.query.sortDefinition = {
            sort: sv.orderBy.map((o: any) => ({ field: o.Expression, direction: o.Direction === 2 ? 'Descending' : 'Ascending' })),
            isDefaultSort: false
          }
        }
        if (isSlicerType(visualTypeOf(v)) && sv?.objects?.merge?.general) {
          const f = sv.objects.merge.general.map((g: any) => g?.properties?.filter?.filter).find(Boolean) as SQFilter | undefined
          writeSlicerFilter(v.json, f)
        }
      }
    }
  }
  return plan
}

/** Add a captured bookmark to the report (bookmarks.json items + file). */
export function addBookmark(report: ReportDocument, bm: BookmarkDocument, group?: string): void {
  report.bookmarks.push(bm)
  report.bookmarksMeta ??= { $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmarksMetadata/1.0.0/schema.json', items: [] }
  report.bookmarksMeta.items ??= []
  if (group) {
    const g = report.bookmarksMeta.items.find((i: any) => i.name === group || i.displayName === group)
    if (g && Array.isArray(g.children)) {
      g.children.push(bm.name)
      return
    }
  }
  report.bookmarksMeta.items.push({ name: bm.name })
}

/** Update an existing bookmark's state in place (Bookmarks pane ▸ Update). */
export function updateBookmark(report: ReportDocument, name: string, captured: BookmarkDocument): void {
  const b = report.bookmarks.find((x) => x.name === name)
  if (!b) return
  b.json = { ...captured.json, name, displayName: b.json?.displayName ?? captured.json.displayName, ...(b.json?.options ? { options: b.json.options } : {}) }
}

export function deleteBookmark(report: ReportDocument, name: string): void {
  report.bookmarks = report.bookmarks.filter((b) => b.name !== name)
  const items: any[] = report.bookmarksMeta?.items ?? []
  report.bookmarksMeta && (report.bookmarksMeta.items = items
    .filter((i) => i.name !== name)
    .map((i) => (Array.isArray(i.children) ? { ...i, children: i.children.filter((c: string) => c !== name) } : i)))
}

/** Saved slicer state helper re-exported for the shell's sync-slicers pane. */
export { savedSlicerFilter }

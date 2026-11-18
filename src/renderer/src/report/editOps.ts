/**
 * Report edit operations (pure mutators over a draft ReportDocument / PageDocument).
 * Used by the canvas and exported for the shell (ribbon: Format ▸ Align / Arrange / Group, page tabs,
 * selection pane). Callers wrap them in `useApp().mutateReport(label, (r) => …)` to make them undoable.
 */
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import { alignRects, distributeRects, distributeWithGap, boundsOf, matchSize, resizeBy, tidy, tidyUp, type AlignMode, type AlignTo, type DistributeAxis } from './geometry'
import { absoluteRect, descendantsOf, findPage, groupOrigin, isGroup, newObjectName, orderedPages, parentOf, positionOf, type Rect } from './pbir'

const VISUAL_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json'
const PAGE_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json'

// ---------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------

function uniquePageDisplayName(report: ReportDocument, base: string): string {
  const names = new Set(report.pages.map((p) => p.json?.displayName))
  if (!names.has(base)) return base
  for (let i = 1; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`
}

function nextPageNumberName(report: ReportDocument): string {
  const names = new Set(report.pages.map((p) => p.json?.displayName))
  for (let i = report.pages.length + 1; ; i++) if (!names.has(`Page ${i}`)) return `Page ${i}`
}

export function addPage(report: ReportDocument, opts: { displayName?: string; after?: string; width?: number; height?: number } = {}): string {
  const name = newObjectName()
  const ref = findPage(report, opts.after)
  report.pages.push({
    name,
    json: {
      $schema: PAGE_SCHEMA,
      name,
      displayName: opts.displayName ?? nextPageNumberName(report),
      displayOption: ref?.json?.displayOption ?? 'FitToPage',
      height: opts.height ?? ref?.json?.height ?? 720,
      width: opts.width ?? ref?.json?.width ?? 1280
    },
    visuals: []
  })
  const order = (report.pagesMeta.pageOrder ??= [])
  const idx = opts.after ? order.indexOf(opts.after) : -1
  if (idx >= 0) order.splice(idx + 1, 0, name)
  else order.push(name)
  return name
}

export function duplicatePage(report: ReportDocument, pageName: string): string | undefined {
  const src = findPage(report, pageName)
  if (!src) return undefined
  const name = newObjectName()
  const json = structuredClone(src.json)
  json.name = name
  json.displayName = uniquePageDisplayName(report, `Duplicate of ${src.json?.displayName ?? pageName}`)
  const rename = new Map<string, string>()
  for (const v of src.visuals) rename.set(v.name, newObjectName())
  const visuals: VisualDocument[] = src.visuals.map((v) => {
    const j = structuredClone(v.json)
    const nn = rename.get(v.name)!
    j.name = nn
    if (j.parentGroupName && rename.has(j.parentGroupName)) j.parentGroupName = rename.get(j.parentGroupName)
    return { name: nn, json: j, ...(v.mobile ? { mobile: structuredClone(v.mobile) } : {}) }
  })
  if (Array.isArray(json.visualInteractions)) {
    json.visualInteractions = json.visualInteractions
      .filter((i: any) => rename.has(i.source) && rename.has(i.target))
      .map((i: any) => ({ ...i, source: rename.get(i.source), target: rename.get(i.target) }))
  }
  report.pages.push({ name, json, visuals })
  const order = report.pagesMeta.pageOrder
  const idx = order.indexOf(pageName)
  order.splice(idx >= 0 ? idx + 1 : order.length, 0, name)
  return name
}

/** Delete a page (refuses to delete the last page). Returns the page to activate next. */
export function deletePage(report: ReportDocument, pageName: string): string | undefined {
  if (report.pages.length <= 1) return undefined
  const ordered = orderedPages(report).map((p) => p.name)
  const idx = ordered.indexOf(pageName)
  report.pages = report.pages.filter((p) => p.name !== pageName)
  report.pagesMeta.pageOrder = report.pagesMeta.pageOrder.filter((n) => n !== pageName)
  const remaining = ordered.filter((n) => n !== pageName)
  const next = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)]
  if (report.pagesMeta.activePageName === pageName) report.pagesMeta.activePageName = next
  return next
}

export function renamePage(report: ReportDocument, pageName: string, displayName: string): void {
  const p = findPage(report, pageName)
  if (p && displayName.trim()) p.json.displayName = displayName.trim()
}

export function setPageHidden(report: ReportDocument, pageName: string, hidden: boolean): void {
  const p = findPage(report, pageName)
  if (!p) return
  if (hidden) p.json.visibility = 'HiddenInViewMode'
  else delete p.json.visibility
}

export function movePage(report: ReportDocument, pageName: string, toIndex: number): void {
  const order = orderedPages(report).map((p) => p.name)
  const from = order.indexOf(pageName)
  if (from < 0) return
  order.splice(from, 1)
  order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, pageName)
  report.pagesMeta.pageOrder = order
}

// ---------------------------------------------------------------------------------------------
// Visual geometry
// ---------------------------------------------------------------------------------------------

/** Set absolute (page-space) rects for visuals; group children are stored relative to their group. */
export function setAbsoluteRects(page: PageDocument, rects: Record<string, Partial<Rect>>): void {
  const groupsToFit = new Set<string>()
  for (const [name, r] of Object.entries(rects)) {
    const v = page.visuals.find((o) => o.name === name)
    if (!v) continue
    const cur = absoluteRect(page, v)
    const next = { ...cur, ...r }
    const origin = groupOrigin(page, parentOf(v))
    const pos = (v.json.position ??= {})
    pos.x = tidy(next.x - origin.x)
    pos.y = tidy(next.y - origin.y)
    if (isGroup(v) && (next.width !== cur.width || next.height !== cur.height) && cur.width > 0 && cur.height > 0) {
      // ScaleMode groups scale their children with the group
      scaleChildren(page, v.name, next.width / cur.width, next.height / cur.height)
    }
    pos.width = tidy(next.width)
    pos.height = tidy(next.height)
    const parent = parentOf(v)
    if (parent) groupsToFit.add(parent)
  }
  for (const g of groupsToFit) fitGroupToChildren(page, g)
}

function scaleChildren(page: PageDocument, groupName: string, sx: number, sy: number): void {
  for (const c of page.visuals.filter((v) => parentOf(v) === groupName)) {
    const p = (c.json.position ??= {})
    p.x = tidy((p.x ?? 0) * sx)
    p.y = tidy((p.y ?? 0) * sy)
    const ow = p.width ?? 0
    const oh = p.height ?? 0
    p.width = tidy(ow * sx)
    p.height = tidy(oh * sy)
    if (isGroup(c) && ow > 0 && oh > 0) scaleChildren(page, c.name, sx, sy)
  }
}

/** Grow/shrink a group so it exactly bounds its children (PBI keeps group bounds = children bounds). Recurses to ancestors. */
export function fitGroupToChildren(page: PageDocument, groupName: string): void {
  const g = page.visuals.find((v) => v.name === groupName)
  if (!g) return
  const kids = page.visuals.filter((v) => parentOf(v) === groupName)
  if (!kids.length) return
  const rels = kids.map((k) => positionOf(k))
  const b = boundsOf(rels)
  const gp = (g.json.position ??= {})
  if (b.x !== 0 || b.y !== 0) {
    for (const k of kids) {
      k.json.position.x = tidy((k.json.position.x ?? 0) - b.x)
      k.json.position.y = tidy((k.json.position.y ?? 0) - b.y)
    }
    gp.x = tidy((gp.x ?? 0) + b.x)
    gp.y = tidy((gp.y ?? 0) + b.y)
  }
  gp.width = tidy(b.width)
  gp.height = tidy(b.height)
  const parent = parentOf(g)
  if (parent) fitGroupToChildren(page, parent)
}

export function moveVisualsBy(page: PageDocument, names: string[], dx: number, dy: number): void {
  const rects: Record<string, Partial<Rect>> = {}
  for (const n of topLevelOf(page, names)) {
    const v = page.visuals.find((o) => o.name === n)
    if (!v) continue
    const r = absoluteRect(page, v)
    rects[n] = { x: Math.max(0, r.x + dx), y: Math.max(0, r.y + dy) }
  }
  setAbsoluteRects(page, rects)
}

/** Drop names whose ancestor is also in the list (moving a group moves its children). */
export function topLevelOf(page: PageDocument, names: string[]): string[] {
  const set = new Set(names)
  return names.filter((n) => {
    let p = parentOf(page.visuals.find((v) => v.name === n) ?? ({ json: {} } as VisualDocument))
    const seen = new Set<string>()
    while (p && !seen.has(p)) {
      if (set.has(p)) return false
      seen.add(p)
      p = parentOf(page.visuals.find((v) => v.name === p) ?? ({ json: {} } as VisualDocument))
    }
    return true
  })
}

function itemsOf(page: PageDocument, names: string[]): VisualDocument[] {
  return topLevelOf(page, names)
    .map((n) => page.visuals.find((v) => v.name === n))
    .filter((v): v is VisualDocument => !!v)
}

const pageSizeOf = (page: PageDocument) => ({ width: page.json?.width ?? 1280, height: page.json?.height ?? 720 })

/**
 * Align (Format ▸ Align). `to`: selection bounds (default, PBI), the key object (first name in `names`, which stays
 * put) or the page. A single visual always aligns to the page (PBI).
 */
export function alignVisuals(page: PageDocument, names: string[], mode: AlignMode, to: AlignTo = 'selection'): void {
  const items = itemsOf(page, names)
  const rects = items.map((v) => absoluteRect(page, v))
  const keyIndex = items.findIndex((v) => v.name === names[0])
  const next = alignRects(rects, mode, pageSizeOf(page), { to, keyIndex: keyIndex >= 0 ? keyIndex : 0 })
  setAbsoluteRects(page, Object.fromEntries(items.map((v, i) => [v.name, { x: next[i].x, y: next[i].y }])))
}

/** Distribute with a fixed gap (page px) — first visual stays put. */
export function distributeVisualsWithGap(page: PageDocument, names: string[], axis: DistributeAxis, gap: number): void {
  const items = itemsOf(page, names)
  const next = distributeWithGap(items.map((v) => absoluteRect(page, v)), axis, gap)
  setAbsoluteRects(page, Object.fromEntries(items.map((v, i) => [v.name, { x: next[i].x, y: next[i].y }])))
}

/** Tidy up: arrange into an even row / grid (gap: page px, default = median of current gaps). */
export function tidyUpVisuals(page: PageDocument, names: string[], gap?: number): void {
  const items = itemsOf(page, names)
  const next = tidyUp(items.map((v) => absoluteRect(page, v)), gap)
  setAbsoluteRects(page, Object.fromEntries(items.map((v, i) => [v.name, { x: next[i].x, y: next[i].y }])))
}

/** Make same width / height / size as the key object (first name). */
export function matchVisualSize(page: PageDocument, names: string[], dim: 'width' | 'height' | 'both'): void {
  const items = itemsOf(page, names)
  const keyIndex = Math.max(0, items.findIndex((v) => v.name === names[0]))
  const next = matchSize(items.map((v) => absoluteRect(page, v)), dim, keyIndex)
  setAbsoluteRects(page, Object.fromEntries(items.map((v, i) => [v.name, { width: next[i].width, height: next[i].height }])))
}

/** Keyboard resize (bottom-right anchored). */
export function resizeVisualsBy(page: PageDocument, names: string[], dw: number, dh: number): void {
  const items = itemsOf(page, names)
  setAbsoluteRects(page, Object.fromEntries(items.map((v) => {
    const r = resizeBy(absoluteRect(page, v), dw, dh)
    return [v.name, { width: r.width, height: r.height }]
  })))
}

export function distributeVisuals(page: PageDocument, names: string[], axis: DistributeAxis): void {
  const items = topLevelOf(page, names)
    .map((n) => page.visuals.find((v) => v.name === n))
    .filter((v): v is VisualDocument => !!v)
  const rects = items.map((v) => absoluteRect(page, v))
  const next = distributeRects(rects, axis)
  setAbsoluteRects(page, Object.fromEntries(items.map((v, i) => [v.name, { x: next[i].x, y: next[i].y }])))
}

// ---------------------------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------------------------

export type ZOrderOp = 'forward' | 'backward' | 'front' | 'back'

/** Re-stack siblings (same parent) — z values are rewritten in steps of 1000 like PBI. */
export function reorderZ(page: PageDocument, names: string[], op: ZOrderOp): void {
  const targets = topLevelOf(page, names)
  const parents = new Set(targets.map((n) => parentOf(page.visuals.find((v) => v.name === n)!) ?? ''))
  for (const parent of parents) {
    const siblings = page.visuals.filter((v) => (parentOf(v) ?? '') === parent).sort((a, b) => positionOf(a).z - positionOf(b).z)
    const sel = new Set(targets)
    let order = siblings.slice()
    if (op === 'front') order = [...order.filter((v) => !sel.has(v.name)), ...order.filter((v) => sel.has(v.name))]
    else if (op === 'back') order = [...order.filter((v) => sel.has(v.name)), ...order.filter((v) => !sel.has(v.name))]
    else if (op === 'forward') {
      for (let i = order.length - 2; i >= 0; i--) {
        if (sel.has(order[i].name) && !sel.has(order[i + 1].name)) [order[i], order[i + 1]] = [order[i + 1], order[i]]
      }
    } else {
      for (let i = 1; i < order.length; i++) {
        if (sel.has(order[i].name) && !sel.has(order[i - 1].name)) [order[i], order[i - 1]] = [order[i - 1], order[i]]
      }
    }
    order.forEach((v, i) => {
      v.json.position ??= {}
      v.json.position.z = i * 1000
    })
  }
}

// ---------------------------------------------------------------------------------------------
// Add / delete / duplicate / copy-paste
// ---------------------------------------------------------------------------------------------

function maxZ(page: PageDocument, parent?: string): number {
  return page.visuals.filter((v) => parentOf(v) === parent).reduce((m, v) => Math.max(m, positionOf(v).z), -1000)
}

/** Insert a new visual (top of the stack). Returns its name. */
export function addVisual(page: PageDocument, visualType: string, rect: Rect, visual: Record<string, any> = {}): string {
  const name = newObjectName()
  const z = maxZ(page) + 1000
  page.visuals.push({
    name,
    json: {
      $schema: VISUAL_SCHEMA,
      name,
      position: { x: tidy(rect.x), y: tidy(rect.y), z, height: tidy(rect.height), width: tidy(rect.width), tabOrder: z },
      visual: { visualType, drillFilterOtherVisuals: true, ...visual }
    }
  })
  return name
}

/** Delete visuals (and, for groups, all descendants). */
export function deleteVisuals(page: PageDocument, names: string[]): void {
  const doomed = new Set<string>()
  for (const n of names) {
    doomed.add(n)
    for (const d of descendantsOf(page, n)) doomed.add(d.name)
  }
  const parents = new Set(page.visuals.filter((v) => doomed.has(v.name)).map((v) => parentOf(v)).filter((p): p is string => !!p && !doomed.has(p)))
  page.visuals = page.visuals.filter((v) => !doomed.has(v.name))
  if (Array.isArray(page.json?.visualInteractions)) {
    page.json.visualInteractions = page.json.visualInteractions.filter((i: any) => !doomed.has(i.source) && !doomed.has(i.target))
  }
  for (const p of parents) {
    // a group left with no children disappears (PBI ungroups empty groups)
    if (!page.visuals.some((v) => parentOf(v) === p)) deleteVisuals(page, [p])
    else fitGroupToChildren(page, p)
  }
}

export interface VisualClipboard {
  kind: 'wbi-visuals'
  sourcePage: string
  visuals: Array<{ name: string; json: any; mobile?: any }>
}

/** Serialize visuals (with group descendants) for copy. */
export function copyVisuals(page: PageDocument, names: string[]): VisualClipboard {
  const top = topLevelOf(page, names)
  const out: VisualClipboard['visuals'] = []
  const seen = new Set<string>()
  const pageVisual = (n: string) => page.visuals.find((v) => v.name === n)
  for (const n of top) {
    const v = pageVisual(n)
    if (!v) continue
    const json = structuredClone(v.json)
    // detach from its parent group: store absolute position
    if (json.parentGroupName) {
      const r = absoluteRect(page, v)
      json.position = { ...json.position, x: r.x, y: r.y }
      delete json.parentGroupName
    }
    out.push({ name: n, json, ...(v.mobile ? { mobile: structuredClone(v.mobile) } : {}) })
    seen.add(n)
    for (const d of descendantsOf(page, n)) {
      if (seen.has(d.name)) continue
      seen.add(d.name)
      out.push({ name: d.name, json: structuredClone(d.json) })
    }
  }
  return { kind: 'wbi-visuals', sourcePage: page.name, visuals: out }
}

/**
 * Paste visuals with fresh 20-hex names. When pasting onto the page the visuals came from, they are
 * offset (like PBI) so the copies don't sit exactly on top of the originals. Returns the new top-level names.
 */
export function pasteVisuals(page: PageDocument, clip: VisualClipboard, opts: { offset?: number } = {}): string[] {
  const rename = new Map<string, string>()
  for (const v of clip.visuals) rename.set(v.name, newObjectName())
  const offset = opts.offset ?? (clip.sourcePage === page.name ? 20 : 0)
  let z = maxZ(page) + 1000
  const top: string[] = []
  for (const v of clip.visuals) {
    const json = structuredClone(v.json)
    const nn = rename.get(v.name)!
    json.name = nn
    if (json.parentGroupName) {
      json.parentGroupName = rename.get(json.parentGroupName) ?? undefined
      if (!json.parentGroupName) delete json.parentGroupName
    }
    if (!json.parentGroupName) {
      top.push(nn)
      json.position = { ...json.position, x: tidy((json.position?.x ?? 0) + offset), y: tidy((json.position?.y ?? 0) + offset), z, tabOrder: z }
      z += 1000
    }
    page.visuals.push({ name: nn, json, ...(v.mobile ? { mobile: v.mobile } : {}) })
  }
  return top
}

export function duplicateVisuals(page: PageDocument, names: string[]): string[] {
  return pasteVisuals(page, copyVisuals(page, names), { offset: 20 })
}

// ---------------------------------------------------------------------------------------------
// Group / ungroup / visibility
// ---------------------------------------------------------------------------------------------

/** Group visuals (must share the same parent). Returns the new group's name. */
export function groupVisuals(page: PageDocument, names: string[], displayName?: string): string | undefined {
  const top = topLevelOf(page, names)
  const items = top.map((n) => page.visuals.find((v) => v.name === n)).filter((v): v is VisualDocument => !!v)
  if (items.length < 1) return undefined
  const parent = parentOf(items[0])
  if (items.some((v) => parentOf(v) !== parent)) return undefined
  const abs = items.map((v) => absoluteRect(page, v))
  const b = boundsOf(abs)
  const origin = groupOrigin(page, parent)
  const groupCount = page.visuals.filter(isGroup).length
  const name = newObjectName()
  const z = Math.max(...items.map((v) => positionOf(v).z))
  const sorted = items.slice().sort((a, c) => positionOf(a).z - positionOf(c).z)
  sorted.forEach((v, i) => {
    const r = absoluteRect(page, v)
    v.json.parentGroupName = name
    v.json.position = { ...v.json.position, x: tidy(r.x - b.x), y: tidy(r.y - b.y), z: i * 1000 }
  })
  page.visuals.push({
    name,
    json: {
      $schema: VISUAL_SCHEMA,
      name,
      position: { x: tidy(b.x - origin.x), y: tidy(b.y - origin.y), z, height: tidy(b.height), width: tidy(b.width), tabOrder: z },
      visualGroup: { displayName: displayName ?? `Group ${groupCount + 1}`, groupMode: 'ScaleMode' },
      ...(parent ? { parentGroupName: parent } : {})
    }
  })
  return name
}

/** Ungroup: children move to the group's parent (absolute positions preserved). Returns the freed children. */
export function ungroupVisuals(page: PageDocument, groupNames: string[]): string[] {
  const freed: string[] = []
  for (const g of groupNames) {
    const group = page.visuals.find((v) => v.name === g)
    if (!group || !isGroup(group)) continue
    const parent = parentOf(group)
    const origin = groupOrigin(page, parent)
    const gz = positionOf(group).z
    const kids = page.visuals.filter((v) => parentOf(v) === g)
    for (const k of kids) {
      const r = absoluteRect(page, k)
      if (parent) k.json.parentGroupName = parent
      else delete k.json.parentGroupName
      k.json.position = { ...k.json.position, x: tidy(r.x - origin.x), y: tidy(r.y - origin.y), z: gz + (k.json.position?.z ?? 0) / 1000 }
      freed.push(k.name)
    }
    page.visuals = page.visuals.filter((v) => v.name !== g)
  }
  return freed
}

export function setVisualsHidden(page: PageDocument, names: string[], hidden: boolean): void {
  for (const n of names) {
    const v = page.visuals.find((o) => o.name === n)
    if (!v) continue
    if (hidden) v.json.isHidden = true
    else delete v.json.isHidden
  }
}

/** Visual names on a page in tab order (selection pane order). */
export function tabOrder(page: PageDocument): string[] {
  return page.visuals
    .slice()
    .sort((a, b) => positionOf(a).tabOrder - positionOf(b).tabOrder)
    .map((v) => v.name)
}

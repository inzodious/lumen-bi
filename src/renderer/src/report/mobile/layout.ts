/**
 * Mobile layout (View ▸ Mobile layout) — pure document operations over a PageDocument draft.
 *
 * Power BI stores a page's phone layout per visual in `visuals/<name>/mobile.json`
 * (schema `visualContainerMobileState`): `{ $schema, position: {x,y,z,width,height,tabOrder}, objects?, visualContainerObjects? }`.
 * `objects` / `visualContainerObjects` are mobile-only formatting overrides merged over visual.json's.
 * A visual is "in the mobile layout" when its mobile.json has a position.
 *
 * Canvas geometry (approximation, documented): PBI Desktop's phone emulator is a portrait canvas
 * 320 units wide (the iPhone SE point width the original phone layout was designed on), drawn with
 * a coarse 20-unit grid subdivided into a "fine-grained" grid; we snap to 5 units (20 / 4). The canvas
 * grows vertically with its content (minimum 568 units = one phone screen).
 *
 * Only top-level visuals are placed (a group is placed as one item, its children scale with it), like
 * PBI's Page visuals pane which lists groups as single entries.
 */
import type { PageDocument, VisualDocument } from '@core/report/types'
import { resizeRect, type Handle } from '../geometry'
import { absoluteRect, descendantsOf, isGroup, parentOf, positionOf, visualTypeOf, type Rect } from '../pbir'

export const MOBILE_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainerMobileState/2.3.0/schema.json'
/** phone canvas width in mobile layout units */
export const MOBILE_WIDTH = 320
/** minimum canvas height (one phone screen) */
export const MOBILE_MIN_HEIGHT = 568
/** coarse gridline spacing */
export const MOBILE_GRID_MAJOR = 20
/** snap step (fine-grained grid) */
export const MOBILE_GRID = 5
/** extra empty space kept below the lowest visual so there's always room to drop more */
export const MOBILE_TAIL = 120
export const MOBILE_MIN_SIZE = 20

export function snap(value: number, grid = MOBILE_GRID): number {
  return grid > 0 ? Math.round(value / grid) * grid : value
}

function tidy(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Mobile rect of a visual (undefined when not placed on the phone canvas). */
export function mobileRect(v: VisualDocument | undefined): (Rect & { z: number }) | undefined {
  const p = v?.mobile?.position
  if (!p || typeof p !== 'object') return undefined
  return { x: Number(p.x ?? 0), y: Number(p.y ?? 0), width: Number(p.width ?? 0), height: Number(p.height ?? 0), z: Number(p.z ?? 0) }
}

export function isPlaced(v: VisualDocument | undefined): boolean {
  return !!mobileRect(v)
}

/** Visuals listed in the Page visuals pane: top-level visuals and groups (children travel with their group). */
export function pageVisualItems(page: PageDocument): VisualDocument[] {
  const names = new Set(page.visuals.map((v) => v.name))
  return page.visuals
    .filter((v) => {
      const p = parentOf(v)
      return !p || !names.has(p)
    })
    .slice()
    .sort((a, b) => {
      const pa = positionOf(a)
      const pb = positionOf(b)
      return pa.tabOrder - pb.tabOrder || pa.y - pb.y || pa.x - pb.x
    })
}

/** Placed visuals, bottom-most layer first. */
export function placedVisuals(page: PageDocument): VisualDocument[] {
  return pageVisualItems(page)
    .filter(isPlaced)
    .sort((a, b) => mobileRect(a)!.z - mobileRect(b)!.z)
}

/** Height of the phone canvas: content bottom + room to drop, never less than a phone screen. */
export function mobileCanvasHeight(page: PageDocument): number {
  let bottom = 0
  for (const v of page.visuals) {
    const r = mobileRect(v)
    if (r) bottom = Math.max(bottom, r.y + r.height)
  }
  return Math.max(MOBILE_MIN_HEIGHT, snap(bottom + MOBILE_TAIL, MOBILE_GRID_MAJOR))
}

function maxMobileZ(page: PageDocument): number {
  let z = -1000
  for (const v of page.visuals) {
    const r = mobileRect(v)
    if (r) z = Math.max(z, r.z)
  }
  return z
}

/**
 * Default phone size for a visual. Visual text keeps its desktop pixel size on the phone, so visuals
 * aren't scaled down proportionally: narrow desktop visuals (buttons, cards, slicers) get a quarter or
 * half of the phone width, everything else the full width; the height keeps the desktop aspect but
 * at least 75% of the desktop height (charts stay readable), capped at 400.
 */
export function defaultMobileSize(page: PageDocument, v: VisualDocument): { width: number; height: number } {
  const desk = absoluteRect(page, v)
  const pageWidth = Number(page.json?.width ?? 1280) || 1280
  const share = desk.width / pageWidth
  const w = share <= 0.12 ? MOBILE_WIDTH / 4 : share <= 0.3 ? MOBILE_WIDTH / 2 : MOBILE_WIDTH
  const aspect = desk.width > 0 ? (w * desk.height) / desk.width : w / 2
  const h = Math.max(MOBILE_MIN_SIZE, Math.min(400, snap(Math.max(desk.height * 0.75, aspect))))
  return { width: w, height: h }
}

/** Keep a rect inside the canvas horizontally and below the top edge; snap to the grid when asked. */
export function clampMobile(r: Rect, opts: { snap?: boolean } = {}): Rect {
  const s = (n: number) => (opts.snap === false ? n : snap(n))
  let width = Math.max(MOBILE_MIN_SIZE, Math.min(MOBILE_WIDTH, s(r.width)))
  let height = Math.max(MOBILE_MIN_SIZE, s(r.height))
  let x = Math.max(0, Math.min(MOBILE_WIDTH - width, s(r.x)))
  const y = Math.max(0, s(r.y))
  if (!Number.isFinite(width)) width = MOBILE_WIDTH
  if (!Number.isFinite(height)) height = MOBILE_MIN_SIZE
  if (!Number.isFinite(x)) x = 0
  return { x, y, width, height }
}

function writePosition(v: VisualDocument, r: Rect, z: number): void {
  const m = (v.mobile ??= { $schema: MOBILE_SCHEMA })
  if (!m.$schema) m.$schema = MOBILE_SCHEMA
  m.position = { x: tidy(r.x), y: tidy(r.y), z, width: tidy(r.width), height: tidy(r.height), tabOrder: z }
}

/**
 * Place a visual on the phone canvas (on top of the others). `at` = desired top-left; default: below
 * the lowest placed visual. Returns false when the visual doesn't exist or is a group child.
 */
export function addToMobile(page: PageDocument, name: string, at?: { x: number; y: number }, size?: { width: number; height: number }): boolean {
  const v = page.visuals.find((o) => o.name === name)
  if (!v || !pageVisualItems(page).includes(v)) return false
  const sz = size ?? defaultMobileSize(page, v)
  let pos = at
  if (!pos) {
    let bottom = 0
    for (const o of page.visuals) {
      const r = mobileRect(o)
      if (r && o !== v) bottom = Math.max(bottom, r.y + r.height)
    }
    pos = { x: 0, y: bottom }
  }
  writePosition(v, clampMobile({ ...pos, ...sz }), maxMobileZ(page) + 1000)
  return true
}

/** Set mobile rects (move / resize). Visuals not placed yet are ignored. */
export function setMobileRects(page: PageDocument, rects: Record<string, Rect>, opts: { snap?: boolean } = {}): void {
  for (const [name, r] of Object.entries(rects)) {
    const v = page.visuals.find((o) => o.name === name)
    const cur = mobileRect(v)
    if (!v || !cur) continue
    writePosition(v, clampMobile(r, opts), cur.z)
  }
}

export function moveMobileBy(page: PageDocument, names: string[], dx: number, dy: number): void {
  const rects: Record<string, Rect> = {}
  for (const n of names) {
    const r = mobileRect(page.visuals.find((v) => v.name === n))
    if (r) rects[n] = { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }
  }
  setMobileRects(page, rects, { snap: false })
}

/**
 * Remove visuals from the phone canvas (the desktop layout is untouched). Mobile-only formatting
 * overrides are dropped together with the position, like PBI (mobile.json is deleted).
 */
export function removeFromMobile(page: PageDocument, names: string[]): void {
  const set = new Set(names)
  for (const v of page.visuals) if (set.has(v.name) && v.mobile !== undefined) delete v.mobile
}

/** Eraser: remove every visual from the phone canvas. */
export function clearMobile(page: PageDocument): void {
  for (const v of page.visuals) if (v.mobile !== undefined) delete v.mobile
}

/** Bring to front / send to back on the phone canvas. */
export function reorderMobile(page: PageDocument, names: string[], op: 'front' | 'back'): void {
  const placed = placedVisuals(page)
  const sel = new Set(names)
  const order = op === 'front' ? [...placed.filter((v) => !sel.has(v.name)), ...placed.filter((v) => sel.has(v.name))] : [...placed.filter((v) => sel.has(v.name)), ...placed.filter((v) => !sel.has(v.name))]
  order.forEach((v, i) => {
    v.mobile.position.z = i * 1000
    v.mobile.position.tabOrder = i * 1000
  })
}

/** Resize from a handle (page units), snapped to the grid (aspect kept with Shift like PBI). */
export function resizeMobile(start: Rect, handle: Handle, dx: number, dy: number, lockAspect: boolean, doSnap: boolean): Rect {
  const r = resizeRect(start, handle, dx, dy, { lockAspect, minSize: MOBILE_MIN_SIZE })
  if (!doSnap || lockAspect) return clampMobile(r, { snap: false })
  // snap only the moving edges so the opposite edges stay put
  let { x, y, width, height } = r
  if (handle.includes('e')) width = snap(x + width) - x
  if (handle.includes('w')) {
    const right = x + width
    x = snap(x)
    width = right - x
  }
  if (handle.includes('s')) height = snap(y + height) - y
  if (handle.includes('n')) {
    const bottom = y + height
    y = snap(y)
    height = bottom - y
  }
  if (x + width > MOBILE_WIDTH) width = MOBILE_WIDTH - x
  return clampMobile({ x, y, width, height }, { snap: false })
}

/** Move a rect (snapped top-left when `doSnap`) and keep it on the canvas. */
export function moveMobileRect(start: Rect, dx: number, dy: number, doSnap: boolean): Rect {
  return clampMobile({ ...start, x: start.x + dx, y: start.y + dy }, { snap: doSnap })
}

const DECORATIVE = /^(shape|basicShape|image)$/i

function containsRect(outer: Rect, inner: Rect, tol = 2): boolean {
  return inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.width <= outer.x + outer.width + tol && inner.y + inner.height <= outer.y + outer.height + tol
}

/**
 * Auto-create mobile layout: reads the desktop page left→right, top→bottom (row bands of vertically
 * overlapping visuals) and flows the visuals onto the phone canvas, packing narrow items (cards, slicers,
 * buttons) side by side and giving wide ones the full width. Replaces any existing mobile layout.
 *
 * Overlays: a decorative shape/image that contains other visuals (a header band, a card panel) is
 * kept as a backdrop — its contents are flowed first and the backdrop is sized to cover them, one
 * layer below. Approximation of PBI's engine: hidden visuals and full-page decorative backgrounds are
 * skipped rather than stacked (PBI's docs note its engine can't handle background images either).
 * Returns the names placed.
 */
export function autoCreateMobile(page: PageDocument): string[] {
  clearMobile(page)
  const pw = Number(page.json?.width ?? 1280) || 1280
  const ph = Number(page.json?.height ?? 720) || 720
  type Item = { v: VisualDocument; r: Rect; kids: Item[] }
  let items: Item[] = pageVisualItems(page)
    .filter((v) => !v.json?.isHidden)
    .map((v) => ({ v, r: absoluteRect(page, v), kids: [] as Item[] }))
    .filter(({ v, r }) => r.width > 0 && r.height > 0 && !(DECORATIVE.test(visualTypeOf(v)) && r.width * r.height > pw * ph * 0.4))
    // a group holding only decorative children (e.g. background panels) is skipped too
    .filter(({ v }) => !isGroup(v) || descendantsOf(page, v.name).some((d) => !isGroup(d) && !DECORATIVE.test(visualTypeOf(d))))
  // backdrops: decorative items containing others (smallest container wins)
  const backdrops = items.filter((it) => DECORATIVE.test(visualTypeOf(it.v)))
  const owned = new Set<Item>()
  for (const it of items) {
    if (backdrops.includes(it)) continue
    const host = backdrops.filter((b) => containsRect(b.r, it.r)).sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height)[0]
    if (host) {
      host.kids.push(it)
      owned.add(it)
    }
  }
  items = items.filter((it) => !owned.has(it))

  const placed: string[] = []
  let z = 0
  // flow a list of items starting at y; returns the bottom
  const flow = (list: Item[], startY: number): number => {
    list.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)
    // row bands: a visual joins the current band when it overlaps it vertically by ≥ 50%
    const bands: Array<{ top: number; bottom: number; items: Item[] }> = []
    for (const it of list) {
      const band = bands[bands.length - 1]
      const overlap = band ? Math.min(band.bottom, it.r.y + it.r.height) - Math.max(band.top, it.r.y) : 0
      if (band && overlap >= Math.min(it.r.height, band.bottom - band.top) * 0.5) {
        band.items.push(it)
        band.bottom = Math.max(band.bottom, it.r.y + it.r.height)
      } else bands.push({ top: it.r.y, bottom: it.r.y + it.r.height, items: [it] })
    }
    let y = startY
    for (const band of bands) {
      band.items.sort((a, b) => a.r.x - b.r.x)
      let rowX = 0
      let rowH = 0
      for (const it of band.items) {
        if (it.kids.length) {
          // backdrop: own full-width block behind its flowed contents
          if (rowX > 0) {
            y += rowH
            rowX = 0
            rowH = 0
          }
          const backZ = z
          z += 1000
          const bottom = flow(it.kids, y)
          const h = Math.max(MOBILE_MIN_SIZE, bottom - y)
          writePosition(it.v, { x: 0, y, width: MOBILE_WIDTH, height: h }, backZ)
          placed.push(it.v.name)
          y += h
          continue
        }
        const size = defaultMobileSize(page, it.v)
        if (rowX > 0 && rowX + size.width > MOBILE_WIDTH) {
          y += rowH
          rowX = 0
          rowH = 0
        }
        writePosition(it.v, clampMobile({ x: rowX, y, ...size }), z)
        placed.push(it.v.name)
        z += 1000
        rowX += size.width
        rowH = Math.max(rowH, size.height)
      }
      y += rowH
    }
    return y
  }
  flow(items, 0)
  return placed
}

/**
 * visual.json with the mobile.json formatting overrides applied (object-level replacement, like PBI:
 * a mobile override of an object wins over the desktop entries of that object).
 */
export function mobileVisualJson(v: VisualDocument): any {
  const m = v.mobile
  if (!m || (!m.objects && !m.visualContainerObjects)) return v.json
  const j = { ...v.json }
  const key = j.visual ? 'visual' : j.visualGroup ? 'visualGroup' : null
  if (!key) return v.json
  const inner = { ...j[key] }
  if (m.objects) inner.objects = { ...(inner.objects ?? {}), ...m.objects }
  if (m.visualContainerObjects) inner.visualContainerObjects = { ...(inner.visualContainerObjects ?? {}), ...m.visualContainerObjects }
  j[key] = inner
  return j
}

/**
 * Leaf visuals of a placed group mapped into the group's mobile rect (ScaleMode-like scaling of the
 * desktop arrangement). Rects are relative to the group's mobile rect.
 */
export function groupChildrenRects(page: PageDocument, group: VisualDocument, target: Rect): Array<{ v: VisualDocument; rect: Rect; z: number }> {
  const g = absoluteRect(page, group)
  const sx = g.width > 0 ? target.width / g.width : 1
  const sy = g.height > 0 ? target.height / g.height : 1
  return descendantsOf(page, group.name)
    .filter((d) => !isGroup(d))
    .map((d) => {
      const r = absoluteRect(page, d)
      return { v: d, rect: { x: (r.x - g.x) * sx, y: (r.y - g.y) * sy, width: r.width * sx, height: r.height * sy }, z: depthZ(page, d, group.name) }
    })
}

/** Stacking key for a group descendant: its z within each ancestor level, flattened. */
function depthZ(page: PageDocument, v: VisualDocument, stop: string): number {
  const chain: number[] = []
  let cur: VisualDocument | undefined = v
  while (cur && cur.name !== stop) {
    chain.unshift(positionOf(cur).z)
    const p = parentOf(cur)
    cur = p ? page.visuals.find((o) => o.name === p) : undefined
  }
  return chain.reduce((acc, z) => acc * 1e4 + z / 1000, 0)
}

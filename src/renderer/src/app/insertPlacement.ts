/**
 * Where Insert ▸ Icon puts a new visual: centred on the part of the page that is visible on the canvas (the user is
 * looking there, and a page header at the top-left is not covered), stepping 20 px down-right while another visual
 * already sits at exactly that spot (repeated inserts do not stack), and kept inside the page.
 */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Page-coordinate placement of a `w`×`h` visual centred on `visible` (a page-coordinate rectangle). */
export function centredPlacement(page: { width: number; height: number }, visible: Box | undefined, w: number, h: number, taken: Array<{ x: number; y: number }> = []): Box {
  const width = Math.min(w, page.width)
  const height = Math.min(h, page.height)
  const v = visible ?? { x: 0, y: 0, width: page.width, height: page.height }
  const clampX = (x: number) => Math.max(0, Math.min(page.width - width, Math.round(x)))
  const clampY = (y: number) => Math.max(0, Math.min(page.height - height, Math.round(y)))
  let x = clampX(v.x + (v.width - width) / 2)
  let y = clampY(v.y + (v.height - height) / 2)
  const at = new Set(taken.map((t) => `${Math.round(t.x)},${Math.round(t.y)}`))
  for (let i = 0; i < 40 && at.has(`${x},${y}`); i++) {
    const nx = clampX(x + 20)
    const ny = clampY(y + 20)
    if (nx === x && ny === y) break
    x = nx
    y = ny
  }
  return { x, y, width, height }
}

/** The visible part of a page on the interactive canvas, in page coordinates (undefined when the page is not shown). */
export function visiblePageRect(pageName: string, pageWidth: number): Box | undefined {
  if (typeof document === 'undefined') return undefined
  const viewport = document.querySelector<HTMLElement>('.wbi-viewport')
  const pageEl = viewport?.querySelector<HTMLElement>(`.wbi-page[data-page="${CSS.escape(pageName)}"]`)
  if (!viewport || !pageEl) return undefined
  const a = viewport.getBoundingClientRect()
  const b = pageEl.getBoundingClientRect()
  const left = Math.max(a.left, b.left)
  const right = Math.min(a.right, b.right)
  const top = Math.max(a.top, b.top)
  const bottom = Math.min(a.bottom, b.bottom)
  if (right <= left || bottom <= top || !b.width || !pageWidth) return undefined
  const s = b.width / pageWidth
  return { x: (left - b.left) / s, y: (top - b.top) / s, width: (right - left) / s, height: (bottom - top) / s }
}

/**
 * Rectangle helpers for the model diagram: bounding box and "fit to screen".
 * (Relationship line geometry lives in ./routing.)
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Bounding box of rects (null for none). */
export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.width)
    y1 = Math.max(y1, r.y + r.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Zoom & pan that fit `content` into a viewport of `vw`×`vh` with padding. */
export function fitView(content: Rect | null, vw: number, vh: number, opts: { padding?: number; min?: number; max?: number } = {}): { zoom: number; panX: number; panY: number } {
  const pad = opts.padding ?? 40
  if (!content || vw <= 0 || vh <= 0) return { zoom: 1, panX: pad, panY: pad }
  const z = Math.min((vw - pad * 2) / Math.max(1, content.width), (vh - pad * 2) / Math.max(1, content.height))
  const zoom = Math.max(opts.min ?? 0.1, Math.min(opts.max ?? 1, z))
  const panX = (vw - content.width * zoom) / 2 - content.x * zoom
  const panY = Math.max(pad - content.y * zoom, (vh - content.height * zoom) / 2 - content.y * zoom)
  return { zoom, panX: zoom === z ? panX : pad - content.x * zoom, panY: zoom === z ? panY : pad - content.y * zoom }
}

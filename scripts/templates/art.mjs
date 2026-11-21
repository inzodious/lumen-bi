/**
 * Vector art helpers for the gallery templates. Every picture is a plain SVG string (no fonts, no
 * scripts, no external references) so it renders the same in Lumen and in Power BI Desktop.
 */
import { rng } from './lib.mjs'

export const f = (n) => (Math.round(n * 100) / 100).toString()

export function svg(w, h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
}

/** Polyline path through points. */
export function pathOf(pts, close = false) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('') + (close ? 'Z' : '')
}

/** Smooth closed/open path through points (Catmull-Rom → cubic Bézier). */
export function smooth(pts, close = false, t = 0.5) {
  const n = pts.length
  const P = (i) => (close ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  const last = close ? n : n - 1
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2)
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * t * 2, p1[1] + ((p2[1] - p0[1]) / 6) * t * 2]
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * t * 2, p2[1] - ((p3[1] - p1[1]) / 6) * t * 2]
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + (close ? 'Z' : '')
}

/** Guilloché rosette: overlapping hypotrochoids, like the engraving on a bank note. */
export function rosette(cx, cy, R, { loops = 18, layers = 3, stroke = '#000', width = 0.5, opacity = 0.3 } = {}) {
  let out = ''
  for (let L = 0; L < layers; L++) {
    const r = R / (loops + 0.0)
    const d = R * (0.55 + L * 0.14)
    const pts = []
    const steps = 1400
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2
      const k = (R - r) / r
      const x = (R - r) * Math.cos(t) + d * Math.cos(k * t) * 0.35
      const y = (R - r) * Math.sin(t) - d * Math.sin(k * t) * 0.35
      const s = 0.62 + L * 0.13
      pts.push([cx + x * s, cy + y * s])
    }
    out += `<path d="${pathOf(pts, true)}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`
  }
  return out
}

/** Random star field. */
export function stars(w, h, n, seed, { color = '#fff', min = 0.3, max = 1.6, twinkle = 0.12 } = {}) {
  const r = rng(seed)
  let out = ''
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h
    const s = min + Math.pow(r(), 3) * (max - min)
    const o = 0.25 + r() * 0.75
    if (s > max * 0.8 && r() < twinkle * 4) {
      const L = s * 4
      out += `<path d="M${f(x - L)} ${f(y)}L${f(x + L)} ${f(y)}M${f(x)} ${f(y - L)}L${f(x)} ${f(y + L)}" stroke="${color}" stroke-width="${f(s * 0.35)}" opacity="${f(o * 0.7)}"/>`
    }
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s)}" fill="${color}" opacity="${f(o)}"/>`
  }
  return out
}

/** Value noise for contour art. */
export function noise2(seed) {
  const r = rng(seed)
  const G = 16
  const grid = Array.from({ length: G * G }, () => r())
  const at = (i, j) => grid[((j % G) + G) % G * G + (((i % G) + G) % G)]
  const sm = (t) => t * t * (3 - 2 * t)
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y)
    const u = sm(x - i), v = sm(y - j)
    const a = at(i, j), b = at(i + 1, j), c2 = at(i, j + 1), d = at(i + 1, j + 1)
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v
  }
}

/** Iso-lines of a scalar field (marching squares, segments joined per level). */
export function contours(w, h, field, levels, { cell = 8 } = {}) {
  const nx = Math.ceil(w / cell) + 1, ny = Math.ceil(h / cell) + 1
  const vals = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals.push(field(i * cell, j * cell))
  const V = (i, j) => vals[j * nx + i]
  const paths = []
  for (const lv of levels) {
    let d = ''
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = V(i, j), b = V(i + 1, j), cc = V(i + 1, j + 1), dd = V(i, j + 1)
        const x = i * cell, y = j * cell
        const lerp = (p, q) => (lv - p) / (q - p)
        const pts = []
        if ((a < lv) !== (b < lv)) pts.push([x + lerp(a, b) * cell, y])
        if ((b < lv) !== (cc < lv)) pts.push([x + cell, y + lerp(b, cc) * cell])
        if ((dd < lv) !== (cc < lv)) pts.push([x + lerp(dd, cc) * cell, y + cell])
        if ((a < lv) !== (dd < lv)) pts.push([x, y + lerp(a, dd) * cell])
        for (let k = 0; k + 1 < pts.length; k += 2) d += `M${f(pts[k][0])} ${f(pts[k][1])}L${f(pts[k + 1][0])} ${f(pts[k + 1][1])}`
      }
    paths.push({ level: lv, d })
  }
  return paths
}

/** Rounded rectangle path. */
export function rrect(x, y, w, h, r) {
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`
}

/** n-point star polygon. */
export function starPath(cx, cy, R, r, n, rot = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n
    const rad = i % 2 ? r : R
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad])
  }
  return pathOf(pts, true)
}

/** Halftone dot field fading along x. */
export function halftone(x0, y0, w, h, step, color, { maxR = step * 0.45, dir = 'x', opacity = 1 } = {}) {
  let out = ''
  for (let y = y0; y < y0 + h; y += step)
    for (let x = x0; x < x0 + w; x += step) {
      const t = dir === 'x' ? (x - x0) / w : (y - y0) / h
      const r = maxR * (1 - t)
      if (r > 0.3) out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`
    }
  return `<g fill="${color}" opacity="${opacity}">${out}</g>`
}

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let LETTERING
/** Glyph outlines from lettering.json (see outline.py). */
export function glyphs(face) {
  LETTERING ??= JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lettering.json'), 'utf8'))
  return LETTERING[face]
}

/**
 * Lay out a word as one path per letter: [{ d, transform }]. `size` is the em size in px, `track` extra
 * spacing in em, `each(i)` returns { dy, rot, scale } per letter for bouncy lettering.
 */
export function word(face, text, { x = 0, y = 0, size = 100, track = 0, each } = {}) {
  const g = glyphs(face)
  const s = size / 1000
  let pen = x
  const out = []
  ;[...text].forEach((ch, i) => {
    const gl = g[ch] ?? g[' ']
    const o = each ? each(i) : {}
    const sc = s * (o.scale ?? 1)
    const cx = pen + (gl.adv * sc) / 2
    out.push({ d: gl.d, ch, x: pen, w: gl.adv * sc, transform: `translate(${f(pen)} ${f(y + (o.dy ?? 0))}) rotate(${f(o.rot ?? 0)} ${f((gl.adv * s) / 2)} ${f(-size * 0.35)}) scale(${f(sc)})`, cx })
    pen += gl.adv * sc + track * size
  })
  return { letters: out, width: pen - x }
}

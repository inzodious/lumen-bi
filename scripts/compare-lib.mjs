// Image primitives and scores for scripts/compare.mjs (see docs/COMPARE.md). Pure Node: no image library is
// installed, so PNG is decoded / encoded here with node:zlib, and everything else works on RGBA byte arrays.
//
// An image is { width, height, data: Uint8Array (RGBA, 4 bytes per pixel) }.
import { inflateSync, deflateSync } from 'node:zlib'

// ───────────────────────────── images ─────────────────────────────

export function createImage(width, height, fill = [255, 255, 255, 255]) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]
    data[i + 1] = fill[1]
    data[i + 2] = fill[2]
    data[i + 3] = fill[3] ?? 255
  }
  return { width, height, data }
}

/** Fill an integer rectangle (clipped) with a colour. Mutates `img`. */
export function fillRect(img, x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(img.width, Math.round(x + w))
  const y1 = Math.min(img.height, Math.round(y + h))
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * img.width + xx) * 4
      img.data[i] = c[0]
      img.data[i + 1] = c[1]
      img.data[i + 2] = c[2]
      img.data[i + 3] = c[3] ?? 255
    }
  return img
}

// ───────────────────────────── PNG codec ─────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function isPng(buf) {
  return buf.length > 8 && PNG_SIG.every((b, i) => buf[i] === b)
}
export function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

/** Decode a non-interlaced PNG (any colour type, bit depth 1–16) to RGBA8. */
export function decodePng(buf) {
  buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (!isPng(buf)) throw new Error('not a PNG file')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 8
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0
  let palette = null, trns = null
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = dv.getUint32(pos)
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7])
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8)
      height = dv.getUint32(pos + 12)
      depth = body[8]
      ctype = body[9]
      interlace = body[12]
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') trns = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (interlace) throw new Error('interlaced PNG is not supported (re-save it without interlacing)')
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]
  if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`)
  const raw = inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))))
  const bpp = Math.max(1, (channels * depth) >> 3) // bytes per pixel for filtering
  const stride = Math.ceil((width * channels * depth) / 8)
  const lines = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = lines.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = src[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = v & 0xff
    }
    prev = out
  }
  const img = createImage(width, height)
  const max = (1 << depth) - 1
  const sample = (row, idx) => {
    // idx-th sample of a row
    if (depth === 8) return row[idx]
    if (depth === 16) return row[idx * 2] // high byte
    const bit = idx * depth
    return (row[bit >> 3] >> (8 - depth - (bit & 7))) & max
  }
  const to8 = (v) => (depth === 8 || depth === 16 ? v : Math.round((v * 255) / max))
  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let r, g, b, a = 255
      if (ctype === 3) {
        const p = sample(row, x)
        r = palette[p * 3]; g = palette[p * 3 + 1]; b = palette[p * 3 + 2]
        if (trns && p < trns.length) a = trns[p]
      } else if (ctype === 0 || ctype === 4) {
        r = g = b = to8(sample(row, x * channels))
        if (ctype === 4) a = to8(sample(row, x * channels + 1))
      } else {
        r = to8(sample(row, x * channels)); g = to8(sample(row, x * channels + 1)); b = to8(sample(row, x * channels + 2))
        if (ctype === 6) a = to8(sample(row, x * channels + 3))
      }
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a
    }
  }
  return flattenAlpha(img)
}

/** Composite onto white (screenshots with alpha are opaque in practice; this keeps maths on RGB simple). */
export function flattenAlpha(img) {
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a === 255) continue
    d[i] = Math.round((d[i] * a + 255 * (255 - a)) / 255)
    d[i + 1] = Math.round((d[i + 1] * a + 255 * (255 - a)) / 255)
    d[i + 2] = Math.round((d[i + 2] * a + 255 * (255 - a)) / 255)
    d[i + 3] = 255
  }
  return img
}

/** Encode RGBA8 as PNG (colour type 6, Up filter). */
export function encodePng(img) {
  const { width, height, data } = img
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 2
    for (let i = 0; i < stride; i++) {
      const up = y > 0 ? data[(y - 1) * stride + i] : 0
      raw[y * (stride + 1) + 1 + i] = (data[y * stride + i] - up) & 0xff
    }
  }
  const chunk = (type, body) => {
    const b = Buffer.alloc(12 + body.length)
    b.writeUInt32BE(body.length, 0)
    b.write(type, 4, 'ascii')
    Buffer.from(body).copy(b, 8)
    b.writeUInt32BE(crc32(b.subarray(4, 8 + body.length)), 8 + body.length)
    return b
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from(PNG_SIG), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))])
}

// ───────────────────────────── geometry ─────────────────────────────

/** Copy an integer rectangle; parts outside the source are white. */
export function crop(img, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
  const out = createImage(w, h)
  for (let yy = 0; yy < h; yy++) {
    const sy = y + yy
    if (sy < 0 || sy >= img.height) continue
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx
      if (sx < 0 || sx >= img.width) continue
      const s = (sy * img.width + sx) * 4, d = (yy * w + xx) * 4
      out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1]; out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = 255
    }
  }
  return out
}

/** Per-axis area weights: for each output cell, the source pixels it covers and by how much. */
function axisWeights(start, len, outLen, srcLen) {
  const k = len / outLen
  const res = []
  for (let o = 0; o < outLen; o++) {
    let a = start + o * k
    let b = a + k
    if (k < 1) {
      // upscaling: point-sample the centre (nearest) — only used for display, never for scores
      const c = Math.min(srcLen - 1, Math.max(0, Math.floor((a + b) / 2)))
      res.push([[c, 1]])
      continue
    }
    const ws = []
    let tot = 0
    for (let i = Math.floor(a); i < Math.ceil(b); i++) {
      const w = Math.min(b, i + 1) - Math.max(a, i)
      if (w <= 0) continue
      const ci = Math.min(srcLen - 1, Math.max(0, i))
      ws.push([ci, w])
      tot += w
    }
    res.push(ws.map(([i, w]) => [i, w / tot]))
  }
  return res
}

/** Resample the (fractional) rectangle `r` of `img` to outW × outH with area averaging. */
export function resample(img, r, outW, outH) {
  outW = Math.max(1, Math.round(outW)); outH = Math.max(1, Math.round(outH))
  const wx = axisWeights(r.x, r.w, outW, img.width)
  const wy = axisWeights(r.y, r.h, outH, img.height)
  // horizontal pass into float rows for the source rows we need
  const rowsNeeded = new Set()
  for (const ws of wy) for (const [i] of ws) rowsNeeded.add(i)
  const tmp = new Map()
  for (const sy of rowsNeeded) {
    const row = new Float32Array(outW * 3)
    for (let ox = 0; ox < outW; ox++) {
      let r0 = 0, g0 = 0, b0 = 0
      for (const [sx, w] of wx[ox]) {
        const s = (sy * img.width + sx) * 4
        r0 += img.data[s] * w; g0 += img.data[s + 1] * w; b0 += img.data[s + 2] * w
      }
      row[ox * 3] = r0; row[ox * 3 + 1] = g0; row[ox * 3 + 2] = b0
    }
    tmp.set(sy, row)
  }
  const out = createImage(outW, outH)
  for (let oy = 0; oy < outH; oy++)
    for (let ox = 0; ox < outW; ox++) {
      let r0 = 0, g0 = 0, b0 = 0
      for (const [sy, w] of wy[oy]) {
        const row = tmp.get(sy)
        r0 += row[ox * 3] * w; g0 += row[ox * 3 + 1] * w; b0 += row[ox * 3 + 2] * w
      }
      const d = (oy * outW + ox) * 4
      out.data[d] = Math.round(r0); out.data[d + 1] = Math.round(g0); out.data[d + 2] = Math.round(b0); out.data[d + 3] = 255
    }
  return out
}

/** Draw a 1 px rectangle outline (clipped). Mutates `img`. */
export function strokeRect(img, x, y, w, h, c) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h)
  fillRect(img, x, y, w, 1, c)
  fillRect(img, x, y + h - 1, w, 1, c)
  fillRect(img, x, y, 1, h, c)
  fillRect(img, x + w - 1, y, 1, h, c)
  return img
}

/** Place images left to right with a gap, top-aligned, on a neutral background. */
export function sideBySide(images, gap = 8, bg = [128, 128, 128, 255]) {
  const w = images.reduce((a, im) => a + im.width, 0) + gap * (images.length - 1)
  const h = Math.max(...images.map((im) => im.height))
  const out = createImage(w, h, bg)
  let x0 = 0
  for (const im of images) {
    for (let y = 0; y < im.height; y++) out.data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), (y * w + x0) * 4)
    x0 += im.width + gap
  }
  return out
}

/** Upside-down copy. */
export function flipV(img) {
  const out = createImage(img.width, img.height)
  const row = img.width * 4
  for (let y = 0; y < img.height; y++) out.data.set(img.data.subarray(y * row, (y + 1) * row), (img.height - 1 - y) * row)
  return out
}

/** Nearest-neighbour integer upscale (for small crops on the review page). */
export function upscale(img, k) {
  if (k <= 1) return img
  const out = createImage(img.width * k, img.height * k)
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4
      out.data.set(img.data.subarray(s, s + 4), (y * out.width + x) * 4)
    }
  return out
}

// ───────────────────────────── colour ─────────────────────────────

const LIN = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)

/** sRGB (0–255) → CIE L*a*b* (D65). */
export function rgbToLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b]
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const fx = fLab(x), fy = fLab(y), fz = fLab(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Lab of every pixel (Float32Array, 3 per pixel), cached per image. */
export function labOf(img) {
  if (img._lab) return img._lab
  const n = img.width * img.height
  const lab = new Float32Array(n * 3)
  const cache = new Map()
  for (let p = 0; p < n; p++) {
    const r = img.data[p * 4], g = img.data[p * 4 + 1], b = img.data[p * 4 + 2]
    const key = (r << 16) | (g << 8) | b
    let v = cache.get(key)
    if (!v) {
      v = rgbToLab(r, g, b)
      if (cache.size < 200000) cache.set(key, v)
    }
    lab[p * 3] = v[0]; lab[p * 3 + 1] = v[1]; lab[p * 3 + 2] = v[2]
  }
  Object.defineProperty(img, '_lab', { value: lab, enumerable: false })
  return lab
}

export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Most common colour (5 bits / channel bins, averaged within the winning bin) over a region. */
export function modeColour(img, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height) {
  const counts = new Map()
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4
      const k = ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3)
      const e = counts.get(k)
      if (e) { e[0]++; e[1] += img.data[i]; e[2] += img.data[i + 1]; e[3] += img.data[i + 2] }
      else counts.set(k, [1, img.data[i], img.data[i + 1], img.data[i + 2]])
    }
  let best = null
  for (const e of counts.values()) if (!best || e[0] > best[0]) best = e
  if (!best) return [255, 255, 255]
  return [best[1] / best[0], best[2] / best[0], best[3] / best[0]].map(Math.round)
}

// ───────────────────────────── alignment ─────────────────────────────

function lumaGrid(img) {
  const n = img.width * img.height
  const L = new Float64Array(n)
  for (let p = 0; p < n; p++) L[p] = 0.299 * img.data[p * 4] + 0.587 * img.data[p * 4 + 1] + 0.114 * img.data[p * 4 + 2]
  return L
}

function integral(L, w, h) {
  const I = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) {
      s += L[y * w + x]
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s
    }
  }
  return I
}

function normalise(v) {
  const n = v.length
  let m = 0
  for (const x of v) m += x
  m /= n
  let s = 0
  for (let i = 0; i < n; i++) { v[i] -= m; s += v[i] * v[i] }
  const sd = Math.sqrt(s / n)
  if (sd < 1e-6) return null
  for (let i = 0; i < n; i++) v[i] /= sd
  return v
}

/** Zero-mean normalised cross-correlation of a template grid against one candidate rectangle (box means). */
function nccAt(I, iw, T, gw, gh, x, y, w, h) {
  const n = gw * gh
  const v = new Float64Array(n)
  const W = iw + 1
  let m = 0
  for (let gy = 0; gy < gh; gy++) {
    const ya = Math.round(y + (gy * h) / gh), yb = Math.max(ya + 1, Math.round(y + ((gy + 1) * h) / gh))
    for (let gx = 0; gx < gw; gx++) {
      const xa = Math.round(x + (gx * w) / gw), xb = Math.max(xa + 1, Math.round(x + ((gx + 1) * w) / gw))
      const s = I[yb * W + xb] - I[ya * W + xb] - I[yb * W + xa] + I[ya * W + xa]
      const val = s / ((xb - xa) * (yb - ya))
      v[gy * gw + gx] = val
      m += val
    }
  }
  m /= n
  let ss = 0, dot = 0
  for (let i = 0; i < n; i++) {
    const d = v[i] - m
    ss += d * d
    dot += d * T[i]
  }
  const sd = Math.sqrt(ss / n)
  return sd < 1e-6 ? -1 : dot / (n * sd)
}

/**
 * Find the report page inside a reference image (a screenshot with or without Power BI's window chrome, or a
 * rasterised PDF page with margins). `template` is Lumen's render of the same page: the layout (visual
 * containers, backgrounds, header bands) matches even when the data differs, so the rectangle with the
 * page's aspect ratio whose downscaled luminance correlates best with the template wins.
 * Returns { x, y, w, h, ncc } in reference pixels.
 */
export function findCanvas(ref, template, aspect, opts = {}) {
  const minFrac = opts.minFrac ?? 0.3
  const aspectTol = opts.aspectTol ?? 0.015
  const stage = (maxW, gw, around) => {
    const f = Math.min(1, maxW / ref.width)
    const im = f < 1 ? resample(ref, { x: 0, y: 0, w: ref.width, h: ref.height }, ref.width * f, ref.height * f) : ref
    const I = integral(lumaGrid(im), im.width, im.height)
    const gh = Math.max(6, Math.round(gw / aspect))
    const T = normalise(lumaGrid(resample(template, { x: 0, y: 0, w: template.width, h: template.height }, gw, gh)))
    if (!T) return null
    let best = { ncc: -2 }
    const tryAt = (x, y, w, h) => {
      if (x < 0 || y < 0 || x + w > im.width + 0.01 || y + h > im.height + 0.01 || w < 8 || h < 4) return
      const c = nccAt(I, im.width, T, gw, gh, x, y, w, h)
      if (c > best.ncc) best = { x, y, w, h, ncc: c }
    }
    if (!around) {
      const wMax = Math.min(im.width, im.height * aspect)
      const sw = Math.max(1, Math.round(wMax / 150))
      for (let w = wMax; w >= Math.max(16, im.width * minFrac); w -= sw) {
        const h = w / aspect
        const st = Math.max(1, Math.round(w / 70))
        for (let y = 0; y + h <= im.height + 0.01; y += st) for (let x = 0; x + w <= im.width + 0.01; x += st) tryAt(x, y, w, h)
        // flush with the right / bottom edges too (the grid step may skip them)
        tryAt(im.width - w, im.height - h, w, h)
        for (let y = 0; y + h <= im.height + 0.01; y += st) tryAt(im.width - w, y, w, h)
        for (let x = 0; x + w <= im.width + 0.01; x += st) tryAt(x, im.height - h, w, h)
      }
    } else {
      const a = { x: around.x * f, y: around.y * f, w: around.w * f, h: around.h * f }
      const R = Math.max(2, Math.ceil(around.slack * f))
      for (let dw = -R; dw <= R; dw++) {
        const w = a.w + dw
        for (const t of [-aspectTol, -aspectTol / 2, 0, aspectTol / 2, aspectTol]) {
          const h = (w / aspect) * (1 + t)
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) tryAt(a.x + dx, a.y + dy, w, h)
        }
      }
    }
    if (best.ncc < -1) return null
    return { x: best.x / f, y: best.y / f, w: best.w / f, h: best.h / f, ncc: best.ncc, step: 1 / f }
  }
  const coarse = stage(opts.coarseWidth ?? 320, 40)
  if (!coarse) return { x: 0, y: 0, w: ref.width, h: ref.height, ncc: 0, fallback: true }
  const mid = stage(720, 64, { ...coarse, slack: Math.max(3, coarse.step * 3) }) ?? coarse
  const fine = stage(Math.max(ref.width, 1), 96, { ...mid, slack: Math.max(2, mid.step * 2) }) ?? mid
  return { x: Math.round(fine.x), y: Math.round(fine.y), w: Math.round(fine.w), h: Math.round(fine.h), ncc: Math.round(fine.ncc * 1000) / 1000 }
}

/**
 * Directional edge maps of an image for rectangle matching: vertical edges (horizontal luminance gradient
 * above `thr`, dilated ±r along x) with per-column prefix sums, so `vSeg` gives the share of a vertical
 * segment that lies on an edge; `hSeg` the same for horizontal edges.
 */
export function edgeMaps(img, r, thr = 3.5) {
  const { width: w, height: h } = img
  const L = lumaGrid(img)
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      gx[p] = x > 0 && x < w - 1 ? Math.abs(L[p + 1] - L[p - 1]) / 2 : 0
      gy[p] = y > 0 && y < h - 1 ? Math.abs(L[p + w] - L[p - w]) / 2 : 0
    }
  // dilate across the edge direction so a 1 px misplacement still scores
  const dx = new Float32Array(w * h), dy = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const xx = x + k, yy = y + k
        if (xx >= 0 && xx < w) m = Math.max(m, gx[y * w + xx])
        if (yy >= 0 && yy < h) n = Math.max(n, gy[yy * w + x])
      }
      // binary: a container border is a consistent edge along its whole length, text / marks are sparse
      dx[y * w + x] = m > thr ? 1 : 0
      dy[y * w + x] = n > thr ? 1 : 0
    }
  // colPre[x * (h + 1) + y] = Σ dx[0..y) in column x; rowPre[y * (w + 1) + x] = Σ dy[0..x) in row y
  const colPre = new Float64Array(w * (h + 1)), rowPre = new Float64Array(h * (w + 1))
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) colPre[x * (h + 1) + y + 1] = colPre[x * (h + 1) + y] + dx[y * w + x]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowPre[y * (w + 1) + x + 1] = rowPre[y * (w + 1) + x] + dy[y * w + x]
  const vSeg = (X, ya, yb) => {
    X = Math.round(X)
    ya = Math.max(0, Math.round(ya)); yb = Math.min(h, Math.round(yb))
    if (X < 0 || X >= w || yb <= ya) return 0
    return (colPre[X * (h + 1) + yb] - colPre[X * (h + 1) + ya]) / (yb - ya)
  }
  const hSeg = (Y, xa, xb) => {
    Y = Math.round(Y)
    xa = Math.max(0, Math.round(xa)); xb = Math.min(w, Math.round(xb))
    if (Y < 0 || Y >= h || xb <= xa) return 0
    return (rowPre[Y * (w + 1) + xb] - rowPre[Y * (w + 1) + xa]) / (xb - xa)
  }
  return { w, h, vSeg, hSeg }
}

/** The edges of visual rectangles (page units) that do not lie on the page border, deduplicated. */
export function rectEdges(rects, pageW, pageH) {
  const out = []
  const seen = new Set()
  const add = (kind, at, a, b) => {
    if (b - a < 12) return
    if ((kind === 'v' && (at < 3 || at > pageW - 3)) || (kind === 'h' && (at < 3 || at > pageH - 3))) return
    const k = `${kind}:${Math.round(at)}:${Math.round(a)}:${Math.round(b)}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ kind, at, a, b })
  }
  for (const r of rects) {
    if (r.w < 12 || r.h < 12) continue
    add('v', r.x, r.y, r.y + r.h)
    add('v', r.x + r.w, r.y, r.y + r.h)
    add('h', r.y, r.x, r.x + r.w)
    add('h', r.y + r.h, r.x, r.x + r.w)
  }
  return out
}

/**
 * Edge evidence for a page placed at (x0, y0) with `k` image pixels per page unit: for every visual edge
 * from the definition, the share of the predicted line that lies on an image edge minus the larger share of
 * two parallel lines `off` pixels away (a ridge test: busy areas such as text or charts score ≈ 0,
 * container borders and background changes score high). Mean over edges, 0–1.
 */
function edgeScore(E, edges, x0, y0, k, off, ky = k) {
  let s = 0
  for (const e of edges) {
    if (e.kind === 'v') {
      const X = x0 + e.at * k, a = y0 + e.a * ky, b = y0 + e.b * ky
      s += E.vSeg(X, a, b) - Math.max(E.vSeg(X - off, a, b), E.vSeg(X + off, a, b))
    } else {
      const Y = y0 + e.at * ky, a = x0 + e.a * k, b = x0 + e.b * k
      s += E.hSeg(Y, a, b) - Math.max(E.hSeg(Y - off, a, b), E.hSeg(Y + off, a, b))
    }
  }
  return s / edges.length
}

/**
 * Refine a page placement with the visual rectangles from the definition: around `guess` ({ x, y, w } in
 * reference pixels), the offset + uniform scale whose predicted container edges best line up with edges in
 * the reference. This uses where Power BI draws the containers, so it does not depend on Lumen drawing them in
 * the right place; it is precise (± 1 px) but only searches near the guess. Returns null when the page has
 * too few usable edges. `opts.evalAt` ([[x, y, w], …]) returns the edge score of given placements instead.
 */
export function refineCanvasByRects(ref, rects, pageW, pageH, guess, opts = {}) {
  const edges = rectEdges(rects, pageW, pageH)
  if (edges.length < 6) return null
  const overhang = opts.overhang ?? 0.01 // the page may be cut by a pixel or two at the image border
  const E = edgeMaps(ref, 1, 3.5)
  const score = (x, y, w) => edgeScore(E, edges, x, y, w / pageW, 4)
  if (opts.evalAt) return opts.evalAt.map(([x, y, w]) => Math.round(score(x, y, w) * 100) / 100)
  const fits = (x, y, w) => {
    const h = (w * pageH) / pageW
    return !(x < -w * overhang || y < -h * overhang || x + w > ref.width * (1 + overhang) + 0.5 || y + h > ref.height * (1 + overhang) + 0.5)
  }
  let best = null
  const at = (x, y, w) => {
    if (!fits(x, y, w)) return
    const sc = score(x, y, w)
    if (!best || sc > best.score) best = { x, y, w, score: sc }
  }
  const R = Math.max(4, Math.round((opts.radius ?? 0.06) * guess.w))
  const st = Math.max(1, Math.round(R / 24))
  for (let dw = -R; dw <= R; dw += st) for (let dy = -R; dy <= R; dy += st) for (let dx = -R; dx <= R; dx += st) at(Math.round(guess.x + dx), Math.round(guess.y + dy), Math.round(guess.w + dw))
  if (!best) return null
  // local descent at 1 px
  for (let pass = 0; pass < 4; pass++) {
    const b0 = best
    const r = pass === 0 ? st + 1 : 2
    for (let dw = -r; dw <= r; dw++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) at(b0.x + dx, b0.y + dy, b0.w + dw)
    if (best === b0) break
  }
  // screenshots are sometimes resized non-uniformly: let the height move ±1.5% from the page's aspect,
  // fitting x / width and y / height in turn (vertical edges fix the first, horizontal edges the second)
  let cur = { x: best.x, y: best.y, w: best.w, h: (best.w * pageH) / pageW, score: best.score }
  const tol = opts.aspectTol ?? 0.015
  const score2 = (x, y, w, h) => edgeScore(E, edges, x, y, w / pageW, 4, h / pageH)
  for (let pass = 0; pass < 3; pass++) {
    const c0 = cur
    for (let dw = -4; dw <= 4; dw++) for (let dx = -3; dx <= 3; dx++) {
      const x = c0.x + dx, w = c0.w + dw
      if (Math.abs(c0.h / ((w * pageH) / pageW) - 1) > tol) continue
      const sc = score2(x, c0.y, w, c0.h)
      if (sc > cur.score + 1e-9) cur = { ...cur, x, w, score: sc }
    }
    for (let dh = -4; dh <= 4; dh++) for (let dy = -3; dy <= 3; dy++) {
      const y = cur.y + dy, h = Math.round(cur.h) + dh
      if (Math.abs(h / ((cur.w * pageH) / pageW) - 1) > tol) continue
      const sc = score2(cur.x, y, cur.w, h)
      if (sc > cur.score + 1e-9) cur = { ...cur, y, h, score: sc }
    }
    if (cur === c0 || (cur.x === c0.x && cur.y === c0.y && cur.w === c0.w && cur.h === c0.h)) break
  }
  return { x: cur.x, y: cur.y, w: cur.w, h: Math.round(cur.h), edgeScore: Math.round(cur.score * 100) / 100 }
}

/**
 * Local alignment of one visual: the translation (± `R` px) that puts the visual's own container edges
 * (rect in page units, `s` px per unit, edges on the page border ignored) on edges of the normalised
 * reference page. Absorbs mild non-linear warping of processed screenshots that one global fit cannot.
 * Returns { dx, dy, score, base } — callers keep (0, 0) unless the shift is clearly better.
 */
export function localOffset(E, rect, pageW, pageH, s, R) {
  const edges = rectEdges([rect], pageW, pageH)
  if (edges.length < 2) return { dx: 0, dy: 0, score: 0, base: 0 }
  const at = (dx, dy) => edgeScore(E, edges, dx, dy, s, 3)
  const base = at(0, 0)
  let best = { dx: 0, dy: 0, score: base }
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const sc = at(dx, dy)
      // prefer the smaller shift on ties
      if (sc > best.score + 1e-9 || (Math.abs(sc - best.score) < 1e-9 && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))) best = { dx, dy, score: sc }
    }
  return { ...best, base }
}

/**
 * Content alignment of one visual without a usable border: the translation (± `R` px) of the reference crop
 * window (x, y, w, h in `ref`) whose luminance best correlates with Lumen's crop `B`. Used when the global fit
 * leaves a visual misplaced by warping. It also absorbs a genuine position error inside the page, so callers
 * report the shift instead of hiding it. Returns { dx, dy, ncc, base }.
 */
export function contentOffset(ref, x, y, w, h, B, R) {
  const lb = lumaGrid(B)
  const nb = normalise(Float64Array.from(lb))
  if (!nb) return { dx: 0, dy: 0, ncc: 0, base: 0 }
  const L = lumaGrid(ref)
  const n = w * h
  const at = (dx, dy) => {
    const v = new Float64Array(n)
    for (let yy = 0; yy < h; yy++) {
      const sy = Math.min(ref.height - 1, Math.max(0, y + dy + yy))
      for (let xx = 0; xx < w; xx++) v[yy * w + xx] = L[sy * ref.width + Math.min(ref.width - 1, Math.max(0, x + dx + xx))]
    }
    const a = normalise(v)
    if (!a) return -1
    let d = 0
    for (let i = 0; i < n; i++) d += a[i] * nb[i]
    return d / n
  }
  const base = at(0, 0)
  let best = { dx: 0, dy: 0, ncc: base }
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dy) continue
      const c = at(dx, dy)
      if (c > best.ncc + 1e-9) best = { dx, dy, ncc: c }
    }
  return { ...best, base }
}

// ───────────────────────────── colour cast ─────────────────────────────

/**
 * Colour cast between a reference and Lumen, measured on large uniform areas only (flat in both images over a
 * window of ~`unitsWindow` page units: container / pane / header backgrounds, not bars or text). Returns the
 * anchors { ref: rgb, lumen: rgb, n } (clusters where both sides agree) and `cast`, the area-weighted mean ΔE
 * between them. A true Power BI export has cast ≈ 0–3 against a faithful render; a processed screenshot
 * (colour-managed, re-encoded, "enhanced") shows a large cast, which makes absolute colour scores unreliable.
 */
export function fitColourCast(A, B, s, unitsWindow = 40) {
  const r = Math.max(2, Math.round((unitsWindow * s) / 2))
  const flatAt = (im, x, y) => {
    let mn0 = 255, mn1 = 255, mn2 = 255, mx0 = 0, mx1 = 0, mx2 = 0
    for (let yy = y - r; yy <= y + r; yy += 1)
      for (let xx = x - r; xx <= x + r; xx += 1) {
        const i = (yy * im.width + xx) * 4
        const a = im.data[i], b = im.data[i + 1], c = im.data[i + 2]
        if (a < mn0) mn0 = a; if (a > mx0) mx0 = a
        if (b < mn1) mn1 = b; if (b > mx1) mx1 = b
        if (c < mn2) mn2 = c; if (c > mx2) mx2 = c
      }
    return mx0 - mn0 <= 8 && mx1 - mn1 <= 8 && mx2 - mn2 <= 8
  }
  const bins = new Map()
  const step = Math.max(1, Math.round(r / 2))
  for (let y = r; y < A.height - r; y += step)
    for (let x = r; x < A.width - r; x += step) {
      if (!flatAt(A, x, y) || !flatAt(B, x, y)) continue
      const i = (y * A.width + x) * 4
      const ra = [A.data[i], A.data[i + 1], A.data[i + 2]], lb = [B.data[i], B.data[i + 1], B.data[i + 2]]
      const k = ((ra[0] >> 3) << 10) | ((ra[1] >> 3) << 5) | (ra[2] >> 3)
      let e = bins.get(k)
      if (!e) bins.set(k, (e = { ref: [0, 0, 0], lumen: [], n: 0 }))
      e.n++
      for (let c = 0; c < 3; c++) e.ref[c] += ra[c]
      e.lumen.push(lb)
    }
  const anchors = []
  for (const e of bins.values()) {
    if (e.n < 3) continue
    const ref = e.ref.map((v) => v / e.n)
    const med = [0, 1, 2].map((c) => e.lumen.map((l) => l[c]).sort((a, b) => a - b)[Math.floor(e.lumen.length / 2)])
    const ml = rgbToLab(...med)
    const agree = e.lumen.filter((l) => deltaE(rgbToLab(...l), ml) < 8).length / e.lumen.length
    // where the two sides disagree (different data / layout under the same reference colour) there is no anchor
    if (agree < 0.6) continue
    anchors.push({ ref: ref.map(Math.round), lumen: med, n: e.n, refLab: rgbToLab(...ref.map(Math.round)), deltaE: deltaE(rgbToLab(...ref.map(Math.round)), ml) })
  }
  anchors.sort((a, b) => b.n - a.n)
  const tot = anchors.reduce((a, b) => a + b.n, 0)
  const cast = tot ? anchors.reduce((a, b) => a + b.deltaE * b.n, 0) / tot : 0
  // the largest single shift among well-supported anchors (a white page with one shifted header colour has a
  // small mean but a real cast)
  const maxShift = anchors.filter((a) => a.n >= Math.max(3, tot * 0.01)).reduce((m, a) => Math.max(m, a.deltaE), 0)
  return { anchors, cast: Math.round(cast * 100) / 100, maxShift: Math.round(maxShift * 100) / 100 }
}

/**
 * Move reference colours towards Lumen's using the anchors of fitColourCast: each colour takes the
 * (distance-weighted) offset of its nearest anchors, fading to none 30 ΔE away from every anchor, so colours
 * that appear only in content (series, icons) are left alone. Approximation: undoes a smooth cast, not an
 * arbitrary one; it also hides a page-wide background-colour error in Lumen (documented in docs/COMPARE.md).
 */
export function applyColourCast(img, anchors, radius = 30) {
  const out = createImage(img.width, img.height)
  const cache = new Map()
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]
    const key = (r << 16) | (g << 8) | b
    let v = cache.get(key)
    if (!v) {
      const L = rgbToLab(r, g, b)
      const near = anchors.map((a) => ({ a, d: deltaE(L, a.refLab) })).filter((x) => x.d < radius).sort((x, y) => x.d - y.d).slice(0, 3)
      if (!near.length) v = [r, g, b]
      else {
        let ws = 0
        const off = [0, 0, 0]
        for (const { a, d } of near) {
          const w = 1 / (d + 2) ** 2
          ws += w
          for (let c = 0; c < 3; c++) off[c] += w * (a.lumen[c] - a.ref[c])
        }
        const fade = Math.max(0, 1 - near[0].d / radius)
        v = [r, g, b].map((x, c) => Math.max(0, Math.min(255, Math.round(x + (off[c] / ws) * fade))))
      }
      if (cache.size < 300000) cache.set(key, v)
    }
    out.data[i] = v[0]; out.data[i + 1] = v[1]; out.data[i + 2] = v[2]; out.data[i + 3] = 255
  }
  return out
}

// ───────────────────────────── scores ─────────────────────────────

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100)

/** ΔE of every pixel of a region against one colour. */
function contrastMap(img, c, x0, y0, x1, y1, blurred = false) {
  const lab = blurred ? blurLab(img) : labOf(img)
  const L = rgbToLab(...c)
  const w = x1 - x0, h = y1 - y0
  const out = new Float32Array(Math.max(0, w * h))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = ((y0 + y) * img.width + x0 + x) * 3
      out[y * w + x] = Math.hypot(lab[p] - L[0], lab[p + 1] - L[1], lab[p + 2] - L[2])
    }
  return { map: out, w, h }
}

/**
 * Horizontal lines in a band: runs of rows where most of the width differs from the background. A thin line
 * is spread over 2–3 rows by antialiasing and downscaling, and a 1 px dark line then looks like a 2 px light
 * one, so the robust quantity is the line's **weight**: the summed row contrast (median ΔE of the row against
 * the background, over the line's rows) — thickness × contrast. `thickness` (weight / peak row contrast) is
 * an apparent thickness. Fills thicker than `maxThick` px are not lines (table headers, colour bands).
 */
export function findLines(img, bg, x0, y0, x1, y1, maxThick) {
  const { map, w, h } = contrastMap(img, bg, x0, y0, x1, y1)
  if (w <= 0 || h <= 0) return []
  const rowMed = new Float32Array(h)
  const rowFrac = new Float32Array(h)
  const rowEven = new Float32Array(h)
  const tmp = new Float32Array(w)
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) { tmp[x] = map[y * w + x]; if (tmp[x] > 3) n++ }
    rowFrac[y] = n / w
    tmp.sort()
    rowMed[y] = tmp[Math.floor(w * 0.5)]
    // evenness: share of the row within reach of its strong pixels — a rule is uniform, a row of text is not
    const p90 = tmp[Math.floor(w * 0.9)]
    let e = 0
    for (let x = 0; x < w; x++) if (tmp[x] > Math.max(3, p90 * 0.4)) e++
    rowEven[y] = e / w
  }
  const isCore = (y) => rowFrac[y] >= 0.5 && rowMed[y] > 3 && rowEven[y] >= 0.7
  const lines = []
  let y = 0
  while (y < h) {
    if (!isCore(y)) { y++; continue }
    let y2 = y
    while (y2 + 1 < h && isCore(y2 + 1)) y2++
    let peakRow = y
    for (let k = y; k <= y2; k++) if (rowMed[k] > rowMed[peakRow]) peakRow = k
    const peak = rowMed[peakRow]
    // antialiased fringe rows on either side
    let ya = y, yb = y2
    while (ya - 1 >= 0 && ya > y - 2 && rowMed[ya - 1] > 0.2 * peak && rowFrac[ya - 1] >= 0.3) ya--
    while (yb + 1 < h && yb < y2 + 2 && rowMed[yb + 1] > 0.2 * peak && rowFrac[yb + 1] >= 0.3) yb++
    // a run cut by the region's edge cannot be measured (it may be the top of a header fill)
    if (yb - ya + 1 <= maxThick && ya > 0 && yb < h - 1) {
      let weight = 0
      for (let k = ya; k <= yb; k++) weight += rowMed[k]
      const row = []
      for (let x = 0; x < w; x++) {
        const i = ((y0 + peakRow) * img.width + x0 + x) * 4
        row.push([img.data[i], img.data[i + 1], img.data[i + 2], map[peakRow * w + x]])
      }
      row.sort((p, q) => p[3] - q[3])
      const c = row[Math.floor(row.length / 2)]
      lines.push({ y: y0 + ya, rows: yb - ya + 1, weight, thickness: weight / peak, colour: [c[0], c[1], c[2]], contrast: peak })
    }
    y = Math.max(y2, yb) + 1
  }
  return lines
}

/**
 * The first text line of a band (the title, when the visual has one): rows from the first row with ink to
 * the first gap of ≥ 2 empty rows (or `maxRows`), line rows excluded. Ink is an adaptive threshold against
 * the band background. Returns its top row, height, ink density (ink pixels / (rows × width)) and a stroke
 * width estimate (the shorter of the mean horizontal and mean vertical ink run).
 */
export function firstTextLine(img, bg, x0, y0, x1, y1, skipRows = new Set(), maxRows = Infinity) {
  const { map, w, h } = contrastMap(img, bg, x0, y0, x1, y1)
  if (w <= 0 || h <= 0) return null
  const vals = []
  for (let y = 0; y < h; y++) if (!skipRows.has(y0 + y)) for (let x = 0; x < w; x++) if (map[y * w + x] > 8) vals.push(map[y * w + x])
  if (vals.length < 6) return null
  vals.sort((a, b) => a - b)
  const thr = Math.max(14, vals[Math.floor(vals.length * 0.95)] * 0.5)
  const rowInk = (y) => {
    if (skipRows.has(y0 + y)) return 0
    let n = 0
    for (let x = 0; x < w; x++) if (map[y * w + x] > thr) n++
    return n
  }
  let top = -1
  for (let y = 0; y < h; y++) if (rowInk(y) >= 2) { top = y; break }
  if (top < 0) return null
  let end = top, gap = 0
  for (let y = top + 1; y < h && y - top < maxRows; y++) {
    if (skipRows.has(y0 + y)) break
    if (rowInk(y) >= 1) { end = y; gap = 0 } else if (++gap >= 2) break
  }
  const rows = end - top + 1
  let ink = 0, hRuns = 0, hLen = 0, vRuns = 0, vLen = 0
  const on = (x, y) => map[y * w + x] > thr
  for (let y = top; y <= end; y++) {
    let run = 0
    for (let x = 0; x <= w; x++) {
      const o = x < w && on(x, y)
      if (o) { ink++; run++ } else if (run) { if (run <= rows) { hRuns++; hLen += run } run = 0 }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0
    for (let y = top; y <= end + 1; y++) {
      const o = y <= end && on(x, y)
      if (o) run++
      else if (run) { vRuns++; vLen += run; run = 0 }
    }
  }
  const stroke = hRuns >= 4 && vRuns >= 4 ? Math.min(hLen / hRuns, vLen / vRuns) : null
  return { top: y0 + top, rows, density: ink / (rows * w), ink, stroke, threshold: thr }
}

/** Bounding extent of content (pixels that differ from the background), as fractions of the region. */
export function occupiedExtent(img, bg, x0, y0, x1, y1) {
  const { map, w, h } = contrastMap(img, bg, x0, y0, x1, y1, true)
  if (w <= 0 || h <= 0) return null
  const col = new Uint32Array(w), row = new Uint32Array(h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (map[y * w + x] > 8) { col[x]++; row[y]++ }
  const cMin = Math.max(2, h * 0.02), rMin = Math.max(2, w * 0.02)
  let l = -1, r = -1, t = -1, b = -1
  for (let x = 0; x < w; x++) if (col[x] >= cMin) { if (l < 0) l = x; r = x }
  for (let y = 0; y < h; y++) if (row[y] >= rMin) { if (t < 0) t = y; b = y }
  if (l < 0 || t < 0) return { empty: true, left: null, right: null, top: null, bottom: null }
  return { empty: false, left: l / w, right: (r + 1) / w, top: t / h, bottom: (b + 1) / h }
}

/** Coarse occupancy grid of content (cells where > 3% of pixels differ from the background). */
export function occupancyGrid(img, bg, x0, y0, x1, y1, gx, gy) {
  const { map, w, h } = contrastMap(img, bg, x0, y0, x1, y1, true)
  const cells = new Float32Array(gx * gy)
  const area = new Float32Array(gx * gy)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = Math.min(gy - 1, Math.floor((y * gy) / h)) * gx + Math.min(gx - 1, Math.floor((x * gx) / w))
      area[c]++
      if (map[y * w + x] > 8) cells[c]++
    }
  for (let i = 0; i < cells.length; i++) cells[i] = area[i] ? cells[i] / area[i] : 0
  return cells
}

/** Dominant chromatic colours (series / fills): Lab chroma > 15, bins ≥ minShare of the region, merged within ΔE 10. */
export function palette(img, x0, y0, x1, y1, { minShare = 0.004, max = 8 } = {}) {
  const lab = labOf(img)
  const bins = new Map()
  let total = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      total++
      const p = y * img.width + x
      const a = lab[p * 3 + 1], b = lab[p * 3 + 2]
      if (Math.hypot(a, b) <= 15) continue
      const i = p * 4
      const k = ((img.data[i] >> 4) << 8) | ((img.data[i + 1] >> 4) << 4) | (img.data[i + 2] >> 4)
      const e = bins.get(k)
      if (e) { e.n++; e.r += img.data[i]; e.g += img.data[i + 1]; e.b += img.data[i + 2] }
      else bins.set(k, { n: 1, r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] })
    }
  const minN = Math.max(6, total * minShare)
  const list = [...bins.values()].filter((e) => e.n >= minN).sort((a, b) => b.n - a.n)
  const clusters = []
  for (const e of list) {
    const c = [e.r / e.n, e.g / e.n, e.b / e.n]
    const L = rgbToLab(...c.map(Math.round))
    const hit = clusters.find((k) => deltaE(k.lab, L) < 10)
    if (hit) hit.n += e.n
    else clusters.push({ rgb: c, lab: L, n: e.n })
  }
  clusters.sort((a, b) => b.n - a.n)
  return clusters.slice(0, max).map((c) => ({ hex: hex(c.rgb), lab: c.lab, share: c.n / Math.max(1, total) }))
}

/**
 * Hue-weighted colour distance: lightness and chroma differences count half, hue fully. Series colours
 * drawn by two renderers (antialiasing, colour management, compression) drift in lightness / chroma far more
 * than in hue, while "a different colour" is mostly a different hue.
 */
export function hueDistance(p, q) {
  const c1 = Math.hypot(p[1], p[2]), c2 = Math.hypot(q[1], q[2])
  const dh = Math.atan2(q[2], q[1]) - Math.atan2(p[2], p[1])
  const H = 2 * Math.sqrt(c1 * c2) * Math.sin(dh / 2)
  return Math.hypot((p[0] - q[0]) / 2, (c1 - c2) / 2, H)
}

function hueAngleDiff(p, q) {
  let d = Math.abs(Math.atan2(q[2], q[1]) - Math.atan2(p[2], p[1])) * (180 / Math.PI)
  return d > 180 ? 360 - d : d
}

/**
 * Compare two palettes (from `palette`). `distance`: symmetric share-weighted mean nearest hue-weighted
 * distance. `hueGap`: the largest hue-angle difference (degrees) between a clearly coloured (chroma ≥ 20,
 * share ≥ 1%) colour and its nearest counterpart. `unmatched`: such colours with no counterpart within 30.
 */
export function comparePalettes(pa, pb) {
  if (!pa.length && !pb.length) return { distance: 0, hueGap: 0, unmatched: [] }
  const chroma = (c) => Math.hypot(c.lab[1], c.lab[2])
  const one = (x, y) => {
    let s = 0, wt = 0
    for (const c of x) {
      const d = y.length ? Math.min(...y.map((o) => hueDistance(c.lab, o.lab))) : 40
      s += Math.min(d, 40) * c.share
      wt += c.share
    }
    return wt ? s / wt : 0
  }
  const distance = (one(pa, pb) + one(pb, pa)) / (pa.length && pb.length ? 2 : 1)
  let hueGap = 0
  const unmatched = []
  for (const [x, y, side] of [[pa, pb, 'ref'], [pb, pa, 'lumen']]) {
    for (const c of x) {
      if (c.share < 0.01 || chroma(c) < 20) continue
      const cands = y.filter((o) => chroma(o) >= 12)
      const near = cands.map((o) => ({ o, d: hueDistance(c.lab, o.lab) })).sort((a, b) => a.d - b.d)[0]
      if (!near || near.d > 30) unmatched.push({ side, hex: c.hex, share: Math.round(c.share * 1000) / 10 })
      else hueGap = Math.max(hueGap, hueAngleDiff(c.lab, near.o.lab))
    }
  }
  return { distance, hueGap, unmatched }
}

function blurLab(img) {
  if (img._blurLab) return img._blurLab
  const lab = labOf(img)
  const { width: w, height: h } = img
  const out = new Float32Array(lab.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0, a = 0, b = 0, c = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const p = (yy * w + xx) * 3
          a += lab[p]; b += lab[p + 1]; c += lab[p + 2]; n++
        }
      const p = (y * w + x) * 3
      out[p] = a / n; out[p + 1] = b / n; out[p + 2] = c / n
    }
  Object.defineProperty(img, "_blurLab", { value: out, enumerable: false })
  return out
}

/** Same-data only: share of pixels whose (3×3-blurred) colour differs by ΔE > 10, mean ΔE, and a heat map. */
export function pixelDiff(A, B) {
  const la = blurLab(A), lb = blurLab(B)
  const n = A.width * A.height
  let over = 0, sum = 0
  const heat = createImage(A.width, A.height)
  for (let p = 0; p < n; p++) {
    const d = Math.hypot(la[p * 3] - lb[p * 3], la[p * 3 + 1] - lb[p * 3 + 1], la[p * 3 + 2] - lb[p * 3 + 2])
    sum += d
    if (d > 10) over++
    const g = Math.round(255 - Math.min(1, d / 40) * 255)
    heat.data[p * 4] = 255; heat.data[p * 4 + 1] = g; heat.data[p * 4 + 2] = g
  }
  return { share: over / n, meanDE: sum / n, heat }
}

/**
 * Scores of one visual. A = reference crop, B = Lumen crop, same size; `s` = pixels per page unit.
 * Each entry: { value(s), severity 0..1, what } — `what` says what the number measures.
 */
export function scoreVisual(A, B, s, { sameData = false, weakColour = false } = {}) {
  // processed reference (colour cast): colour differences are weak evidence, halve their severity
  const cw = weakColour ? 0.5 : 1
  const w = A.width, h = A.height
  const ring = Math.max(1, Math.round(3 * s))
  const inner = [ring, ring, w - ring, h - ring]
  const scores = {}
  if (w < 6 || h < 6) return { scores, total: 0, reasons: [] }

  // 1. container: background (most common interior colour) and the outer border band, pixel by pixel
  const bgA = modeColour(A, ...inner), bgB = modeColour(B, ...inner)
  const labA = labOf(A), labB = labOf(B)
  let ringSum = 0, ringN = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue
      const p = (y * w + x) * 3
      ringSum += Math.hypot(labA[p] - labB[p], labA[p + 1] - labB[p + 1], labA[p + 2] - labB[p + 2])
      ringN++
    }
  const bgDE = deltaE(rgbToLab(...bgA), rgbToLab(...bgB))
  scores.background = { ref: hex(bgA), lumen: hex(bgB), deltaE: r2(bgDE), severity: r2(cw * clamp01((bgDE - 4) / 12)), what: 'ΔE (CIELAB) between the most common interior colour of each crop (the container background)' }
  const ringDE = ringN ? ringSum / ringN : 0
  scores.border = { meanDeltaE: r2(ringDE), widthUnits: 3, severity: r2(cw * clamp01((ringDE - 6) / 18)), what: 'mean per-pixel ΔE over the outer 3-unit band of the rectangle (border, shadow, rounded corners, background)' }

  // 2. series / fill colours
  const pa = palette(A, ...inner), pb = palette(B, ...inner)
  const pc = comparePalettes(pa, pb)
  const palSev = Math.max(clamp01((pc.hueGap - 12) / 25), pc.unmatched.length ? clamp01(0.4 + Math.max(...pc.unmatched.map((u) => u.share)) / 10) : 0)
  scores.palette = { ref: pa.map((c) => c.hex), lumen: pb.map((c) => c.hex), distance: r2(pc.distance), hueGap: r2(pc.hueGap), unmatched: pc.unmatched, severity: r2(cw * palSev), what: 'dominant saturated colours of each crop (series / fills; grey and text ignored). Severity from the largest hue difference (degrees) between a clearly coloured colour (≥ 1% of the crop) and its nearest counterpart, or such a colour with no counterpart; distance = share-weighted hue-weighted colour distance' }

  // 3. title band: weight of the first text line and the divider line under it
  let bandH = Math.min(Math.round(Math.min(48, (h / s) * 0.45) * s), h - ring)
  const band = [ring, ring, w - ring, ring + bandH]
  if (bandH <= 4 * s) bandH = 0
  else {
    const tbA = modeColour(A, ...band), tbB = modeColour(B, ...band)
    const maxThick = Math.max(3, Math.round(10 * s)) // blurred references spread a 1 px line over 4–5 rows
    // look a little below the band so a fill that starts inside it is seen whole (and rejected as too thick)
    const ext = [band[0], band[1], band[2], Math.min(h - ring, band[3] + maxThick + 2)]
    const inBand = (l) => l.y < band[3]
    const linesA = findLines(A, tbA, ...ext, maxThick).filter(inBand), linesB = findLines(B, tbB, ...ext, maxThick).filter(inBand)
    const skip = (lines) => new Set(lines.flatMap((l) => Array.from({ length: l.rows }, (_, k) => l.y + k)))
    const tA = firstTextLine(A, tbA, ...band, skip(linesA), Math.round(30 * s)), tB = firstTextLine(B, tbB, ...band, skip(linesB), Math.round(30 * s))
    if (tA || tB) {
      const dA = tA?.density ?? 0, dB = tB?.density ?? 0
      const ratio = (dB + 0.005) / (dA + 0.005)
      const dTop = tA && tB ? (tB.top - tA.top) / s : null
      const sev = !tA || !tB ? 0.6 : Math.max(clamp01((Math.abs(Math.log(ratio)) - 0.25) / 0.5), clamp01((Math.abs(dTop) - 5) / 10))
      scores.titleInk = { ref: tA ? r2(dA * 100) : null, lumen: tB ? r2(dB * 100) : null, ratio: r2(ratio), topRef: tA ? r2((tA.top - ring) / s) : null, topLumen: tB ? r2((tB.top - ring) / s) : null, topDelta: r2(dTop), severity: r2(sev), what: 'first text line at the top of the visual (the title when there is one): % of its rows covered by ink (ratio Lumen / reference: > 1 = heavier or larger text) and its top in page units (delta = Lumen − reference)' }
      if (tA?.stroke && tB?.stroke) {
        const sr = tB.stroke / tA.stroke
        scores.titleStroke = { ref: r2(tA.stroke / s), lumen: r2(tB.stroke / s), ratio: r2(sr), severity: r2(clamp01((Math.abs(Math.log(sr)) - 0.3) / 0.35)), what: 'stroke width of that first text line in page units (shorter of mean horizontal / vertical ink run); ratio Lumen / reference (> 1 = bolder). Needs ≥ ~1.5 px strokes to be meaningful' }
      }
    }
    const main = (ls) => ls.slice().sort((a, b) => b.weight - a.weight)[0]
    const la = main(linesA), lb = main(linesB)
    if (la || lb) {
      // on one side only: as severe as the line is heavy (a faint hairline may simply be lost in the image)
      let sev = clamp01(((la ?? lb).weight / s) / 60)
      const v = { ref: la ? { weight: r2(la.weight / s), thickness: r2(la.thickness / s), colour: hex(la.colour), y: r2((la.y - ring) / s) } : null, lumen: lb ? { weight: r2(lb.weight / s), thickness: r2(lb.thickness / s), colour: hex(lb.colour), y: r2((lb.y - ring) / s) } : null }
      if (la && lb) {
        const wr = lb.weight / la.weight
        const dc = deltaE(rgbToLab(...la.colour), rgbToLab(...lb.colour))
        const dy = Math.abs(lb.y - la.y) / s
        v.weightRatio = r2(wr)
        v.colourDeltaE = r2(dc)
        v.lightnessDelta = r2(rgbToLab(...lb.colour)[0] - rgbToLab(...la.colour)[0])
        const dt = Math.abs(lb.thickness - la.thickness) / s
        v.thicknessDelta = r2((lb.thickness - la.thickness) / s)
        // apparent thickness does not depend on contrast; weight and colour do (and so suffer from a
        // processed reference: they count half then)
        sev = Math.max(clamp01((dt - 0.6) / 1.5), cw * clamp01((Math.abs(Math.log(wr)) - 0.3) / 0.7), cw * clamp01((dc - 12) / 25), clamp01((dy - 5) / 10))
      }
      scores.titleLine = { ...v, severity: r2(sev), what: 'full-width horizontal line near the top (title divider): apparent thickness in units (weight / peak contrast; robust to colour shifts, not to blur), weight = thickness × contrast in ΔE·units (ratio Lumen / reference > 1 = heavier or darker), colour and position; present on one side only = severity by its weight (60 ΔE·units = 1)' }
    }
  }

  // 3b. bottom row: the last text line (a pinned total row is bold and sits under a rule) and lines near it
  const bandB = Math.round(Math.min(40, (h / s) * 0.3) * s)
  if (h / s >= 100 && bandB > 6 * s) {
    const bb = [ring, h - ring - bandB, w - ring, h - ring]
    const fA = flipV(A), fB = flipV(B)
    const fb = [ring, ring, w - ring, ring + bandB]
    const bgbA = modeColour(A, ...bb), bgbB = modeColour(B, ...bb)
    const maxThick = Math.max(3, Math.round(10 * s))
    // rules (and gridlines / axis lines) are not text: skip their rows when looking for the last text line
    const linesFA = findLines(fA, bgbA, ...fb, maxThick), linesFB = findLines(fB, bgbB, ...fb, maxThick)
    const skipF = (ls) => new Set(ls.flatMap((l) => Array.from({ length: l.rows + 2 }, (_, k) => l.y - 1 + k)))
    const lA = firstTextLine(fA, bgbA, ...fb, skipF(linesFA), Math.round(24 * s)), lB = firstTextLine(fB, bgbB, ...fb, skipF(linesFB), Math.round(24 * s))
    const heavy = (ls) => ls.filter((l) => l.weight / s > 20).sort((a, b) => b.weight - a.weight)[0]
    const rA = heavy(linesFA), rB = heavy(linesFB)
    if (lA && lB) {
      const sr = lA.stroke && lB.stroke ? lB.stroke / lA.stroke : 1
      const ir = (lB.density + 0.005) / (lA.density + 0.005)
      // ink depends on the values shown, so only stroke weight and the presence of a rule count
      // a rule on one side only: the other side has no line of even half that weight
      const lone = (r, other) => r && !other.some((l) => l.weight > r.weight * 0.35)
      const sev = Math.max(clamp01((Math.abs(Math.log(sr)) - 0.3) / 0.35), lone(rA, linesFB) || lone(rB, linesFA) ? 0.5 : 0)
      scores.bottomRow = { ref: { ink: r2(lA.density * 100), stroke: lA.stroke ? r2(lA.stroke / s) : null, rule: rA ? r2(rA.weight / s) : null }, lumen: { ink: r2(lB.density * 100), stroke: lB.stroke ? r2(lB.stroke / s) : null, rule: rB ? r2(rB.weight / s) : null }, strokeRatio: r2(sr), inkRatio: r2(ir), severity: r2(sev), what: 'last text line at the bottom of the visual (a pinned total row is bold) — ink % and stroke width, ratio Lumen / reference (ink is shown but not scored: it depends on the values) — and whether a horizontal rule (weight > 20 ΔE·units) sits in the bottom band; a rule on one side only = 0.5' }
    }
  }

  // 4. occupied extent: does the content reach the same edges (below the title band when the visual is tall
  // enough, so a title or divider does not decide the right edge)
  const bodyTop = h / s >= 120 && bandH ? ring + bandH : ring
  const body = [ring, bodyTop, w - ring, h - ring]
  const exA = occupiedExtent(A, bgA, ...body), exB = occupiedExtent(B, bgB, ...body)
  if (exA && exB) {
    if (exA.empty || exB.empty) {
      scores.extent = { ref: exA.empty ? 'empty' : 'content', lumen: exB.empty ? 'empty' : 'content', severity: exA.empty === exB.empty ? 0 : 1, what: 'whether the crop has any content that differs from its background' }
    } else {
      const d = { left: exB.left - exA.left, right: exB.right - exA.right, top: exB.top - exA.top, bottom: exB.bottom - exA.bottom }
      const worst = Math.max(...Object.values(d).map(Math.abs))
      scores.extent = { ref: { right: r2(exA.right), bottom: r2(exA.bottom), left: r2(exA.left), top: r2(exA.top) }, lumen: { right: r2(exB.right), bottom: r2(exB.bottom), left: r2(exB.left), top: r2(exB.top) }, delta: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, r2(v)])), severity: r2(clamp01((worst - 0.025) / 0.1)), what: 'bounding box of content (pixels whose 3×3-blurred colour differs from the background by ΔE > 8; below the title band for visuals ≥ 120 units tall) as a fraction of that area; delta = Lumen − reference (negative right = content stops short)' }
    }
  }

  // 5. layout: where content sits on a coarse grid (data differences move little; a moved icon or label does)
  const gx = Math.max(2, Math.min(16, Math.round(w / s / 24))), gy = Math.max(2, Math.min(16, Math.round(h / s / 24)))
  const ga = occupancyGrid(A, bgA, ...inner, gx, gy), gb = occupancyGrid(B, bgB, ...inner, gx, gy)
  let diff = 0, union = 0
  for (let i = 0; i < ga.length; i++) {
    const a = ga[i] > 0.03, b = gb[i] > 0.03
    if (a || b) union++
    if (a !== b) diff++
  }
  const lay = union ? diff / union : 0
  scores.layout = { mismatch: r2(lay), grid: `${gx}x${gy}`, severity: r2(clamp01((lay - 0.12) / 0.3)), what: 'share of occupied cells (coarse ~24-unit grid; a cell is occupied when > 3% of its blurred pixels differ from the background) that are occupied on one side only; catches moved icons / labels / legends, also raised by very different data' }

  if (sameData) {
    const pdiff = pixelDiff(A, B)
    scores.pixels = { share: r2(pdiff.share * 100), meanDeltaE: r2(pdiff.meanDE), severity: r2(clamp01((pdiff.share - 0.02) / 0.15)), what: '% of pixels whose 3×3-blurred colour differs by ΔE > 10 (only meaningful when both show the same data)' }
  }

  const weights = { background: 1, border: 0.6, palette: 1, titleInk: 0.8, titleStroke: 0.8, titleLine: 0.8, bottomRow: 0.6, extent: 1, layout: 0.8, pixels: 1.5 }
  let total = 0
  const reasons = []
  for (const [k, v] of Object.entries(scores)) {
    const sev = v.severity ?? 0
    total += sev * (weights[k] ?? 1)
    if (sev >= 0.3) reasons.push(k)
  }
  reasons.sort((a, b) => scores[b].severity * (weights[b] ?? 1) - scores[a].severity * (weights[a] ?? 1))
  return { scores, total: r2(total), reasons }
}

/** Correlation of the template with one given rectangle of the reference (diagnostics, tests). */
export function canvasCorrelation(ref, template, rect, gw = 64) {
  const gh = Math.max(6, Math.round(gw / (rect.w / rect.h)))
  const T = normalise(lumaGrid(resample(template, { x: 0, y: 0, w: template.width, h: template.height }, gw, gh)))
  const A = normalise(lumaGrid(resample(ref, rect, gw, gh)))
  if (!T || !A) return 0
  let d = 0
  for (let i = 0; i < T.length; i++) d += T[i] * A[i]
  return d / T.length
}

// Unit tests for scripts/compare-lib.mjs with synthetic images only (rectangles, lines and blocks of known
// sizes and colours). Run: npx vitest run scripts
import { describe, it, expect } from 'vitest'
import {
  createImage, fillRect, strokeRect, crop, resample, decodePng, encodePng, flipV,
  findCanvas, refineCanvasByRects, edgeMaps, localOffset,
  findLines, firstTextLine, occupiedExtent, palette, comparePalettes, fitColourCast, applyColourCast,
  scoreVisual, rgbToLab, deltaE
} from './compare-lib.mjs'

const WHITE = [255, 255, 255]
const NAVY = [23, 28, 115]
const GOLD = [242, 187, 21]
const PAGE_BG = [243, 244, 246]

/** Paste `src` into `dst` at (x, y). */
function paste(dst, src, x, y) {
  for (let r = 0; r < src.height; r++) dst.data.set(src.data.subarray(r * src.width * 4, (r + 1) * src.width * 4), ((y + r) * dst.width + x) * 4)
  return dst
}

/** An invented 640 × 360 page: header band, left rail, bordered cards and two charts with bars. */
const PAGE_W = 640, PAGE_H = 360
const RECTS = [
  { x: 0, y: 0, w: 640, h: 30 },
  { x: 0, y: 30, w: 100, h: 330 },
  { x: 110, y: 40, w: 160, h: 70 },
  { x: 280, y: 40, w: 160, h: 70 },
  { x: 450, y: 40, w: 180, h: 70 },
  { x: 110, y: 120, w: 330, h: 230 },
  { x: 450, y: 120, w: 180, h: 230 }
]
function drawPage(k, bars, shade = 0) {
  const im = createImage(Math.round(PAGE_W * k), Math.round(PAGE_H * k), [...PAGE_BG, 255])
  fillRect(im, 0, 0, PAGE_W * k, 30 * k, [NAVY[0] + shade, NAVY[1] + shade, NAVY[2], 255])
  fillRect(im, 0, 30 * k, 100 * k, 330 * k, [230, 230, 232, 255])
  for (const r of RECTS.slice(2)) {
    fillRect(im, r.x * k, r.y * k, r.w * k, r.h * k, [255, 255, 255, 255])
    strokeRect(im, r.x * k, r.y * k, r.w * k, r.h * k, [190, 190, 190, 255])
  }
  // bars in the big chart (heights differ between "reference" and "lumen": different data)
  bars.forEach((b, i) => fillRect(im, (130 + i * 30) * k, (340 - b) * k, 18 * k, b * k, [...NAVY, 255]))
  return im
}

describe('PNG codec', () => {
  it('round-trips RGBA pixels', () => {
    const im = createImage(7, 5, [10, 20, 30, 255])
    fillRect(im, 2, 1, 3, 2, [200, 100, 50, 255])
    const back = decodePng(encodePng(im))
    expect(back.width).toBe(7)
    expect(back.height).toBe(5)
    expect(Array.from(back.data)).toEqual(Array.from(im.data))
  })
  it('rejects non-PNG input', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/not a PNG/)
  })
})

describe('geometry', () => {
  it('resample averages areas when downscaling', () => {
    const im = createImage(4, 4, [0, 0, 0, 255])
    fillRect(im, 0, 0, 2, 4, [200, 200, 200, 255])
    const r = resample(im, { x: 0, y: 0, w: 4, h: 4 }, 1, 1)
    expect(r.data[0]).toBe(100)
  })
  it('crop fills outside the source with white and flipV mirrors rows', () => {
    const im = createImage(2, 2, [0, 0, 0, 255])
    const c = crop(im, 1, 1, 2, 2)
    expect(Array.from(c.data.slice(0, 4))).toEqual([0, 0, 0, 255])
    expect(Array.from(c.data.slice(12, 16))).toEqual([255, 255, 255, 255])
    const f = createImage(1, 2, [0, 0, 0, 255])
    fillRect(f, 0, 0, 1, 1, [9, 9, 9, 255])
    expect(flipV(f).data[4]).toBe(9)
  })
})

describe('alignment', () => {
  it('finds a canvas-only reference at a different scale', () => {
    const lumen = drawPage(1.5, [100, 140, 80, 160, 120, 60, 90, 150, 110])
    const ref = drawPage(1, [60, 100, 150, 90, 70, 130, 160, 40, 100])
    const g = findCanvas(ref, lumen, PAGE_W / PAGE_H)
    const f = refineCanvasByRects(ref, RECTS, PAGE_W, PAGE_H, g)
    expect(Math.abs(f.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(f.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(f.w - 640)).toBeLessThanOrEqual(2)
  })
  it('finds the page inside window chrome (ribbon, panes) at another scale', () => {
    const lumen = drawPage(1.5, [100, 140, 80, 160, 120, 60, 90, 150, 110])
    const shot = createImage(1100, 820, [200, 200, 200, 255])
    fillRect(shot, 0, 0, 1100, 110, [40, 40, 40, 255]) // ribbon
    fillRect(shot, 980, 110, 120, 710, [250, 250, 250, 255]) // pane
    paste(shot, drawPage(1.4, [60, 100, 150, 90, 70, 130, 160, 40, 100]), 70, 160)
    const g = findCanvas(shot, lumen, PAGE_W / PAGE_H)
    const f = refineCanvasByRects(shot, RECTS, PAGE_W, PAGE_H, g)
    expect(Math.abs(f.x - 70)).toBeLessThanOrEqual(2)
    expect(Math.abs(f.y - 160)).toBeLessThanOrEqual(2)
    expect(Math.abs(f.w - 896)).toBeLessThanOrEqual(3)
  })
  it('localOffset moves a bordered visual onto its border', () => {
    const im = createImage(300, 200, [...PAGE_BG, 255])
    const r = { x: 50, y: 40, w: 120, h: 80 }
    fillRect(im, r.x + 3, r.y - 2, r.w, r.h, [255, 255, 255, 255]) // drawn 3 px right, 2 px up
    strokeRect(im, r.x + 3, r.y - 2, r.w, r.h, [150, 150, 150, 255])
    const lo = localOffset(edgeMaps(im, 1, 3.5), r, 300, 200, 1, 6)
    expect([lo.dx, lo.dy]).toEqual([3, -2])
    expect(lo.score).toBeGreaterThan(lo.base)
  })
})

describe('lines', () => {
  const lineImg = (t, c) => {
    const im = createImage(200, 40, [255, 255, 255, 255])
    fillRect(im, 10, 20, 180, t, [...c, 255])
    return im
  }
  it('measures thickness and colour of a full-width line', () => {
    const [l2] = findLines(lineImg(2, GOLD), WHITE, 0, 0, 200, 40, 8)
    const [l4] = findLines(lineImg(4, GOLD), WHITE, 0, 0, 200, 40, 8)
    expect(l2.thickness).toBeCloseTo(2, 0)
    expect(l4.thickness).toBeCloseTo(4, 0)
    expect(l4.weight / l2.weight).toBeCloseTo(2, 1)
    expect(deltaE(rgbToLab(...l2.colour), rgbToLab(...GOLD))).toBeLessThan(2)
  })
  it('a lighter line has less weight at the same thickness', () => {
    const [dark] = findLines(lineImg(2, [120, 100, 40]), WHITE, 0, 0, 200, 40, 8)
    const [light] = findLines(lineImg(2, [230, 220, 180]), WHITE, 0, 0, 200, 40, 8)
    expect(light.thickness).toBeCloseTo(dark.thickness, 0)
    expect(light.weight).toBeLessThan(dark.weight / 2)
  })
  it('ignores fills thicker than maxThick and runs cut by the region', () => {
    expect(findLines(lineImg(12, NAVY), WHITE, 0, 0, 200, 40, 8)).toEqual([])
    expect(findLines(lineImg(4, NAVY), WHITE, 0, 0, 200, 22, 8)).toEqual([])
  })
})

describe('text weight', () => {
  /** A fake text line: vertical strokes of width `sw`, 10 px tall. */
  const textImg = (sw) => {
    const im = createImage(200, 40, [255, 255, 255, 255])
    for (let x = 10; x < 180; x += 8) fillRect(im, x, 12, sw, 10, [30, 30, 30, 255])
    return im
  }
  it('stroke width and ink density follow the stroke weight', () => {
    const thin = firstTextLine(textImg(1), WHITE, 0, 0, 200, 40)
    const bold = firstTextLine(textImg(3), WHITE, 0, 0, 200, 40)
    expect(thin.top).toBe(12)
    expect(thin.rows).toBe(10)
    expect(thin.stroke).toBeCloseTo(1, 0)
    expect(bold.stroke).toBeCloseTo(3, 0)
    expect(bold.density / thin.density).toBeCloseTo(3, 0)
  })
})

describe('extent and palette', () => {
  it('occupiedExtent sees content that stops short', () => {
    const full = createImage(100, 50, [255, 255, 255, 255])
    fillRect(full, 0, 10, 100, 30, [...NAVY, 255])
    const short = createImage(100, 50, [255, 255, 255, 255])
    fillRect(short, 0, 10, 60, 30, [...NAVY, 255])
    expect(occupiedExtent(full, WHITE, 0, 0, 100, 50).right).toBe(1)
    expect(occupiedExtent(short, WHITE, 0, 0, 100, 50).right).toBeCloseTo(0.6, 1)
  })
  const bars = (c1, c2) => {
    const im = createImage(120, 60, [255, 255, 255, 255])
    fillRect(im, 10, 10, 40, 40, [...c1, 255])
    fillRect(im, 70, 10, 40, 40, [...c2, 255])
    return im
  }
  it('a different series hue is flagged, a lightness drift is not', () => {
    const ref = palette(bars([132, 166, 203], NAVY), 0, 0, 120, 60) // light blue + navy
    const lavender = palette(bars([162, 164, 199], NAVY), 0, 0, 120, 60)
    const lighter = palette(bars([150, 184, 220], NAVY), 0, 0, 120, 60)
    expect(comparePalettes(ref, lavender).hueGap).toBeGreaterThan(20)
    expect(comparePalettes(ref, lighter).hueGap).toBeLessThan(8)
  })
  it('a colour present on one side only is unmatched', () => {
    const a = palette(bars(GOLD, NAVY), 0, 0, 120, 60)
    const b = palette(bars([255, 255, 255], NAVY), 0, 0, 120, 60)
    expect(comparePalettes(a, b).unmatched.map((u) => u.side)).toEqual(['ref'])
  })
})

describe('colour cast', () => {
  it('detects a shift of large uniform areas and corrects it, leaving small content colours alone', () => {
    const lumen = drawPage(1, [100, 140, 80, 160, 120, 60, 90, 150, 110])
    const ref = drawPage(1, [100, 140, 80, 160, 120, 60, 90, 150, 110])
    // the reference's left rail is a shifted grey (processing), a small orange mark is genuine content
    fillRect(ref, 0, 30, 100, 330, [215, 205, 185, 255])
    fillRect(ref, 300, 200, 6, 6, [230, 120, 40, 255])
    const c = fitColourCast(ref, lumen, 1)
    expect(c.maxShift).toBeGreaterThan(10)
    const fixed = applyColourCast(ref, c.anchors)
    const px = (im, x, y) => Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 3))
    expect(deltaE(rgbToLab(...px(fixed, 50, 200)), rgbToLab(...px(lumen, 50, 200)))).toBeLessThan(4)
    expect(px(fixed, 302, 202)).toEqual([230, 120, 40])
  })
  it('reports no cast for identical colours', () => {
    const a = drawPage(1, [100, 140, 80, 160, 120, 60, 90, 150, 110])
    expect(fitColourCast(a, a, 1).maxShift).toBe(0)
  })
})

describe('scoreVisual', () => {
  /** An invented chart visual: white container, title strokes, divider, bars, optional icon. */
  const visual = ({ titleStroke = 1, divider = 1, dividerColour = GOLD, icon = 'right', barsTo = 280 } = {}) => {
    const im = createImage(300, 160, [255, 255, 255, 255])
    strokeRect(im, 0, 0, 300, 160, [200, 200, 200, 255])
    for (let x = 12; x < 150; x += 7) fillRect(im, x, 10, titleStroke, 12, [40, 40, 40, 255])
    fillRect(im, 8, 30, 284, divider, [...dividerColour, 255])
    if (icon === 'none') void 0
    else if (icon === 'right') fillRect(im, 240, 36, 44, 40, [70, 130, 200, 255])
    else fillRect(im, 12, 36, 44, 40, [70, 130, 200, 255])
    for (let x = 20; x < barsTo; x += 30) fillRect(im, x, 80, 18, 70, [...NAVY, 255])
    return im
  }
  it('identical crops score ~0', () => {
    const a = visual()
    const r = scoreVisual(a, visual(), 1)
    expect(r.total).toBeLessThan(0.1)
    expect(r.reasons).toEqual([])
  })
  it('flags a bolder title', () => {
    const r = scoreVisual(visual(), visual({ titleStroke: 3 }), 1)
    expect(r.scores.titleStroke.ratio).toBeGreaterThan(1.5)
    expect(r.reasons).toContain('titleStroke')
  })
  it('flags a thicker divider (thickness and weight)', () => {
    const r = scoreVisual(visual(), visual({ divider: 3 }), 1)
    expect(r.scores.titleLine.thicknessDelta).toBeCloseTo(2, 0)
    expect(r.reasons).toContain('titleLine')
  })
  it('flags content that stops short', () => {
    const r = scoreVisual(visual({ icon: 'none' }), visual({ icon: 'none', barsTo: 150 }), 1)
    expect(r.scores.extent.delta.right).toBeLessThan(-0.3)
    expect(r.reasons).toContain('extent')
  })
  it('flags an icon in the wrong place', () => {
    // a card-like visual: title, icon and little else
    const r = scoreVisual(visual({ barsTo: 0 }), visual({ icon: 'left', barsTo: 0 }), 1)
    expect(r.reasons).toContain('layout')
  })
  it('halves colour severities for a processed reference', () => {
    const a = visual()
    const b = createImage(a.width, a.height)
    b.data.set(a.data)
    fillRect(b, 1, 1, 298, 158, [250, 235, 200, 255])
    const strong = scoreVisual(a, b, 1).scores.background.severity
    const weak = scoreVisual(a, b, 1, { weakColour: true }).scores.background.severity
    expect(weak).toBeCloseTo(strong / 2, 1)
  })
  it('same-data mode adds a pixel difference', () => {
    const r = scoreVisual(visual(), visual({ barsTo: 150 }), 1, { sameData: true })
    expect(r.scores.pixels.share).toBeGreaterThan(5)
  })
})

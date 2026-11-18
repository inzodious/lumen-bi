#!/usr/bin/env node
// Compare a Power BI reference (screenshot or Export-to-PDF) with Lumen's render of the same report pages.
// Run through scripts/compare.sh; see docs/COMPARE.md for what each score measures and how far to trust it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, isPng, isJpeg, resample, crop, sideBySide, strokeRect, findCanvas, refineCanvasByRects, edgeMaps, localOffset, contentOffset, fitColourCast, applyColourCast, hex, scoreVisual, pixelDiff } from './compare-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = `usage: scripts/compare.sh <reference.png|.jpg|.pdf> <report> <outdir> [options]
  <reference>        a screenshot of one report page (with or without Power BI's window chrome) or a PDF from
                     Power BI's File > Export > Export to PDF (one PDF page per visible report page)
  <report>           .pbix / .pbit / .pbip / .wbi file or *.Report folder (rendered with scripts/sweep.sh)
  <outdir>           review folder: index.html, compare.json, summary.tsv, pages/, visuals/, lumen/
  --page <p>         screenshot (or single-page PDF): which report page it shows (name, display name or
                     1-based index; default: the first page, or the only one in --pages)
  --pages a,b        only compare these report pages (passed to the sweep)
  --sample-data      fill tables without data with synthetic rows (sweep option)
  --private          with --sample-data: never copy names / ids from the definitions into the data
  --same-data        the reference shows the same data as Lumen (e.g. Microsoft's sample .pbix files):
                     also score a perceptual pixel difference per visual
  --crop x,y,w,h     page rectangle inside the reference (reference pixels; skips detection). For a PDF it
                     applies to every page
  --lumen <dir>      reuse an existing sweep output folder (the one holding report.json) instead of rendering
  --size WxH         sweep window size (default 1800x1200)
  --dpi <n>          PDF rasterisation resolution (default 144)
  --calibrate-colours / --no-calibrate
                     force / prevent correcting a colour cast of the reference (measured on large uniform
                     areas) before scoring. Default: corrected when a cast is detected (processed screenshot);
                     note that it also hides a page-wide background colour error in Lumen
  --no-local         do not align each visual's reference crop locally. By default a shift of up to 8 units
                     is taken when it clearly lines the visual's visible container border up better, else up to
                     12 units when the content correlates clearly better (borderless visuals); the shift is
                     reported (offset in compare.json, a "position" score) because it can be a real error
  --titles           include visual titles in compare.json / index.html (off: ids are type + index only)
  --no-build         passed to the sweep`

function parseArgs(argv) {
  const o = { pos: [], calibrate: undefined, sampleData: false, private: false, sameData: false, titles: false, noBuild: false, dpi: 144 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '--page') o.page = val()
    else if (a === '--pages') o.pages = val()
    else if (a === '--sample-data') o.sampleData = true
    else if (a === '--private') o.private = true
    else if (a === '--same-data') o.sameData = true
    else if (a === '--titles') o.titles = true
    else if (a === '--calibrate-colours' || a === '--calibrate-colors') o.calibrate = true
    else if (a === '--no-calibrate') o.calibrate = false
    else if (a === '--no-local') o.noLocal = true
    else if (a === '--no-build') o.noBuild = true
    else if (a === '--crop') {
      const v = val().split(',').map(Number)
      if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || v[2] <= 0 || v[3] <= 0) fail('--crop wants x,y,w,h in reference pixels')
      o.crop = { x: v[0], y: v[1], w: v[2], h: v[3] }
    } else if (a === '--lumen') o.lumen = resolve(val())
    else if (a === '--size') o.size = val()
    else if (a === '--dpi') o.dpi = Number(val())
    else if (a === '-h' || a === '--help') {
      console.log(USAGE)
      process.exit(0)
    } else if (a.startsWith('--')) fail(`unknown option ${a}`)
    else o.pos.push(a)
  }
  if (o.pos.length !== 3) fail(USAGE)
  return o
}

function fail(msg) {
  console.error(msg)
  process.exit(2)
}

function electron(args) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).stdout.trim()
  const bin = join(ROOT, 'node_modules/.bin/electron')
  const cmd = xvfb && !env.WBI_USE_DESKTOP ? [xvfb, '-a', bin, ...args] : [bin, ...args]
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`electron ${args[1]} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`)
}

/** Decode a reference image: PNG directly, anything else (JPEG, WebP…) through Electron's decoder. */
function loadImage(path, tmpDir) {
  const buf = readFileSync(path)
  if (isPng(buf)) return decodePng(buf)
  mkdirSync(tmpDir, { recursive: true })
  const out = join(tmpDir, basename(path, extname(path)) + '.decoded.png')
  try {
    electron([join(ROOT, 'scripts/compare-electron.mjs'), 'decode', path, out])
  } catch (e) {
    throw new Error(`${isJpeg(buf) ? 'JPEG' : 'image'} decode needs Electron (${e.message}); convert the reference to PNG instead`)
  }
  return decodePng(readFileSync(out))
}

/** Rasterise every PDF page with pdftoppm → [{ file, image }]. */
function rasterisePdf(pdf, dir, dpi) {
  const which = spawnSync('sh', ['-c', 'command -v pdftoppm'], { encoding: 'utf8' }).stdout.trim()
  if (!which) fail('pdftoppm not found: install poppler-utils (Debian/Ubuntu: sudo apt install poppler-utils) to compare against a PDF, or pass a PNG screenshot')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const r = spawnSync(which, ['-r', String(dpi), '-png', pdf, join(dir, 'ref')], { encoding: 'utf8' })
  if (r.status !== 0) fail(`pdftoppm failed: ${r.stderr.trim()}`)
  return readdirSync(dir)
    .filter((f) => /^ref-\d+\.png$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((f) => ({ file: join(dir, f), image: decodePng(readFileSync(join(dir, f))) }))
}

function render(o, report, out) {
  const dir = join(out, 'lumen')
  const args = [report, dir]
  if (o.sampleData) args.push('--sample-data')
  if (o.private) args.push('--private')
  if (o.pages) args.push('--pages', o.pages)
  if (o.size) args.push('--size', o.size)
  if (o.noBuild) args.push('--no-build')
  console.log(`rendering with scripts/sweep.sh …`)
  const r = spawnSync(join(ROOT, 'scripts/sweep.sh'), args, { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) fail('sweep failed')
  return dir
}

function findSweep(dir) {
  if (existsSync(join(dir, 'report.json'))) return dir
  const subs = readdirSync(dir).filter((n) => existsSync(join(dir, n, 'report.json')))
  if (subs.length !== 1) fail(`expected one report.json under ${dir}, found ${subs.length}`)
  return join(dir, subs[0])
}

function matchPage(pages, key, allIndex) {
  const k = String(key).trim().toLowerCase()
  return pages.find((p) => p.name.toLowerCase() === k || p.displayName.toLowerCase() === k || String(allIndex(p)) === k)
}

/** Visual types whose drawing is mostly data (content alignment would chase the values). */
const DATA_HEAVY = /table|pivot|matrix|chart|map|scatter|line|area|bar|column|pie|donut|funnel|treemap|waterfall|ribbon|decomposition|html|deneb|python|script/i

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function where(rect, page) {
  const cx = (rect.x + rect.w / 2) / page.width, cy = (rect.y + rect.h / 2) / page.height
  const v = cy < 1 / 3 ? 'top' : cy < 2 / 3 ? 'middle' : 'bottom'
  const h = cx < 1 / 3 ? 'left' : cx < 2 / 3 ? 'centre' : 'right'
  return `${v}-${h}`
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  const [refPath, reportPath, outArg] = o.pos.map((p) => resolve(p))
  const out = resolve(outArg)
  if (!existsSync(refPath)) fail(`reference not found: ${refPath}`)
  if (!existsSync(reportPath)) fail(`report not found: ${reportPath}`)
  mkdirSync(out, { recursive: true })
  const isPdf = extname(refPath).toLowerCase() === '.pdf'
  if (isPdf) {
    const which = spawnSync('sh', ['-c', 'command -v pdftoppm'], { encoding: 'utf8' }).stdout.trim()
    if (!which) fail('pdftoppm not found: install poppler-utils (Debian/Ubuntu: sudo apt install poppler-utils) to compare against a PDF, or pass a PNG screenshot')
  }

  // 1. Lumen render
  const sweepDir = findSweep(o.lumen ?? render(o, reportPath, out))
  const rep = JSON.parse(readFileSync(join(sweepDir, 'report.json'), 'utf8'))
  if (!rep.pages?.length) fail(`the sweep rendered no page (${rep.error ?? 'see console.log in ' + sweepDir})`)
  const pngIndex = (p) => Number(p.png?.match(/^(\d+)-/)?.[1] ?? 0) // 1-based index among all pages

  // 2. reference pages ↔ report pages
  const pairs = []
  const refDir = join(out, 'reference')
  if (isPdf) {
    const refs = rasterisePdf(refPath, refDir, o.dpi)
    if (refs.length === 1 && o.page) {
      const p = matchPage(rep.pages, o.page, pngIndex)
      if (!p) fail(`--page ${o.page}: no such rendered page`)
      pairs.push({ page: p, ref: refs[0].image, refFile: refs[0].file })
    } else {
      // Power BI exports the visible pages in tab order; hidden pages (tooltips included) are left out
      const visible = rep.pages.filter((p) => !p.hidden)
      if (o.pages && !o.lumen) console.warn('note: with --pages the PDF pages are matched to the rendered visible pages in order; render all pages (no --pages) if the PDF has more')
      if (refs.length !== visible.length) console.warn(`warning: the PDF has ${refs.length} page(s), the report ${visible.length} visible page(s) rendered; matching in order`)
      for (let i = 0; i < Math.min(refs.length, visible.length); i++) pairs.push({ page: visible[i], ref: refs[i].image, refFile: refs[i].file })
    }
  } else {
    const key = o.page ?? (o.pages && !o.pages.includes(',') ? o.pages : null)
    const p = key ? matchPage(rep.pages, key, pngIndex) : rep.pages[0]
    if (!p) fail(`--page ${key}: not among the rendered pages (${rep.pages.map((q) => q.displayName).join(', ')})`)
    pairs.push({ page: p, ref: loadImage(refPath, refDir), refFile: refPath })
  }
  if (!pairs.length) fail('nothing to compare')

  mkdirSync(join(out, 'pages'), { recursive: true })
  rmSync(join(out, 'visuals'), { recursive: true, force: true })
  mkdirSync(join(out, 'visuals'), { recursive: true })
  const result = { reference: refPath, report: reportPath, lumen: sweepDir, sameData: o.sameData, sampleData: !!rep.sampleData, createdAt: new Date().toISOString(), pages: [] }
  const all = []

  for (const { page, ref } of pairs) {
    const idx = String(pngIndex(page) || result.pages.length + 1).padStart(2, '0')
    if (!page.png) {
      console.warn(`page ${idx}: Lumen did not capture it, skipped`)
      continue
    }
    const lumPng = decodePng(readFileSync(join(sweepDir, page.png)))
    const pp = page.pngPage ?? { x: 0, y: 0, scale: lumPng.width / page.width }
    const lumRect = { x: pp.x, y: pp.y, w: page.width * pp.scale, h: page.height * pp.scale }
    const lumPage = resample(lumPng, lumRect, lumRect.w, lumRect.h)
    const aspect = page.width / page.height
    let refRect, detected = false, ncc = null, edge = null
    if (o.crop) refRect = o.crop
    else if (isPdf && Math.abs(ref.width / ref.height / aspect - 1) < 0.01) {
      // Power BI's Export to PDF makes each PDF page the page canvas, at the page's aspect ratio
      refRect = { x: 0, y: 0, w: ref.width, h: ref.height }
      console.log(`page ${idx}: PDF page ${ref.width}x${ref.height} has the page's aspect ratio: used whole (pass --crop to override)`)
    } else {
      const t0 = Date.now()
      // coarse: where does Lumen's render of the page correlate best; fine: where do the definition's
      // container edges line up with edges in the reference
      const f = findCanvas(ref, lumPage, aspect)
      const rects = page.visuals.filter((v) => v.rect && v.state !== 'hidden').map((v) => v.rect)
      const g = refineCanvasByRects(ref, rects, page.width, page.height, f)
      refRect = g ? { x: g.x, y: g.y, w: g.w, h: g.h } : { x: f.x, y: f.y, w: f.w, h: f.h }
      detected = true
      ncc = f.ncc
      edge = g?.edgeScore ?? null
      console.log(`page ${idx}: reference ${ref.width}x${ref.height}, page canvas detected at --crop ${refRect.x},${refRect.y},${refRect.w},${refRect.h} (correlation ${ncc}, edge fit ${edge ?? 'n/a'}, ${Date.now() - t0} ms)`)
      if (ncc < 0.5 || (edge != null && edge < 0.08)) console.warn(`  warning: weak match: the page may be misplaced. Check pages/p${idx}-page.png and pass --crop x,y,w,h if it is`)
    }
    // compare at the smaller of the two resolutions (downscaling only: both sides get the same blur)
    const s = Math.min(refRect.w, lumRect.w) / page.width
    const W = Math.round(page.width * s), H = Math.round(page.height * s)
    let refN = resample(ref, refRect, W, H)
    const lumN = resample(lumPage, { x: 0, y: 0, w: lumPage.width, h: lumPage.height }, W, H)
    // reference quality: a colour cast on large uniform areas means the image was processed (re-encoded,
    // colour-managed, "enhanced"); a low resolution blurs thin lines and small text. Either way the scores
    // are weaker evidence, and the review page says so.
    const cast = fitColourCast(refN, lumN, s)
    const processed = cast.maxShift > 10
    const calibrate = o.calibrate ?? processed
    const quality = { processed, lowResolution: s < 0.6, warnings: [] }
    const castInfo = { meanDeltaE: cast.cast, maxShift: cast.maxShift, anchors: cast.anchors.slice(0, 8).map((a) => ({ ref: hex(a.ref), lumen: hex(a.lumen), deltaE: Math.round(a.deltaE * 10) / 10, samples: a.n })), corrected: calibrate }
    if (processed) {
      quality.warnings.push(`The reference's colours are shifted on large uniform areas (largest ΔE ${cast.maxShift}: ${castInfo.anchors.filter((a) => a.deltaE > 10).slice(0, 3).map((a) => `${a.ref} where Lumen has ${a.lumen}`).join(', ')}). It looks processed (re-encoded, colour-managed or enhanced): colour scores count half${calibrate ? ' and the cast was corrected before scoring' : ''}; thin lines and text weight are weak evidence too.`)
    }
    if (quality.lowResolution) quality.warnings.push(`Low resolution: ${Math.round(s * 100) / 100} reference pixels per page unit (below 0.6). Lines of 1–2 units and text stroke weights are near the pixel size and their scores are weak evidence; export at the page's own size or larger.`)
    for (const w of quality.warnings) console.warn(`  warning: ${w}`)
    if (calibrate && cast.anchors.length) refN = applyColourCast(refN, cast.anchors)
    const pageImg = `pages/p${idx}-page.png`
    writeFileSync(join(out, pageImg), encodePng(sideBySide([refN, lumN], 12)))
    // alignment check: the definition's visual rectangles drawn on the reference (and on Lumen)
    const overlay = (im) => {
      const c = crop(im, 0, 0, im.width, im.height)
      for (const v of page.visuals) if (v.rect && v.state !== 'hidden') strokeRect(c, v.rect.x * s, v.rect.y * s, v.rect.w * s, v.rect.h * s, [255, 0, 200, 255])
      return c
    }
    const overlayImg = `pages/p${idx}-rects.png`
    writeFileSync(join(out, overlayImg), encodePng(sideBySide([overlay(refN), overlay(lumN)], 12)))
    const pageRes = { index: Number(idx), name: page.name, displayName: o.titles ? page.displayName : undefined, width: page.width, height: page.height, referenceRect: refRect, detected, correlation: ncc, edgeFit: edge, colourCast: castInfo, quality, pixelsPerUnit: Math.round(s * 1000) / 1000, image: pageImg, overlay: overlayImg, visuals: [] }
    if (o.sameData) {
      const d = pixelDiff(refN, lumN)
      pageRes.pixels = { share: Math.round(d.share * 10000) / 100, meanDeltaE: Math.round(d.meanDE * 100) / 100 }
    }

    const refEdges = edgeMaps(refN, 1, 3.5)
    // per visual, named by type + reading-order index (never by title)
    const vis = page.visuals.filter((v) => v.rect && !['hidden', 'not-rendered'].includes(v.state) && v.rect.w >= 10 && v.rect.h >= 10)
    vis.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    const perType = new Map()
    for (const v of vis) {
      const k = (perType.get(v.visualType) ?? 0) + 1
      perType.set(v.visualType, k)
      const shortType = v.visualType.replace(/[0-9A-F]{32}$/, '')
      const id = `p${idx}-${shortType}-${k}`
      const x0 = Math.max(0, Math.round(v.rect.x * s)), y0 = Math.max(0, Math.round(v.rect.y * s))
      const x1 = Math.min(W, Math.round((v.rect.x + v.rect.w) * s)), y1 = Math.min(H, Math.round((v.rect.y + v.rect.h) * s))
      if (x1 - x0 < 6 || y1 - y0 < 6) continue
      // local alignment around this visual's own container border (mild warping, rounding of the global fit)
      const lo = o.crop && o.noLocal ? { dx: 0, dy: 0, score: 0, base: 0 } : localOffset(refEdges, v.rect, page.width, page.height, s, Math.max(2, Math.round(8 * s)))
      // only visuals with a visible container border: a borderless visual (slicer, text) would latch on to a
      // neighbour's edges
      const useLocal = !o.noLocal && (lo.dx || lo.dy) && lo.score >= 0.45 && lo.score > lo.base + 0.15
      let ox = useLocal ? lo.dx : 0, oy = useLocal ? lo.dy : 0
      let alignedBy = useLocal ? 'border' : null
      if (!useLocal && !o.noLocal && !o.crop && !DATA_HEAVY.test(v.visualType)) {
        // no convincing border: align on content — only for visuals whose content does not depend much on the
        // data (slicers, text, shapes, images, cards); a chart or table with other data would chase its values, and report the shift (it may be a real position error)
        const B0 = crop(lumN, x0, y0, x1 - x0, y1 - y0)
        const co = contentOffset(refN, x0, y0, x1 - x0, y1 - y0, B0, Math.max(2, Math.round(12 * s)))
        if ((co.dx || co.dy) && co.ncc >= 0.6 && co.ncc > co.base + 0.1) {
          ox = co.dx
          oy = co.dy
          alignedBy = 'content'
        }
      }
      const A = crop(refN, x0 + ox, y0 + oy, x1 - x0, y1 - y0), B = crop(lumN, x0, y0, x1 - x0, y1 - y0)
      const sc = scoreVisual(A, B, s, { sameData: o.sameData, weakColour: processed })
      if (alignedBy) {
        // the shift itself is a finding: weak when the reference is processed (warping) or aligned on content
        const d = Math.hypot(ox, oy) / s
        const sev = Math.round(Math.max(0, Math.min(1, (d - 3) / 12)) * (processed ? 0.5 : 1) * 100) / 100
        sc.scores.position = { dx: Math.round((ox / s) * 10) / 10, dy: Math.round((oy / s) * 10) / 10, by: alignedBy, severity: sev, what: 'shift (page units) that lined the reference crop up with this visual (by its container border or its content) after the page-level fit: a position difference in Lumen, or warping of the reference; scores above are computed after the shift' }
        sc.total = Math.round((sc.total + sev * 0.6) * 100) / 100
        if (sev >= 0.3) sc.reasons.push('position')
      }
      const panels = [A, B]
      if (o.sameData) panels.push(pixelDiff(A, B).heat)
      const image = `visuals/${id}.png`
      const pair = sideBySide(panels, 6)
      writeFileSync(join(out, image), encodePng(pair))
      const rec = { id, page: Number(idx), visualType: v.visualType, title: o.titles ? v.title : undefined, state: v.state, rect: { x: Math.round(v.rect.x), y: Math.round(v.rect.y), w: Math.round(v.rect.w), h: Math.round(v.rect.h) }, position: where(v.rect, page), z: v.z, offset: alignedBy ? { dx: Math.round((ox / s) * 10) / 10, dy: Math.round((oy / s) * 10) / 10, by: alignedBy } : undefined, total: sc.total, reasons: sc.reasons, scores: sc.scores, image, imageWidth: pair.width }
      pageRes.visuals.push(rec)
      all.push(rec)
    }
    pageRes.visuals.sort((a, b) => b.total - a.total)
    result.pages.push(pageRes)
  }

  all.sort((a, b) => b.total - a.total)
  result.ranking = all.map((v) => v.id)
  writeFileSync(join(out, 'compare.json'), JSON.stringify(result, null, 1))
  writeTsv(join(out, 'summary.tsv'), all)
  writeFileSync(join(out, 'index.html'), html(result, all, o))
  console.log(`\nworst visuals (score = weighted sum of severities, see docs/COMPARE.md):`)
  for (const v of all.slice(0, 15)) console.log(`  ${String(v.total).padStart(5)}  ${v.id.padEnd(34)} ${v.position.padEnd(14)} ${v.reasons.join(', ')}`)
  console.log(`\nreview: ${join(out, 'index.html')}`)
}

function writeTsv(path, all) {
  const g = (v, ...p) => p.reduce((o, k) => (o == null ? o : o[k]), v.scores) ?? ''
  const cols = [
    ['rank', (v, i) => i + 1], ['id', (v) => v.id], ['page', (v) => v.page], ['type', (v) => v.visualType], ['position', (v) => v.position],
    ['x', (v) => v.rect.x], ['y', (v) => v.rect.y], ['w', (v) => v.rect.w], ['h', (v) => v.rect.h],
    ['score', (v) => v.total], ['reasons', (v) => v.reasons.join(',')],
    ['bg_dE', (v) => g(v, 'background', 'deltaE')], ['border_dE', (v) => g(v, 'border', 'meanDeltaE')], ['palette_hue_gap', (v) => g(v, 'palette', 'hueGap')],
    ['title_ink_ratio', (v) => g(v, 'titleInk', 'ratio')], ['title_stroke_ratio', (v) => g(v, 'titleStroke', 'ratio')],
    ['line_weight_ref', (v) => g(v, 'titleLine', 'ref', 'weight')], ['line_weight_lumen', (v) => g(v, 'titleLine', 'lumen', 'weight')], ['line_colour_dE', (v) => g(v, 'titleLine', 'colourDeltaE')], ['bottom_stroke_ratio', (v) => g(v, 'bottomRow', 'strokeRatio')],
    ['extent_d_right', (v) => g(v, 'extent', 'delta', 'right')], ['extent_d_bottom', (v) => g(v, 'extent', 'delta', 'bottom')], ['layout_mismatch', (v) => g(v, 'layout', 'mismatch')],
    ['pixels_pct', (v) => g(v, 'pixels', 'share')]
  ]
  const lines = [cols.map((c) => c[0]).join('\t'), ...all.map((v, i) => cols.map((c) => c[1](v, i)).join('\t'))]
  writeFileSync(path, lines.join('\n') + '\n')
}

const LABELS = { background: 'background', border: 'border band', palette: 'series colours', titleInk: 'title ink', titleStroke: 'title stroke', titleLine: 'title divider', bottomRow: 'bottom row', position: 'position', extent: 'content extent', layout: 'layout', pixels: 'pixel diff' }

function fmtScore(k, v) {
  const j = (x) => (x == null ? '–' : typeof x === 'object' ? Object.entries(x).map(([a, b]) => `${a} ${b}`).join(', ') : x)
  switch (k) {
    case 'background': return `ref <span class=sw style="background:${v.ref}"></span>${v.ref} · lumen <span class=sw style="background:${v.lumen}"></span>${v.lumen} · ΔE ${v.deltaE}`
    case 'border': return `mean ΔE ${v.meanDeltaE}`
    case 'palette': return `ref ${v.ref.map((c) => `<span class=sw style="background:${c}" title="${c}"></span>`).join('') || '–'} · lumen ${v.lumen.map((c) => `<span class=sw style="background:${c}" title="${c}"></span>`).join('') || '–'} · hue gap ${v.hueGap}°${v.unmatched.length ? ` · unmatched ${v.unmatched.map((u) => `${u.side} <span class=sw style="background:${u.hex}"></span>${u.share}%`).join(', ')}` : ''}`
    case 'titleInk': return `ink ref ${v.ref ?? '–'}% · lumen ${v.lumen ?? '–'}% · ratio ${v.ratio} · top ref ${v.topRef ?? '–'} · lumen ${v.topLumen ?? '–'} units`
    case 'titleStroke': return `ref ${v.ref} · lumen ${v.lumen} units · ratio ${v.ratio}`
    case 'titleLine': return `ref ${v.ref ? `weight ${v.ref.weight} (~${v.ref.thickness} u) <span class=sw style="background:${v.ref.colour}"></span>${v.ref.colour}` : 'none'} · lumen ${v.lumen ? `weight ${v.lumen.weight} (~${v.lumen.thickness} u) <span class=sw style="background:${v.lumen.colour}"></span>${v.lumen.colour}` : 'none'}${v.weightRatio != null ? ` · weight ratio ${v.weightRatio}` : ''}${v.colourDeltaE != null ? ` · colour ΔE ${v.colourDeltaE}, lightness ${v.lightnessDelta > 0 ? '+' : ''}${v.lightnessDelta}` : ''}`
    case 'bottomRow': return `ref ink ${v.ref.ink}% stroke ${v.ref.stroke ?? '–'} rule ${v.ref.rule ?? 'none'} · lumen ink ${v.lumen.ink}% stroke ${v.lumen.stroke ?? '–'} rule ${v.lumen.rule ?? 'none'}`
    case 'extent': return v.delta ? `Lumen − ref: ${j(v.delta)}` : `ref ${v.ref} · lumen ${v.lumen}`
    case 'layout': return `${Math.round(v.mismatch * 100)}% of occupied cells differ (${v.grid})`
    case 'position': return `shifted ${v.dx}, ${v.dy} units (aligned on ${v.by})`
    case 'pixels': return `${v.share}% of pixels differ · mean ΔE ${v.meanDeltaE}`
    default: return esc(JSON.stringify(v))
  }
}

function html(result, all, o) {
  const sevClass = (s) => (s >= 0.6 ? 'bad' : s >= 0.3 ? 'warn' : 'ok')
  const card = (v, rank) => `
<section class="vis" data-page="${v.page}" data-score="${v.total}">
  <header><span class="rank">#${rank}</span> <b>${esc(v.id)}</b> <span class="muted">${esc(v.visualType)} · ${v.position}${v.offset ? ` · <b>reference crop shifted ${v.offset.dx}, ${v.offset.dy} units (aligned on its ${v.offset.by})</b>` : ''} · x ${v.rect.x} y ${v.rect.y} w ${v.rect.w} h ${v.rect.h}${v.title ? ` · “${esc(v.title)}”` : ''}</span>
  <span class="total ${sevClass(v.total / 2)}">${v.total}</span></header>
  <div class="body"><a href="${v.image}"><img loading="lazy" src="${v.image}" alt="${esc(v.id)}" style="width:${Math.min(900, Math.max(v.imageWidth ?? 0, Math.round((v.imageWidth ?? 450) * 2)))}px"></a>
  <table>${Object.entries(v.scores).map(([k, s]) => `<tr class="${sevClass(s.severity ?? 0)}"><th title="${esc(s.what)}">${LABELS[k] ?? k}</th><td class="sev">${s.severity ?? ''}</td><td>${fmtScore(k, s)}</td></tr>`).join('')}</table></div>
</section>`
  const pages = result.pages.map((p) => `<details><summary>Page ${p.index}${p.displayName ? ` – ${esc(p.displayName)}` : ''}: reference canvas ${p.referenceRect.x},${p.referenceRect.y},${p.referenceRect.w},${p.referenceRect.h} ${p.detected ? `(detected, correlation ${p.correlation}, edge fit ${p.edgeFit ?? 'n/a'})` : '(--crop)'} · ${p.pixelsPerUnit} px/unit${p.pixels ? ` · pixel diff ${p.pixels.share}%` : ''}</summary><a href="${p.image}"><img src="${p.image}" alt="page ${p.index}"></a><p class="muted">Alignment check: the definition's visual rectangles on both sides (<a href="${p.overlay}">open</a>). If they do not sit on the reference's containers, re-run with --crop x,y,w,h.</p><a href="${p.overlay}"><img src="${p.overlay}" alt="page ${p.index} rectangles"></a></details>`).join('\n')
  const legend = Object.entries(LABELS).map(([k, l]) => {
    const what = all.find((v) => v.scores[k])?.scores[k]?.what
    return what ? `<li><b>${l}</b>: ${esc(what)}</li>` : ''
  }).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumen vs Power BI</title>
<style>
:root{--bg:#f4f4f4;--fg:#222;--card:#fff;--muted:#666;--line:#ddd;--bad:#c4314b;--warn:#c27c0e;--ok:#3a7d44}
@media (prefers-color-scheme:dark){:root{--bg:#1d1d1d;--fg:#e8e8e8;--card:#282828;--muted:#aaa;--line:#444}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 "Segoe UI",system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}.muted{color:var(--muted)}
.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:1;display:flex;gap:16px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
details{margin:8px 0}details img{max-width:100%;border:1px solid var(--line)}
.vis{background:var(--card);border:1px solid var(--line);border-radius:6px;margin:12px 0;padding:10px}
.vis header{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.vis header .total{margin-left:auto;font-weight:700;font-size:16px}
.body{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}.body img{max-width:100%;border:1px solid var(--line);image-rendering:auto}
table{border-collapse:collapse;font-size:12px;flex:1;min-width:280px}th{text-align:left;font-weight:600;white-space:nowrap;cursor:help;padding:2px 8px 2px 0}td{padding:2px 6px}
tr.bad .sev,.total.bad{color:var(--bad)}tr.warn .sev,.total.warn{color:var(--warn)}tr.ok .sev,.total.ok{color:var(--ok)}
.sw{display:inline-block;width:11px;height:11px;border:1px solid #888;vertical-align:middle;margin:0 2px}
.banner{background:#fff4ce;color:#3b2f00;border:1px solid #c27c0e;border-radius:6px;padding:8px 12px;margin:8px 0}
ul{margin:4px 0 0 18px;padding:0;font-size:12px}
</style></head><body>
<h1>Lumen vs Power BI</h1>
<div class="muted">Each image: reference (left) | Lumen (right)${o.sameData ? ' | difference' : ''}, same scale, cut at the visual's rectangle from the definition. ${o.sameData ? 'Same data on both sides.' : 'The data usually differs (sample data in Lumen): the scores look at chrome, weight, colours and extent, not at values.'} Visuals worst first.</div>
${result.pages.flatMap((p) => (p.quality?.warnings ?? []).map((w) => `<div class="banner"><b>Page ${p.index}: weak evidence.</b> ${esc(w)}</div>`)).join('\n')}
<details><summary>What the scores measure</summary><ul>${legend}</ul><p class="muted">Severity 0–1 per score (≥ 0.3 listed as a reason); the visual's score is their weighted sum. Thresholds are heuristic — see docs/COMPARE.md.</p></details>
${pages}
<div class="bar"><label>Page <select id="pg"><option value="">all</option>${result.pages.map((p) => `<option>${p.index}</option>`).join('')}</select></label>
<label>Min score <input id="min" type="range" min="0" max="3" step="0.1" value="0"> <span id="minv">0</span></label><span id="count" class="muted"></span></div>
${all.map((v, i) => card(v, i + 1)).join('\n')}
<script>
const pg=document.getElementById('pg'),min=document.getElementById('min');
function f(){let n=0;for(const s of document.querySelectorAll('.vis')){const on=(!pg.value||s.dataset.page===pg.value)&&+s.dataset.score>=+min.value;s.style.display=on?'':'none';if(on)n++}
document.getElementById('minv').textContent=min.value;document.getElementById('count').textContent=n+' visual(s)'}
pg.onchange=f;min.oninput=f;f()
</script></body></html>`
}

try {
  main()
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}

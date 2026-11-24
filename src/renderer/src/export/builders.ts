/**
 * Pure builders for report exports from captured page images:
 *   buildPptx  → PowerPoint (pptxgenjs): title slide + one full-bleed slide per page, notes with filters
 *   buildHtml  → single self-contained HTML viewer (base64 PNGs, PBI-like page tabs, ←/→ keys, the report's page
 *                transitions; visual animations can't play on page images)
 */
import { APP_NAME } from '../app/brand'

export interface ExportedPage {
  name: string
  displayName: string
  /** report page size in CSS px (page.json width/height) */
  width: number
  height: number
  png: Uint8Array
  /** plain-text lines for slide notes (applied filters…) */
  notes?: string[]
}

export interface ExportMeta {
  reportName: string
  exportedAt?: Date
  /** Lumen page transitions (core/report/motion.ts) by page name, for the HTML viewer; absent = none */
  transitions?: Record<string, string>
  transitionDuration?: number
  /** a page's own transition duration (ms) and CSS easing, over `transitionDuration` and Lumen's curve */
  transitionTiming?: Record<string, { duration?: number; easing?: string }>
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

export function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${bytesToBase64(png)}`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function dateLabel(d: Date): string {
  return d.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** PowerPoint deck: slide size follows the first page's aspect ratio at 13.333in width. */
export async function buildPptx(pages: ExportedPage[], meta: ExportMeta): Promise<Uint8Array> {
  const mod: any = await import('pptxgenjs')
  const PptxGenJS = mod.default ?? mod
  const pptx = new PptxGenJS()
  const first = pages[0] ?? { width: 1280, height: 720 }
  const W = 13.333
  const H = Math.round(((W * first.height) / Math.max(1, first.width)) * 1000) / 1000
  pptx.defineLayout({ name: 'LUMEN', width: W, height: H })
  pptx.layout = 'LUMEN'
  pptx.author = APP_NAME
  pptx.company = ''
  pptx.title = meta.reportName
  const when = meta.exportedAt ?? new Date()

  const title = pptx.addSlide()
  title.background = { color: 'FFFFFF' }
  title.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: H, fill: { color: 'F2C811' }, line: { color: 'F2C811' } })
  title.addText(meta.reportName, { x: 0.8, y: H * 0.33, w: W - 1.6, h: 1.0, fontFace: 'Segoe UI Semibold', fontSize: 36, color: '252423', bold: true })
  title.addText(`Exported from ${APP_NAME} on ${dateLabel(when)}`, { x: 0.8, y: H * 0.33 + 1.05, w: W - 1.6, h: 0.5, fontFace: 'Segoe UI', fontSize: 16, color: '605E5C' })
  title.addText(`${pages.length} page${pages.length === 1 ? '' : 's'}`, { x: 0.8, y: H * 0.33 + 1.55, w: W - 1.6, h: 0.4, fontFace: 'Segoe UI', fontSize: 12, color: '8A8886' })

  for (const p of pages) {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    // contain the page image (pages with a different aspect ratio are letterboxed, centered)
    const scale = Math.min(W / p.width, H / p.height)
    const w = p.width * scale
    const h = p.height * scale
    slide.addImage({ data: pngDataUrl(p.png), x: (W - w) / 2, y: (H - h) / 2, w, h, altText: p.displayName })
    const notes = [p.displayName, ...(p.notes?.length ? ['', 'Filters applied:', ...p.notes.map((n) => `• ${n}`)] : [])]
    slide.addNotes(notes.join('\n'))
  }
  const out = await pptx.write({ outputType: 'uint8array' })
  if (out instanceof Uint8Array) return out
  if (out instanceof ArrayBuffer) return new Uint8Array(out)
  if (typeof Blob !== 'undefined' && out instanceof Blob) return new Uint8Array(await out.arrayBuffer())
  throw new Error('PowerPoint export produced no data')
}

/**
 * Self-contained HTML viewer. The page tabs list exactly the exported pages (`pages`, already in report order).
 * Pages are embedded as images, so buttons drawn inside a page (page navigators, bookmarks, drillthrough) are
 * inert: one pointing at a page left out of the export cannot lead anywhere broken.
 */
const TRANSITIONS = new Set(['fade', 'slide', 'push', 'rise', 'zoom', 'depth', 'wipe', 'circle', 'morph'])

const CSS_EASING = /^(linear|cubic-bezier\(-?[\d.]+, ?-?[\d.]+, ?-?[\d.]+, ?-?[\d.]+\))$/

function transitionAttr(t: string | undefined, timing?: { duration?: number; easing?: string }): string {
  if (!t || !TRANSITIONS.has(t)) return ''
  const d = timing?.duration !== undefined && Number.isFinite(timing.duration) ? ` data-d="${Math.max(100, Math.min(1500, Math.round(timing.duration)))}"` : ''
  const e = timing?.easing && CSS_EASING.test(timing.easing) ? ` data-e="${timing.easing}"` : ''
  return ` data-t="${t}"${d}${e}`
}

export function buildHtml(pages: ExportedPage[], meta: ExportMeta): string {
  const when = meta.exportedAt ?? new Date()
  const sections = pages
    .map(
      (p, i) =>
        `<section class="pg${i === 0 ? ' on' : ''}" data-i="${i}" data-w="${p.width}" data-h="${p.height}"${transitionAttr(meta.transitions?.[p.name], meta.transitionTiming?.[p.name])} aria-label="${escapeHtml(p.displayName)}"><img alt="${escapeHtml(p.displayName)}" src="${pngDataUrl(p.png)}" width="${p.width}" height="${p.height}"></section>`
    )
    .join('\n')
  const tabs = pages.map((p, i) => `<button type="button" class="tab${i === 0 ? ' on' : ''}" data-i="${i}">${escapeHtml(p.displayName)}</button>`).join('')
  const tms = Math.max(100, Math.min(1500, Math.round(meta.transitionDuration ?? 350)))
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${APP_NAME}">
<title>${escapeHtml(meta.reportName)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#EAEAEA;font-family:'Segoe UI','Open Sans',system-ui,sans-serif;font-size:13px;color:#252423}
body{display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;height:40px;padding:0 16px;background:#fff;border-bottom:1px solid #E1DFDD}
header h1{font-size:14px;font-weight:600;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header span{color:#605E5C;font-size:12px}
main{flex:1;min-height:0;position:relative;overflow:hidden}
.pg{display:none;position:absolute;left:50%;top:50%;transform-origin:center center;box-shadow:0 1.6px 3.6px rgba(0,0,0,.13),0 .3px .9px rgba(0,0,0,.11);background:#fff}
.pg.on,.pg.out{display:block}
.pg.on{z-index:2}
.pg.out{z-index:1;pointer-events:none}
.pg img{display:block}
nav{display:flex;align-items:stretch;gap:0;height:36px;background:#fff;border-top:1px solid #E1DFDD;overflow-x:auto;padding:0 8px}
nav .arrow{border:0;background:transparent;width:28px;font-size:14px;color:#605E5C;cursor:pointer}
nav .arrow:disabled{color:#C8C6C4;cursor:default}
.tab{position:relative;border:0;background:transparent;padding:0 16px;font:inherit;color:#252423;cursor:pointer;white-space:nowrap}
.tab:hover{background:#F3F2F1}
.tab.on{font-weight:600}
.tab.on::after{content:'';position:absolute;left:8px;right:8px;bottom:0;height:3px;background:#F2C811;border-radius:2px}
footer{position:fixed;right:12px;bottom:44px;color:#8A8886;font-size:11px}
</style>
</head>
<body>
<header><h1>${escapeHtml(meta.reportName)}</h1><span id="pos">Page 1 of ${pages.length}</span></header>
<main id="stage">
${sections}
</main>
<nav><button type="button" class="arrow" id="prev" aria-label="Previous page">&#9664;</button><button type="button" class="arrow" id="next" aria-label="Next page">&#9654;</button>${tabs}</nav>
<footer>Exported from ${APP_NAME} · ${escapeHtml(dateLabel(when))}</footer>
<script>
(function(){
  var pages=[].slice.call(document.querySelectorAll('.pg'));
  var tabs=[].slice.call(document.querySelectorAll('.tab'));
  var stage=document.getElementById('stage');
  var cur=0;
  var still=!document.body.animate||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
  function enter(p,dir,o){
    var t=p.dataset.t; if(still||!t) return;
    var e=p.dataset.e||'cubic-bezier(0.22, 0.8, 0.3, 1)', k={duration:p.dataset.d?+p.dataset.d:${tms},easing:e};
    var f, g=null;
    if(t==='slide') f=[{opacity:0,translate:(dir*120)+'px 0'},{opacity:1,translate:'0 0'}];
    else if(t==='push'){f=[{opacity:0,translate:(dir*120)+'px 0'},{opacity:1,translate:'0 0'}];g=[{opacity:1,translate:'0 0'},{opacity:0,translate:(-dir*120)+'px 0'}]}
    else if(t==='rise') f=[{opacity:0,translate:'0 24px'},{opacity:1,translate:'0 0'}];
    else if(t==='zoom') f=[{opacity:0,scale:'0.96'},{opacity:1,scale:'1'}];
    else if(t==='depth'){f=[{opacity:0,translate:'0 16px',scale:'0.98'},{opacity:1,translate:'0 0',scale:'1'}];g=[{opacity:1,scale:'1'},{opacity:0,scale:'0.92'}]}
    else if(t==='wipe'){f=[{clipPath:dir>0?'inset(0 100% 0 0)':'inset(0 0 0 100%)'},{clipPath:'inset(0 0 0 0)'}];g=[{opacity:1},{opacity:1}]}
    else if(t==='circle'){f=[{clipPath:'circle(0% at 50% 50%)'},{clipPath:'circle(71% at 50% 50%)'}];g=[{opacity:1},{opacity:1}]}
    else{f=[{opacity:0},{opacity:1}];if(t==='morph')g=[{opacity:1},{opacity:0}]}
    clip(p);
    var a=p.animate(f,k);
    a.onfinish=a.oncancel=unclip;
    if(g&&o){o.classList.add('out');o.animate(g,k).onfinish=function(){o.classList.remove('out')}}
  }
  // nothing a transition moves shows outside the page: the stage is clipped to the entering page while it plays
  var clips=0;
  function clip(p){
    var s=stage.getBoundingClientRect(), r=p.getBoundingClientRect();
    clips++;
    stage.style.clipPath='inset('+(r.top-s.top)+'px '+(s.right-r.right)+'px '+(s.bottom-r.bottom)+'px '+(r.left-s.left)+'px)';
  }
  function unclip(){if(--clips<=0){clips=0;stage.style.clipPath=''}}
  function fit(){
    var p=pages[cur]; if(!p) return;
    var w=+p.dataset.w, h=+p.dataset.h;
    var s=Math.min((stage.clientWidth-32)/w,(stage.clientHeight-32)/h);
    p.style.transform='translate(-50%,-50%) scale('+Math.max(0.05,s)+')';
  }
  function show(i){
    if(i<0||i>=pages.length) return;
    var from=cur;
    pages[cur].classList.remove('on'); tabs[cur].classList.remove('on');
    cur=i;
    pages[cur].classList.add('on'); tabs[cur].classList.add('on');
    tabs[cur].scrollIntoView({inline:'nearest',block:'nearest'});
    document.getElementById('pos').textContent='Page '+(cur+1)+' of '+pages.length;
    document.getElementById('prev').disabled=cur===0;
    document.getElementById('next').disabled=cur===pages.length-1;
    fit();
    if(from!==cur) enter(pages[cur],cur>from?1:-1,pages[from]);
  }
  tabs.forEach(function(t){t.addEventListener('click',function(){show(+t.dataset.i)})});
  document.getElementById('prev').addEventListener('click',function(){show(cur-1)});
  document.getElementById('next').addEventListener('click',function(){show(cur+1)});
  document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='PageDown')show(cur+1);if(e.key==='ArrowLeft'||e.key==='PageUp')show(cur-1)});
  window.addEventListener('resize',fit);
  show(0);
})();
</script>
</body>
</html>
`
}

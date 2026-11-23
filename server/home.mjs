/**
 * Lumen Server's home page: a gallery of the published dashboards with page previews.
 *
 * Previews are the JPEGs Lumen renders while publishing (site/previews/<n>.jpg, listed in lumen-publish.json as
 * `previews`). Moving the pointer across a card flips through its pages. A password-protected dashboard never shows
 * its preview to someone who has not signed in to it: its card shows a generated cover, and the real preview is only
 * requested from /d/<slug>/previews/… (which answers 401 without that dashboard's cookie) and shown if it loads.
 *
 * Pure HTML, CSS and a little inline script; no assets, no dependencies.
 */

const PREVIEW_SRC = /^previews\/\d{1,2}\.jpg$/

/** The manifest's preview list, kept only for files that are really in the upload. */
export function readPreviews(manifest, files) {
  const list = Array.isArray(manifest?.previews) ? manifest.previews : []
  const out = []
  for (const p of list.slice(0, 24)) {
    if (!p || typeof p.src !== 'string' || !PREVIEW_SRC.test(p.src) || !files.has(p.src)) continue
    out.push({
      src: p.src,
      page: String(p.page ?? '').slice(0, 100),
      displayName: String(p.displayName ?? '').slice(0, 200),
      width: Number.isFinite(p.width) ? Math.round(p.width) : undefined,
      height: Number.isFinite(p.height) ? Math.round(p.height) : undefined
    })
  }
  return out
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** A stable hue pair for a dashboard's generated cover. */
function hues(slug) {
  let h = 2166136261
  for (const ch of String(slug)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const a = h % 360
  return [a, (a + 40 + ((h >>> 9) % 80)) % 360]
}

function initials(title) {
  const words = String(title).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>'
const GLOBE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-3a15.6 15.6 0 0 0-1.4-4A8 8 0 0 1 18.9 8ZM12 4.1A13.4 13.4 0 0 1 13.8 8h-3.6A13.4 13.4 0 0 1 12 4.1ZM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3Zm.8 2h3a15.6 15.6 0 0 0 1.4 4A8 8 0 0 1 5.1 16Zm3-8h-3a8 8 0 0 1 4.4-4 15.6 15.6 0 0 0-1.4 4ZM12 19.9A13.4 13.4 0 0 1 10.2 16h3.6a13.4 13.4 0 0 1-1.8 3.9Zm2.3-5.9H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.2 6a15.6 15.6 0 0 0 1.4-4h3a8 8 0 0 1-4.4 4Zm1.8-6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4Z"/></svg>'
const PAGES = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h9a3 3 0 0 1 3 3v11h-2V6a1 1 0 0 0-1-1H8V3ZM4 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/></svg>'
const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/></svg>'

/** Abstract dashboard shapes for a cover without a preview (no data, just a hint of a report). */
function coverArt(slug) {
  let h = 0
  for (const ch of String(slug)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const bars = Array.from({ length: 7 }, (_, i) => 18 + (((h >>> (i * 3)) & 7) * 7))
  const line = Array.from({ length: 8 }, (_, i) => `${20 + i * 22},${70 - (((h >>> (i * 2 + 5)) & 7) * 5)}`).join(' ')
  return `<svg class="art" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<rect x="14" y="14" width="88" height="40" rx="6" class="a1"/><rect x="116" y="14" width="88" height="40" rx="6" class="a1"/><rect x="218" y="14" width="88" height="40" rx="6" class="a1"/>
<rect x="14" y="66" width="190" height="120" rx="6" class="a2"/><polyline points="${line.split(' ').map((p) => p.split(',').map(Number)).map(([x, y]) => `${x + 4},${y + 50}`).join(' ')}" class="ln"/>
<rect x="218" y="66" width="88" height="120" rx="6" class="a2"/>${bars.map((b, i) => `<rect x="${226 + i * 11}" y="${178 - b}" width="7" height="${b}" rx="2" class="br"/>`).join('')}
</svg>`
}

function card(d, i) {
  const locked = d.access === 'password'
  const [h1, h2] = hues(d.slug)
  const previews = d.previews ?? []
  const pageCount = d.pages?.length || previews.length
  const names = (d.pages?.length ? d.pages.map((p) => p.displayName || p.name) : previews.map((p) => p.displayName)).filter(Boolean)
  const shots = previews.map((p) => ({ src: p.src, name: p.displayName }))
  const img = previews[0]
  const media = img
    ? locked
      ? `<img class="shot probe" alt="" data-src="${esc(img.src)}" hidden>`
      : `<img class="shot" alt="${esc(`${d.title}: ${img.displayName || 'first page'}`)}" src="${esc(img.src)}" loading="${i < 6 ? 'eager' : 'lazy'}" decoding="async">`
    : ''
  return `<a class="card${i === 0 ? ' feature' : ''}" href="${esc(d.url)}" data-title="${esc(d.title.toLowerCase())} ${esc(d.slug)} ${esc(names.join(' ').toLowerCase())}" data-access="${locked ? 'password' : 'public'}" data-time="${esc(d.publishedAt)}" data-pages="${pageCount}" data-shots="${esc(JSON.stringify(shots))}" style="--h1:${h1};--h2:${h2};--i:${i}">
<div class="media">
<div class="cover">${coverArt(d.slug)}<div class="mono">${esc(initials(d.title))}</div>${locked ? `<div class="lockmark">${LOCK}<span>Password protected</span></div>` : ''}</div>
${media}
<div class="shade"></div>
<div class="chips"><span class="chip ${locked ? 'chip-lock' : 'chip-open'}">${locked ? LOCK + 'Locked' : GLOBE + 'Open'}</span>${pageCount ? `<span class="chip">${PAGES}${pageCount}</span>` : ''}</div>
${shots.length > 1 ? `<div class="scrub">${shots.map((_, k) => `<i${k === 0 ? ' class="on"' : ''}></i>`).join('')}</div><div class="pname">${esc(shots[0].name)}</div>` : ''}
<span class="open">Open dashboard <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.3 5.3 19.9 12l-6.6 6.7-1.4-1.4 4.2-4.3H4v-2h12.1l-4.2-4.3 1.4-1.4Z"/></svg></span>
</div>
<div class="body">
<div class="t">${esc(d.title)}</div>
<div class="m"><span class="when" data-iso="${esc(d.publishedAt)}">${esc(String(d.publishedAt).slice(0, 10))}</span><span class="dot">·</span><span class="path">/d/${esc(d.slug)}/</span></div>
${names.length ? `<div class="pills">${names.slice(0, 3).map((n) => `<span>${esc(n)}</span>`).join('')}${names.length > 3 ? `<span class="more">+${names.length - 3}</span>` : ''}</div>` : ''}
</div>
</a>`
}

const CSS = `
:root{--bg:#f4f3f1;--bg2:#eceae6;--fg:#1d1c1b;--fg2:#4a4846;--fg3:#7a7774;--card:#ffffffcc;--card-solid:#fff;--line:#00000014;--line2:#0000000d;--accent:#117865;--accent2:#1aa58b;--glow:#11786533;--chip:#ffffffe0;--chipfg:#1d1c1b;--shadow:0 1px 2px #0000000f,0 8px 24px -12px #00000026;--shadow-hover:0 2px 4px #00000014,0 24px 48px -20px #0000004d}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f10;--bg2:#121516;--fg:#f2f1ef;--fg2:#c9c6c2;--fg3:#8d8a86;--card:#181b1dcc;--card-solid:#181b1d;--line:#ffffff17;--line2:#ffffff0d;--accent:#4fd1b5;--accent2:#7ee8d0;--glow:#4fd1b533;--chip:#0d0f10cc;--chipfg:#f2f1ef;--shadow:0 1px 2px #0000004d,0 8px 24px -12px #00000080;--shadow-hover:0 2px 4px #00000066,0 28px 56px -20px #000000b3}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:14px/1.5 'Segoe UI Variable Text','Segoe UI','Selawik','Open Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.aurora{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.aurora b{position:absolute;border-radius:50%;filter:blur(90px);opacity:.55;animation:drift 26s ease-in-out infinite alternate}
.aurora b:nth-child(1){width:46vw;height:46vw;left:-12vw;top:-18vw;background:radial-gradient(circle,#1aa58b 0,transparent 70%)}
.aurora b:nth-child(2){width:40vw;height:40vw;right:-10vw;top:-12vw;background:radial-gradient(circle,#3b6fd8 0,transparent 70%);animation-delay:-8s}
.aurora b:nth-child(3){width:34vw;height:34vw;left:30vw;top:8vw;background:radial-gradient(circle,#9b5de5 0,transparent 70%);opacity:.28;animation-delay:-16s}
@media (prefers-color-scheme:light){.aurora b{opacity:.22}.aurora b:nth-child(3){opacity:.12}}
@keyframes drift{to{transform:translate3d(4vw,3vw,0) scale(1.08)}}
.wrap{position:relative;z-index:1;max-width:1320px;margin:0 auto;padding:0 24px 64px}
header.top{display:flex;align-items:center;gap:12px;padding:22px 0}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:.01em;color:var(--fg2)}
.logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),#3b6fd8);display:grid;place-items:center;box-shadow:0 4px 14px var(--glow)}
.logo svg{width:16px;height:16px;fill:#fff}
.hero{padding:28px 0 26px}
.hero h1{margin:0;font-size:clamp(32px,5vw,52px);line-height:1.05;font-weight:700;letter-spacing:-.025em}
.hero h1 span{background:linear-gradient(100deg,var(--fg) 30%,var(--accent) 70%,#3b6fd8);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{margin:12px 0 0;color:var(--fg3);font-size:15px}
.hero p strong{color:var(--fg2);font-weight:600}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 0;margin-bottom:18px;backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);background:transparent}
.search{flex:1 1 280px;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);transition:border-color .15s,box-shadow .15s}
.search:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px var(--glow)}
.search svg{width:16px;height:16px;fill:var(--fg3);flex:none}
.search input{flex:1;min-width:0;border:0;outline:0;background:none;color:var(--fg);font:inherit;font-size:14px}
.search kbd{font:11px/1 inherit;color:var(--fg3);border:1px solid var(--line);border-radius:5px;padding:3px 6px}
.seg{display:flex;padding:3px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.seg button{height:32px;padding:0 12px;border:0;border-radius:7px;background:none;color:var(--fg2);font:inherit;font-weight:500;cursor:pointer;transition:background .15s,color .15s}
.seg button[aria-pressed=true]{background:var(--fg);color:var(--bg)}
.sort{height:40px;padding:0 34px 0 12px;border:1px solid var(--line);border-radius:10px;background:var(--card) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23888' d='m7 10 5 5 5-5z'/%3E%3C/svg%3E") right 8px center/18px no-repeat;color:var(--fg);font:inherit;appearance:none;cursor:pointer}
.count{color:var(--fg3);font-size:13px;margin-left:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px}
@media (min-width:980px){.grid .card.feature{grid-column:span 2;grid-row:span 2}.grid .card.feature .t{font-size:22px}.feature .media{flex:1;aspect-ratio:auto;min-height:280px}.feature .cover .mono{font-size:120px}}
.card{position:relative;display:flex;flex-direction:column;border-radius:16px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);color:inherit;text-decoration:none;overflow:hidden;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,border-color .35s;animation:rise .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i) * 45ms)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}}
.card:hover,.card:focus-visible{transform:translateY(-4px);box-shadow:var(--shadow-hover);border-color:color-mix(in srgb,var(--accent) 45%,transparent);outline:0}
.card:focus-visible{box-shadow:0 0 0 3px var(--glow),var(--shadow-hover)}
.media{position:relative;aspect-ratio:16/10;overflow:hidden;background:var(--bg2)}
.cover{position:absolute;inset:0;background:radial-gradient(120% 120% at 0% 0%,hsl(var(--h1) 70% 55%) 0,transparent 55%),radial-gradient(120% 120% at 100% 100%,hsl(var(--h2) 70% 45%) 0,transparent 60%),hsl(var(--h1) 30% 18%)}
.cover .art{position:absolute;inset:8%;width:84%;height:84%;opacity:.55;mix-blend-mode:screen}
.cover .a1{fill:#ffffff26}.cover .a2{fill:#ffffff1a}.cover .br{fill:#ffffff8c}.cover .ln{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
.cover .mono{position:absolute;right:16px;bottom:10px;font-size:64px;font-weight:800;letter-spacing:-.04em;color:#ffffff2e;line-height:1}

.lockmark{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:8px;color:#fff;background:#0000002e;backdrop-filter:blur(2px)}
.lockmark svg{width:34px;height:34px;fill:#fff;filter:drop-shadow(0 4px 12px #0006)}
.lockmark span{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.9}
.shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center;background:#fff;transition:transform .6s cubic-bezier(.2,.8,.2,1),opacity .25s}
.card:hover .shot{transform:scale(1.03)}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,#0000 55%,#0000008c 100%);opacity:.0;transition:opacity .3s}
.card:hover .shade{opacity:1}
.chips{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:6px}
.chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:99px;background:var(--chip);color:var(--chipfg);font-size:12px;font-weight:600;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 2px 8px #00000026}
.chip svg{width:13px;height:13px;fill:currentColor}
.chip-lock{color:#b4570d}@media (prefers-color-scheme:dark){.chip-lock{color:#ffb86b}}
.chip-open{color:var(--accent)}
.chips .chip:last-child:not(:first-child){margin-left:auto}
.scrub{position:absolute;left:14px;right:14px;bottom:12px;display:flex;gap:4px;opacity:0;transition:opacity .25s}
.scrub i{flex:1;height:3px;border-radius:2px;background:#ffffff59}
.scrub i.on{background:#fff}
.pname{position:absolute;left:14px;bottom:22px;color:#fff;font-size:12px;font-weight:600;text-shadow:0 1px 4px #0009;opacity:0;transition:opacity .25s}
.card:hover .scrub,.card:hover .pname{opacity:1}
.open{position:absolute;right:14px;bottom:22px;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:99px;background:#fff;color:#111;font-size:12px;font-weight:700;box-shadow:0 6px 18px #0000004d;opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s}
.open svg{width:14px;height:14px;fill:currentColor}
.card:hover .open{opacity:1;transform:none}
.card:has(.scrub):hover .open{bottom:28px}
.body{padding:14px 16px 16px}
.t{font-size:16px;font-weight:650;letter-spacing:-.01em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.m{display:flex;gap:6px;margin-top:3px;color:var(--fg3);font-size:12.5px;white-space:nowrap;overflow:hidden}
.m .path{overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,'Cascadia Code',Menlo,monospace;font-size:11.5px;padding-top:1px}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.pills span{padding:2px 9px;border-radius:99px;border:1px solid var(--line);color:var(--fg2);font-size:12px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.pills .more{color:var(--fg3)}
.empty{position:relative;z-index:1;display:grid;justify-items:center;text-align:center;gap:14px;padding:72px 24px;border:1px dashed var(--line);border-radius:20px;background:var(--card)}
.empty .art{width:220px;height:auto;opacity:.9}.empty h2{margin:0;font-size:20px}.empty p{margin:0;color:var(--fg3);max-width:420px}
.empty code{font-family:inherit;font-weight:600;color:var(--fg2)}
.none{display:none;padding:48px 0;text-align:center;color:var(--fg3)}
footer{position:relative;z-index:1;margin-top:48px;color:var(--fg3);font-size:12px;text-align:center}
footer a{color:inherit}
@media (max-width:640px){.wrap{padding:0 16px 48px}.hero{padding:12px 0 18px}.count{display:none}.seg button{padding:0 10px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

const SCRIPT = `
(() => {
  const grid = document.querySelector('.grid'); if (!grid) return
  const cards = [...grid.querySelectorAll('.card')]
  const q = document.getElementById('q'), sort = document.getElementById('sort'), count = document.getElementById('count'), none = document.querySelector('.none')
  let mode = 'all'
  const rel = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000
    if (!isFinite(s)) return ''
    const f = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    for (const [u, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (s >= n) return f.format(-Math.floor(s / n), u)
    return 'just now'
  }
  for (const el of document.querySelectorAll('.when')) { const r = rel(el.dataset.iso); if (r) { el.title = new Date(el.dataset.iso).toLocaleString(); el.textContent = (el.dataset.prefix ?? 'Published ') + r } }
  const apply = () => {
    const term = (q.value || '').trim().toLowerCase()
    const key = sort.value
    const shown = cards.filter((c) => (mode === 'all' || c.dataset.access === mode) && (!term || c.dataset.title.includes(term)))
    shown.sort((a, b) => key === 'name' ? a.dataset.title.localeCompare(b.dataset.title) : key === 'pages' ? b.dataset.pages - a.dataset.pages : b.dataset.time.localeCompare(a.dataset.time))
    for (const c of cards) c.style.display = shown.includes(c) ? '' : 'none'
    shown.forEach((c, i) => { grid.appendChild(c); c.classList.toggle('feature', i === 0 && !term && mode === 'all' && key === 'new') })
    count.textContent = shown.length + ' of ' + cards.length
    none.style.display = shown.length ? 'none' : 'block'
  }
  q.addEventListener('input', apply); sort.addEventListener('change', apply)
  for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => { mode = b.dataset.mode; for (const o of document.querySelectorAll('.seg button')) o.setAttribute('aria-pressed', String(o === b)); apply() })
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus() } else if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; apply(); q.blur() } })
  // locked dashboards: their preview shows only when this browser is already signed in to that dashboard
  for (const img of document.querySelectorAll('img.probe')) {
    img.onload = () => { img.hidden = false; img.closest('.card').dataset.unlocked = '1'; img.closest('.card').querySelector('.lockmark')?.remove() }
    img.onerror = () => img.remove()
    img.src = img.dataset.src
  }
  // pointer across a card flips through its pages
  for (const c of cards) {
    const shots = JSON.parse(c.dataset.shots || '[]'); if (shots.length < 2) continue
    const media = c.querySelector('.media'), dots = [...c.querySelectorAll('.scrub i')], name = c.querySelector('.pname')
    let loaded = false, cur = 0
    const show = (k) => {
      const img = c.querySelector('img.shot'); if (!img || img.hidden || k === cur) return
      cur = k; img.src = shots[k].src; dots.forEach((d, j) => d.classList.toggle('on', j === k)); if (name) name.textContent = shots[k].name
    }
    media.addEventListener('pointerenter', () => { if (loaded) return; loaded = true; if (c.dataset.access === 'public' || c.dataset.unlocked) for (const s of shots.slice(1)) { const i = new Image(); i.src = s.src } })
    media.addEventListener('pointermove', (e) => { const r = media.getBoundingClientRect(); show(Math.min(shots.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * shots.length)))) })
    media.addEventListener('pointerleave', () => show(0))
  }
  apply()
})()
`

const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z"/></svg>'

/** The home page: header, search/filter/sort bar, and the gallery (or an empty state). */
export function homePage({ title, dashboards }) {
  const n = dashboards.length
  const locked = dashboards.filter((d) => d.access === 'password').length
  const pages = dashboards.reduce((s, d) => s + (d.pages?.length || d.previews?.length || 0), 0)
  const latest = dashboards[0]?.publishedAt
  const body = n
    ? `<div class="bar" role="search">
<label class="search">${SEARCH}<input id="q" type="search" placeholder="Search dashboards and pages" aria-label="Search dashboards" autocomplete="off"><kbd>/</kbd></label>
<div class="seg" role="group" aria-label="Show"><button type="button" data-mode="all" aria-pressed="true">All</button><button type="button" data-mode="public" aria-pressed="false">Open</button><button type="button" data-mode="password" aria-pressed="false">Locked</button></div>
<select id="sort" class="sort" aria-label="Sort"><option value="new">Newest first</option><option value="name">Name A–Z</option><option value="pages">Most pages</option></select>
<span class="count" id="count" aria-live="polite"></span>
</div>
<div class="grid">${dashboards.map(card).join('')}</div>
<div class="none">No dashboards match.</div>`
    : `<div class="empty">${coverArt('empty').replace('class="art"', 'class="art" style="position:static;width:220px;height:auto;opacity:.6;mix-blend-mode:normal;filter:invert(.5)"')}<h2>No dashboards yet</h2><p>Publish one from Lumen: <code>File › Publish › Add destination › Lumen Server</code>. It shows up here with a preview of every page.</p></div>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Lumen Server"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#117865"/><path fill="#fff" d="M6 18v-7h2.5v7H6Zm4.75 0V6h2.5v12h-2.5ZM15.5 18v-5H18v5h-2.5Z"/></svg>')}">
<style>${CSS}</style></head><body>
<div class="aurora" aria-hidden="true"><b></b><b></b><b></b></div>
<div class="wrap">
<header class="top"><div class="brand"><div class="logo">${LOGO}</div>${esc(title)}</div></header>
<section class="hero"><h1><span>${esc(title)}</span></h1>${n ? `<p><strong>${n}</strong> dashboard${n === 1 ? '' : 's'} · <strong>${pages}</strong> page${pages === 1 ? '' : 's'}${locked ? ` · ${locked} password protected` : ''}${latest ? ` · last published <span class="when" data-prefix="" data-iso="${esc(latest)}">${esc(String(latest).slice(0, 10))}</span>` : ''}</p>` : ''}</section>
${body}
<footer>Published with Lumen</footer>
</div>
<script>${SCRIPT}</script>
</body></html>`
}

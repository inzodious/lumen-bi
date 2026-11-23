/**
 * The public side of Lumen Server: the gallery (/), collections (/collections, /c/<tag>), a dashboard's details page
 * (/dashboards/<slug>) and the password page, all in the shared shell (ui.mjs).
 *
 * Previews are the JPEGs Lumen renders while publishing (site/previews/<n>.jpg, listed in lumen-publish.json as
 * `previews`). Moving the pointer across a card flips through its pages. A dashboard that is not public never shows its
 * preview to someone who may not open it: its card shows a generated cover, and the real preview is only requested
 * from /d/<slug>/previews/… (401 without access) and shown if it loads.
 */
import { ICON, esc, shell, cardPage } from './ui.mjs'

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

export const tagUrl = (t) => `/c/${encodeURIComponent(String(t).toLowerCase())}`
const detailUrl = (d) => `/dashboards/${d.slug}`
const ACCESS = { public: ['Open', 'globe', 'public'], password: ['Password', 'lock', 'password'], users: ['Private', 'users', 'users'] }

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

/** Abstract report shapes for a cover without a preview (no data, a hint of a report). */
function coverArt(slug) {
  let h = 0
  for (const ch of String(slug)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const bars = Array.from({ length: 7 }, (_, i) => 18 + (((h >>> (i * 3)) & 7) * 7))
  const pts = Array.from({ length: 8 }, (_, i) => `${24 + i * 22},${120 - (((h >>> (i * 2 + 5)) & 7) * 5)}`).join(' ')
  return `<svg class="art" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect x="14" y="14" width="88" height="40" rx="6" class="a1"/><rect x="116" y="14" width="88" height="40" rx="6" class="a1"/><rect x="218" y="14" width="88" height="40" rx="6" class="a1"/><rect x="14" y="66" width="190" height="120" rx="6" class="a2"/><polyline points="${pts}" class="ln"/><rect x="218" y="66" width="88" height="120" rx="6" class="a2"/>${bars.map((b, i) => `<rect x="${226 + i * 11}" y="${178 - b}" width="7" height="${b}" rx="2" class="br"/>`).join('')}</svg>`
}

function pageNames(d) {
  return (d.pages?.length ? d.pages.map((p) => p.displayName || p.name) : (d.previews ?? []).map((p) => p.displayName)).filter(Boolean)
}

/** The preview area of a card or spotlight: generated cover, the first preview (or a probe for a locked one), page scrubber. */
function media(d, { eager = false, big = false } = {}) {
  const locked = d.access !== 'public'
  const [h1, h2] = hues(d.slug)
  const shots = (d.previews ?? []).map((p) => ({ src: p.src, name: p.displayName }))
  const img = shots[0]
  const pic = img
    ? locked
      ? `<img class="shot probe" alt="" data-src="${esc(img.src)}" hidden>`
      : `<img class="shot" alt="${esc(`${d.title}: ${img.name || 'first page'}`)}" src="${esc(img.src)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`
    : ''
  const [label, icon, cls] = ACCESS[d.access] ?? ACCESS.users
  return `<div class="media${big ? ' big' : ''}" style="--h1:${h1};--h2:${h2}" data-shots="${esc(JSON.stringify(shots))}" data-access="${locked ? 'locked' : 'public'}">
<div class="cover">${coverArt(d.slug)}<div class="mono">${esc(initials(d.title))}</div>${locked ? `<div class="lockmark">${ICON[icon]}<span>${esc(label === 'Private' ? 'Sign in to view' : 'Password protected')}</span></div>` : ''}</div>
${pic}<div class="shade"></div>
<div class="badges">${d.featured ? `<span class="chip star">${ICON.star}Featured</span>` : ''}<span class="chip ${cls}">${ICON[icon]}${label}</span></div>
${shots.length > 1 ? `<div class="scrub">${shots.map((_, k) => `<i${k === 0 ? ' class="on"' : ''}></i>`).join('')}</div><div class="pname">${esc(shots[0].name)}</div>` : ''}
</div>`
}

function card(d, i) {
  const names = pageNames(d)
  const pageCount = d.pages?.length || d.previews?.length || 0
  const search = [d.title, d.slug, d.description, ...(d.tags ?? []), ...names].join(' ').toLowerCase()
  return `<article class="card" data-search="${esc(search)}" data-access="${d.access === 'public' ? 'public' : 'locked'}" data-i="${i}" data-name="${esc(d.title.toLowerCase())}" data-pages="${pageCount}" data-time="${esc(d.publishedAt)}" style="--i:${Math.min(i, 12)}">
<a class="stretch" href="${esc(d.url)}" aria-label="Open ${esc(d.title)}"></a>
${media(d, { eager: i < 6 })}
<div class="body">
<div class="row1"><h3 class="t">${esc(d.title)}</h3><a class="info" href="${detailUrl(d)}" title="Details" aria-label="Details for ${esc(d.title)}">${ICON.info}</a></div>
${d.description ? `<p class="desc">${esc(d.description)}</p>` : ''}
<div class="meta"><span>${ICON.pages}${pageCount} page${pageCount === 1 ? '' : 's'}</span><span data-rel="${esc(d.publishedAt)}" data-prefix="Updated ">${esc(String(d.publishedAt).slice(0, 10))}</span></div>
${d.tags?.length ? `<div class="tags">${d.tags.slice(0, 4).map((t) => `<a class="chip" href="${tagUrl(t)}">${ICON.tag}${esc(t)}</a>`).join('')}</div>` : ''}
</div>
</article>`
}

const GALLERY_CSS = `
.hero{display:grid;grid-template-columns:minmax(0,1fr);gap:28px;padding:30px 0 10px}
.hero h1{font-size:clamp(34px,5.4vw,62px);font-weight:700;letter-spacing:-.03em;line-height:1.02}
.hero h1 em{font-style:normal;background:linear-gradient(100deg,var(--fg) 20%,var(--accent) 75%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .tagline{font-size:clamp(16px,1.6vw,19px);color:var(--fg2);margin:14px 0 0;max-width:680px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.stat{display:flex;align-items:baseline;gap:8px;padding:10px 16px;border-radius:12px;background:var(--surface);border:1px solid var(--line)}
.stat b{font-family:var(--head);font-size:22px}.stat span{color:var(--fg3);font-size:13px}
.spot{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);gap:0;overflow:hidden;margin:26px 0 6px;position:relative}
.spot-text{padding:34px;display:flex;flex-direction:column;justify-content:center;gap:14px;min-width:0}
.eyebrow{display:inline-flex;align-items:center;gap:7px;color:var(--accent);font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.eyebrow svg{width:14px;height:14px}
.spot-text h2{font-size:clamp(24px,2.6vw,34px)}
.spot-text p{color:var(--fg2);margin:0;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.spot-text .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.spot .media{aspect-ratio:16/9;border-radius:0;border-left:1px solid var(--line2)}
.spot-slide{display:contents}.spot-slide[hidden]{display:none}
.spot-dots{position:absolute;left:34px;bottom:22px;display:flex;gap:6px}
.spot-dots button{width:26px;height:4px;border:0;border-radius:2px;background:var(--line);cursor:pointer;padding:0}.spot-dots button[aria-current=true]{background:var(--accent)}
.colls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:26px 0 4px}
.colls .chip{height:32px;padding:0 13px;font-size:13px}.colls .chip[aria-current=page]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.colls .lbl{color:var(--fg3);font-size:13px;font-weight:600;margin-right:4px}
.toolbar{position:sticky;top:var(--top);z-index:20;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px 0;margin:6px 0 18px;background:linear-gradient(var(--bg) 70%,transparent)}
.filter{flex:1 1 260px;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.filter:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px var(--soft)}.filter svg{color:var(--fg3)}
.filter input{border:0;background:none;height:38px;padding:0;box-shadow:none!important}
.sort{width:auto;height:40px;padding:0 34px 0 12px;appearance:none;background:var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23888' d='m7 10 5 5 5-5z'/%3E%3C/svg%3E") right 8px center/18px no-repeat;cursor:pointer}
.count{color:var(--fg3);font-size:13px;margin-left:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:22px}
.card[hidden]{display:none!important}
.card{position:relative;display:flex;flex-direction:column;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden;transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,border-color .35s;animation:rise .55s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i) * 40ms)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}}
.card:hover,.card:focus-within{transform:translateY(-4px);box-shadow:var(--shadow-lg);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.stretch{position:absolute;inset:0;z-index:2;border-radius:inherit}
.card .info,.card .tags a{position:relative;z-index:3}
.media{position:relative;aspect-ratio:16/9;overflow:hidden;background:var(--bg2)}
.cover{position:absolute;inset:0;background:radial-gradient(120% 120% at 0% 0%,hsl(var(--h1) 62% 50%) 0,transparent 55%),radial-gradient(120% 120% at 100% 100%,hsl(var(--h2) 62% 42%) 0,transparent 60%),hsl(var(--h1) 28% 16%)}
.cover .art{position:absolute;inset:8%;width:84%;height:84%;opacity:.5;mix-blend-mode:screen}
.cover .a1{fill:#ffffff26}.cover .a2{fill:#ffffff1a}.cover .br{fill:#ffffff8c}.cover .ln{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
.cover .mono{position:absolute;right:16px;bottom:8px;font:800 64px/1 var(--head);letter-spacing:-.04em;color:#ffffff2b}
.media.big .cover .mono{font-size:140px}
.lockmark{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:8px;color:#fff;background:#00000033;backdrop-filter:blur(2px)}
.lockmark svg{width:34px;height:34px;filter:drop-shadow(0 4px 12px #0006)}.lockmark span{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center;background:#fff;transition:transform .6s cubic-bezier(.2,.8,.2,1)}
.card:hover .shot{transform:scale(1.03)}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,#0000 55%,#00000080 100%);opacity:0;transition:opacity .3s}
.card:hover .shade,.spot:hover .shade{opacity:1}
.badges{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:6px;justify-content:flex-end}
.badges .chip{background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px);box-shadow:0 2px 8px #00000026}
.badges .chip.star{margin-right:auto}
.scrub{position:absolute;left:14px;right:14px;bottom:12px;display:flex;gap:4px;opacity:0;transition:opacity .25s}
.scrub i{flex:1;height:3px;border-radius:2px;background:#ffffff59}.scrub i.on{background:#fff}
.pname{position:absolute;left:14px;bottom:22px;color:#fff;font-size:12.5px;font-weight:600;text-shadow:0 1px 4px #0009;opacity:0;transition:opacity .25s}
.card:hover .scrub,.card:hover .pname,.spot:hover .scrub,.spot:hover .pname{opacity:1}
.body{padding:15px 16px 16px;display:flex;flex-direction:column;gap:7px;flex:1}
.row1{display:flex;align-items:flex-start;gap:8px}
.t{flex:1;font-size:16.5px;font-weight:650;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.info{width:30px;height:30px;margin:-3px -4px 0 0;border-radius:8px;display:grid;place-items:center;color:var(--fg3);flex:none}.info:hover{background:var(--line2);color:var(--accent)}.info svg{width:17px;height:17px}
.desc{margin:0;color:var(--fg2);font-size:13.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta{display:flex;gap:14px;color:var(--fg3);font-size:12.5px;margin-top:auto;padding-top:2px}.meta span{display:inline-flex;align-items:center;gap:5px}.meta svg{width:14px;height:14px}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.grid.list{grid-template-columns:1fr;gap:10px}
.grid.list .card{flex-direction:row;align-items:stretch}
.grid.list .media{width:220px;flex:none;aspect-ratio:16/9}
.grid.list .badges .chip:not(.star){display:none}
.none{display:none;padding:56px 0;text-align:center;color:var(--fg3)}
@media (max-width:900px){.spot{grid-template-columns:1fr}.spot .media{order:-1;border-left:0;border-bottom:1px solid var(--line2)}.spot-text{padding:22px 22px 40px}.spot-dots{left:22px;bottom:16px}}
@media (max-width:640px){.grid{grid-template-columns:1fr}.grid.list .media{width:120px}.grid.list .desc,.grid.list .tags{display:none}.count{display:none}.hero{padding-top:18px}}
`

const GALLERY_SCRIPT = `
(() => {
  const grid = document.querySelector('.grid')
  // locked dashboards: their preview shows only when this browser may open the dashboard
  for (const img of document.querySelectorAll('img.probe')) {
    img.onload = () => { img.hidden = false; const m = img.closest('.media'); m.dataset.unlocked = '1'; m.querySelector('.lockmark')?.remove() }
    img.onerror = () => img.remove()
    img.src = img.dataset.src
  }
  // pointer across a preview flips through its pages
  for (const m of document.querySelectorAll('.media[data-shots]')) {
    const shots = JSON.parse(m.dataset.shots || '[]'); if (shots.length < 2) continue
    const dots = [...m.querySelectorAll('.scrub i')], name = m.querySelector('.pname'), host = m.closest('.card') || m
    let loaded = false, cur = 0
    const show = (k) => { const img = m.querySelector('img.shot'); if (!img || img.hidden || k === cur) return; cur = k; img.src = shots[k].src; dots.forEach((d, j) => d.classList.toggle('on', j === k)); if (name) name.textContent = shots[k].name }
    host.addEventListener('pointerenter', () => { if (loaded) return; loaded = true; if (m.dataset.access === 'public' || m.dataset.unlocked) for (const s of shots.slice(1)) { const i = new Image(); i.src = s.src } })
    host.addEventListener('pointermove', (e) => { const r = m.getBoundingClientRect(); if (e.clientY > r.bottom) return; show(Math.min(shots.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * shots.length)))) })
    host.addEventListener('pointerleave', () => show(0))
  }
  // spotlight: several featured dashboards rotate
  const slides = [...document.querySelectorAll('.spot-slide')], sdots = [...document.querySelectorAll('.spot-dots button')]
  if (slides.length > 1) {
    let at = 0, timer
    const go = (k) => { at = (k + slides.length) % slides.length; slides.forEach((s, j) => (s.hidden = j !== at)); sdots.forEach((d, j) => d.setAttribute('aria-current', String(j === at))) }
    const auto = () => { clearInterval(timer); timer = setInterval(() => go(at + 1), 7000) }
    sdots.forEach((d, j) => d.addEventListener('click', () => { go(j); auto() }))
    document.querySelector('.spot').addEventListener('pointerenter', () => clearInterval(timer)); document.querySelector('.spot').addEventListener('pointerleave', auto)
    auto()
  }
  if (!grid) return
  const cards = [...grid.querySelectorAll('.card')]
  const q = document.getElementById('q'), sort = document.getElementById('sort'), count = document.getElementById('count'), none = document.querySelector('.none')
  let mode = 'all'
  const store = (k, v) => { try { v === undefined ? (v = localStorage.getItem(k)) : localStorage.setItem(k, v) } catch {} return v }
  const setView = (v) => { grid.classList.toggle('list', v === 'list'); for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === v)); store('lumen.view', v) }
  setView(store('lumen.view') || 'grid')
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view))
  const apply = () => {
    const term = (q.value || '').trim().toLowerCase(), key = sort.value
    const shown = cards.filter((c) => (mode === 'all' || c.dataset.access === mode) && (!term || term.split(/\\s+/).every((w) => c.dataset.search.includes(w))))
    shown.sort((a, b) => key === 'name' ? a.dataset.name.localeCompare(b.dataset.name) : key === 'pages' ? b.dataset.pages - a.dataset.pages : key === 'new' ? b.dataset.time.localeCompare(a.dataset.time) : a.dataset.i - b.dataset.i)
    for (const c of cards) c.hidden = !shown.includes(c)
    shown.forEach((c) => grid.appendChild(c))
    count.textContent = shown.length === cards.length ? cards.length + ' dashboard' + (cards.length === 1 ? '' : 's') : shown.length + ' of ' + cards.length
    none.style.display = shown.length ? 'none' : 'block'
  }
  q.addEventListener('input', apply); sort.addEventListener('change', apply)
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { mode = b.dataset.mode; for (const o of document.querySelectorAll('[data-mode]')) o.setAttribute('aria-pressed', String(o === b)); apply() })
  apply()
})()
`

/** Command palette entries for dashboards a visitor may see (and their pages, and collections). */
export function paletteIndex(dashboards) {
  const out = []
  for (const d of dashboards) {
    out.push({ g: 'Dashboards', t: d.title, s: [d.access === 'public' ? 'Open' : d.access === 'password' ? 'Password' : 'Private', ...(d.tags ?? [])].join(' · '), u: d.url, i: d.access === 'public' ? 'dash' : 'lock', k: `${d.slug} ${d.description ?? ''}` })
  }
  for (const d of dashboards) for (const p of pageNames(d).slice(0, 12)) out.push({ g: 'Pages', t: p, s: d.title, u: detailUrl(d), i: 'pages' })
  for (const [t, n] of collections(dashboards)) out.push({ g: 'Collections', t, s: `${n} dashboard${n === 1 ? '' : 's'}`, u: tagUrl(t), i: 'folder' })
  return out
}

/** Tags with how many dashboards carry them, most used first. */
export function collections(dashboards) {
  const m = new Map()
  for (const d of dashboards) for (const t of d.tags ?? []) {
    const k = t.toLowerCase()
    const e = m.get(k) ?? [t, 0]
    e[1]++
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function spotlight(featured) {
  if (!featured.length) return ''
  const slides = featured.slice(0, 5).map((d, i) => `<div class="spot-slide"${i ? ' hidden' : ''}><div class="spot-text"><span class="eyebrow">${ICON.star}Featured</span><h2>${esc(d.title)}</h2>${d.description ? `<p>${esc(d.description)}</p>` : ''}${d.tags?.length ? `<div class="tags">${d.tags.slice(0, 4).map((t) => `<a class="chip" href="${tagUrl(t)}">${ICON.tag}${esc(t)}</a>`).join('')}</div>` : ''}<div class="actions"><a class="btn lg" href="${esc(d.url)}">Open dashboard${ICON.arrow}</a><a class="btn ghost lg" href="${detailUrl(d)}">Details</a></div></div>${media(d, { eager: i === 0, big: true })}</div>`)
  return `<section class="spot panel" aria-label="Featured dashboards">${slides.join('')}${featured.length > 1 ? `<div class="spot-dots">${featured.slice(0, 5).map((d, i) => `<button type="button" aria-label="Show ${esc(d.title)}" aria-current="${i === 0}"></button>`).join('')}</div>` : ''}</section>`
}

function galleryBody(dashboards, { tag = '' } = {}) {
  if (!dashboards.length)
    return `<div class="empty"><div class="ill">${ICON.dash}</div><h2>${tag ? 'No dashboards in this collection' : 'No dashboards yet'}</h2><p>${tag ? 'Tags are set per dashboard in the admin console.' : 'Publish one from Lumen: File › Publish › Add destination › Lumen Server. It shows up here with a preview of every page.'}</p>${tag ? '<a class="btn ghost" href="/">All dashboards</a>' : ''}</div>`
  const locked = dashboards.some((d) => d.access !== 'public')
  return `<div class="toolbar" role="search">
<label class="filter">${ICON.search}<input id="q" type="search" placeholder="Filter by name, page or tag" aria-label="Filter dashboards" autocomplete="off"></label>
${locked ? `<div class="seg" role="group" aria-label="Show"><button type="button" data-mode="all" aria-pressed="true">All</button><button type="button" data-mode="public" aria-pressed="false">${ICON.globe}Open</button><button type="button" data-mode="locked" aria-pressed="false">${ICON.lock}Locked</button></div>` : ''}
<select id="sort" class="sort" aria-label="Sort"><option value="placement">Recommended</option><option value="new">Newest</option><option value="name">Name A–Z</option><option value="pages">Most pages</option></select>
<div class="seg" role="group" aria-label="View"><button type="button" data-view="grid" aria-pressed="true" aria-label="Grid">${ICON.grid}</button><button type="button" data-view="list" aria-pressed="false" aria-label="List">${ICON.list}</button></div>
<span class="count" id="count" aria-live="polite"></span>
</div>
<div class="grid">${dashboards.map(card).join('')}</div>
<div class="none">No dashboards match. <a href="#" onclick="document.getElementById('q').value='';document.getElementById('q').dispatchEvent(new Event('input'));return false">Clear the filter</a></div>`
}

function collectionChips(dashboards, current = '') {
  const cs = collections(dashboards)
  if (!cs.length) return ''
  return `<nav class="colls" aria-label="Collections"><span class="lbl">Collections</span><a class="chip"${current ? '' : ' aria-current="page"'} href="/">All</a>${cs
    .slice(0, 14)
    .map(([t, n]) => `<a class="chip" href="${tagUrl(t)}"${current.toLowerCase() === t.toLowerCase() ? ' aria-current="page"' : ''}>${esc(t)} <span style="opacity:.6">${n}</span></a>`)
    .join('')}${cs.length > 14 ? '<a class="chip" href="/collections">More…</a>' : ''}</nav>`
}

/** The gallery: hero, featured spotlight, collections, filters and every dashboard the visitor may see. */
export function homePage({ site, user, authEnabled, dashboards }) {
  const pages = dashboards.reduce((s, d) => s + (d.pages?.length || d.previews?.length || 0), 0)
  const featured = dashboards.filter((d) => d.featured)
  const latest = [...dashboards].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))[0]
  const hero = `<section class="hero"><div><h1><em>${esc(site.title)}</em></h1>${site.tagline ? `<p class="tagline">${esc(site.tagline)}</p>` : ''}${
    dashboards.length
      ? `<div class="stats"><div class="stat"><b>${dashboards.length}</b><span>dashboard${dashboards.length === 1 ? '' : 's'}</span></div><div class="stat"><b>${pages}</b><span>page${pages === 1 ? '' : 's'}</span></div>${collections(dashboards).length ? `<div class="stat"><b>${collections(dashboards).length}</b><span>collections</span></div>` : ''}${latest ? `<div class="stat"><span>Last update</span><b style="font-size:15px" data-rel="${esc(latest.publishedAt)}">${esc(String(latest.publishedAt).slice(0, 10))}</b></div>` : ''}</div>`
      : ''
  }</div></section>`
  return shell({
    site,
    user,
    authEnabled,
    nav: 'dashboards',
    index: paletteIndex(dashboards),
    css: GALLERY_CSS,
    body: `${hero}${spotlight(featured)}${collectionChips(dashboards)}${galleryBody(dashboards)}`,
    script: GALLERY_SCRIPT
  })
}

/** /c/<tag>: one collection. */
export function collectionPage({ site, user, authEnabled, dashboards, all, tag }) {
  return shell({
    site,
    user,
    authEnabled,
    nav: 'collections',
    title: tag,
    crumbs: [['Dashboards', '/'], ['Collections', '/collections'], [tag]],
    index: paletteIndex(all),
    css: GALLERY_CSS,
    body: `<div class="head"><div><h1>${esc(tag)}</h1><p>${dashboards.length} dashboard${dashboards.length === 1 ? '' : 's'} in this collection.</p></div></div>${collectionChips(all, tag)}${galleryBody(dashboards, { tag })}`,
    script: GALLERY_SCRIPT
  })
}

/** /collections: every tag as a tile with a mosaic of its dashboards. */
export function collectionsPage({ site, user, authEnabled, dashboards }) {
  const cs = collections(dashboards)
  const tiles = cs
    .map(([t, n]) => {
      const ds = dashboards.filter((d) => d.tags?.some((x) => x.toLowerCase() === t.toLowerCase()))
      const mosaic = ds
        .slice(0, 3)
        .map((d) => {
          const [h1, h2] = hues(d.slug)
          const src = d.access === 'public' && d.previews?.[0]?.src
          return `<div class="mo" style="--h1:${h1};--h2:${h2}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''}</div>`
        })
        .join('')
      return `<a class="coll panel" href="${tagUrl(t)}"><div class="mosaic n${Math.min(3, ds.length)}">${mosaic}</div><div class="cb"><h2>${esc(t)}</h2><span>${n} dashboard${n === 1 ? '' : 's'}</span></div></a>`
    })
    .join('')
  const css = `.colgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.coll{display:block;text-decoration:none;overflow:hidden;transition:transform .3s,box-shadow .3s,border-color .3s}.coll:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.mosaic{display:grid;gap:3px;aspect-ratio:16/9;background:var(--line2)}.mosaic.n2{grid-template-columns:1fr 1fr}.mosaic.n3{grid-template-columns:2fr 1fr;grid-template-rows:1fr 1fr}.mosaic.n3 .mo:first-child{grid-row:span 2}
.mo{position:relative;overflow:hidden;background:radial-gradient(120% 120% at 0% 0%,hsl(var(--h1) 62% 50%) 0,transparent 55%),hsl(var(--h2) 30% 22%)}.mo img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.cb{padding:16px 18px;display:flex;align-items:baseline;justify-content:space-between;gap:10px}.cb h2{font-size:19px}.cb span{color:var(--fg3);font-size:13px;white-space:nowrap}`
  return shell({
    site,
    user,
    authEnabled,
    nav: 'collections',
    title: 'Collections',
    crumbs: [['Dashboards', '/'], ['Collections']],
    index: paletteIndex(dashboards),
    css,
    body: `<div class="head"><div><h1>Collections</h1><p>Dashboards grouped by topic.</p></div></div>${
      tiles ? `<div class="colgrid">${tiles}</div>` : `<div class="empty"><div class="ill">${ICON.folder}</div><h2>No collections yet</h2><p>Collections come from the tags on each dashboard${user ? '. Add tags in the admin console.' : '.'}</p>${user ? '<a class="btn" href="/admin">Open the admin console</a>' : ''}</div>`
    }`
  })
}

/** /dashboards/<slug>: one dashboard's details: pages, description, tags, related dashboards. */
export function detailPage({ site, user, authEnabled, d, all, canOpen }) {
  const names = pageNames(d)
  const shots = (d.previews ?? []).map((p) => ({ src: p.src, name: p.displayName }))
  const showShots = canOpen && shots.length
  const related = all.filter((x) => x.slug !== d.slug && x.tags?.some((t) => d.tags?.some((u) => u.toLowerCase() === t.toLowerCase()))).slice(0, 3)
  const [label, icon, cls] = ACCESS[d.access] ?? ACCESS.users
  const [h1, h2] = hues(d.slug)
  const viewer = showShots
    ? `<div class="pv panel"><div class="pv-main"><img id="pv-img" src="${esc(shots[0].src)}" alt="${esc(shots[0].name)}"></div>${shots.length > 1 ? `<div class="pv-strip" role="tablist" aria-label="Pages">${shots.map((s, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-src="${esc(s.src)}" data-name="${esc(s.name)}"><img src="${esc(s.src)}" alt="" loading="lazy"><span>${esc(s.name)}</span></button>`).join('')}</div>` : ''}</div>`
    : `<div class="pv panel"><div class="media big" style="--h1:${h1};--h2:${h2};aspect-ratio:16/9"><div class="cover">${coverArt(d.slug)}<div class="mono">${esc(initials(d.title))}</div><div class="lockmark">${ICON[icon]}<span>${d.access === 'users' ? 'Sign in to view' : 'Password protected'}</span></div></div></div></div>`
  const css = `${GALLERY_CSS}
.dt{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,.8fr);gap:24px;align-items:start}
.pv{overflow:hidden}.pv-main{background:#fff;aspect-ratio:16/9;display:grid;place-items:center}.pv-main img{width:100%;height:100%;object-fit:contain;display:block}
.pv-strip{display:flex;gap:10px;padding:12px;overflow-x:auto;border-top:1px solid var(--line2)}
.pv-strip button{flex:none;width:150px;padding:0;border:2px solid transparent;border-radius:10px;background:none;cursor:pointer;color:var(--fg2);font:500 12px/1.3 var(--body);text-align:left}
.pv-strip img{width:100%;aspect-ratio:16/9;object-fit:cover;object-position:top;border-radius:8px;display:block;border:1px solid var(--line);background:#fff}
.pv-strip span{display:block;padding:6px 2px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-strip [aria-selected=true]{color:var(--accent)}.pv-strip [aria-selected=true] img{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}
.side-info{padding:22px;position:sticky;top:calc(var(--top) + 16px);display:flex;flex-direction:column;gap:16px}
.side-info h2{font-size:13px;font-family:var(--body);text-transform:uppercase;letter-spacing:.07em;color:var(--fg3);font-weight:700}
.side-info .actions{display:grid;gap:8px}.side-info .btn{width:100%}
dl.facts{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin:0;font-size:13.5px}dl.facts dt{color:var(--fg3)}dl.facts dd{margin:0;font-weight:500;text-align:right}
.pagelist{list-style:none;margin:0;padding:0;display:grid;gap:4px}.pagelist li{display:flex;gap:10px;align-items:center;padding:7px 10px;border-radius:8px;background:var(--surface2);font-size:13.5px}.pagelist li b{color:var(--fg3);font-weight:600;width:18px}
.lede{font-size:16px;color:var(--fg2);max-width:760px;margin:10px 0 0}
.rel{margin-top:40px}.rel h2{font-size:20px;margin-bottom:16px}
@media (max-width:900px){.dt{grid-template-columns:1fr}.side-info{position:static}}`
  const script = `${GALLERY_SCRIPT};(() => { const img = document.getElementById('pv-img'); for (const b of document.querySelectorAll('.pv-strip button')) b.addEventListener('click', () => { img.src = b.dataset.src; img.alt = b.dataset.name; for (const o of document.querySelectorAll('.pv-strip button')) o.setAttribute('aria-selected', String(o === b)) }) })()`
  const body = `<div class="head"><div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${d.featured ? `<span class="chip star">${ICON.star}Featured</span>` : ''}<span class="chip ${cls}">${ICON[icon]}${label}</span></div><h1>${esc(d.title)}</h1>${d.description ? `<p class="lede">${esc(d.description)}</p>` : ''}</div></div>
<div class="dt"><div>${viewer}</div>
<aside class="side-info panel"><div class="actions"><a class="btn lg" href="${esc(d.url)}">${d.access === 'public' || canOpen ? 'Open dashboard' : d.access === 'password' ? 'Enter password' : 'Sign in to open'}${ICON.arrow}</a><button class="btn ghost" type="button" data-copy="${esc(d.url)}">${ICON.copy}Copy link</button>${user ? `<a class="btn quiet" href="/admin/d/${d.slug}">${ICON.edit}Edit in admin</a>` : ''}</div>
<div><h2>About</h2><dl class="facts" style="margin-top:10px"><dt>Pages</dt><dd>${names.length || shots.length}</dd><dt>Updated</dt><dd data-rel="${esc(d.publishedAt)}">${esc(String(d.publishedAt).slice(0, 10))}</dd><dt>Access</dt><dd>${label}</dd></dl></div>
${d.tags?.length ? `<div><h2>Collections</h2><div class="tags" style="margin-top:10px">${d.tags.map((t) => `<a class="chip" href="${tagUrl(t)}">${ICON.tag}${esc(t)}</a>`).join('')}</div></div>` : ''}
${names.length ? `<div><h2>Pages</h2><ol class="pagelist" style="margin-top:10px">${names.map((n, i) => `<li><b>${i + 1}</b>${esc(n)}</li>`).join('')}</ol></div>` : ''}
</aside></div>
${related.length ? `<section class="rel"><h2>Related dashboards</h2><div class="grid">${related.map(card).join('')}</div></section>` : ''}`
  return shell({
    site,
    user,
    authEnabled,
    nav: 'dashboards',
    title: d.title,
    crumbs: [['Dashboards', '/'], ...(d.tags?.[0] ? [[d.tags[0], tagUrl(d.tags[0])]] : []), [d.title]],
    index: paletteIndex(all),
    css,
    body,
    script
  })
}

/** The password page in front of a password-protected dashboard. */
export function passwordPage({ site, user, authEnabled, d, error }) {
  return cardPage({
    site,
    user,
    authEnabled,
    nav: 'dashboards',
    title: d.title,
    crumbs: [['Dashboards', '/'], [d.title, `/dashboards/${d.slug}`], ['Password']],
    icon: 'lock',
    body: `<h1>${esc(d.title)}</h1><p>This dashboard is password protected. Enter the password to open it.</p><form method="post" action="/d/${d.slug}/login"><label class="f" for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}<div class="actions"><button class="btn" type="submit">Open dashboard${ICON.arrow}</button><a class="btn ghost" href="/">${ICON.back}All dashboards</a></div></form>${authEnabled && !user ? `<p class="hint" style="margin:18px 0 0">Approved account? <a href="/auth/login?next=${encodeURIComponent(`/d/${d.slug}/`)}">Sign in with Google</a> instead.</p>` : ''}`
  })
}

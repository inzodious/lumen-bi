/**
 * The admin console (/admin), for approved Google accounts: every dashboard on the server with how it shows, who can
 * open it, whether it is listed or featured on the home page, whether other sites may embed it, and the site's own
 * settings. Rendered in the shared shell (ui.mjs) with the admin sidebar.
 *
 *   GET  /admin                     dashboards: stats, filters, quick toggles
 *   POST /admin/d/<slug>/quick      one quick change from the list (featured, listed, embed, access); JSON
 *   GET  /admin/d/<slug>            one dashboard: Details, Access, Embedding, Danger zone
 *   POST /admin/d/<slug>            save them
 *   POST /admin/d/<slug>/delete     remove the dashboard
 *   GET  /admin/settings            branding (title, tagline, theme, accent), home page, defaults, integrations
 *   POST /admin/settings            save them
 *
 * Changes are kept in meta.json under `custom` (republishing from Lumen keeps them) and in settings.json.
 */
import { promises as fsp } from 'node:fs'
import { hashPassword, safeEqual } from './server.mjs'
import { ICON, THEMES, esc, shell } from './ui.mjs'

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
const ACCESS = { public: ['Public', 'globe'], users: ['Private', 'users'], password: ['Password', 'lock'] }

/** Allowed embedding sites from a textarea: origins only (https://site.example), one per line or comma. */
export function parseOrigins(raw) {
  const out = []
  for (const part of String(raw ?? '').split(/[\s,]+/)) {
    if (!part) continue
    try {
      const u = new URL(part.includes('://') ? part : `https://${part}`)
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !out.includes(u.origin)) out.push(u.origin)
    } catch {
      /* ignore */
    }
  }
  return out.slice(0, 20)
}

export function parseTags(raw) {
  return [...new Set(String(raw ?? '').split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 12).map((t) => t.slice(0, 40))
}

const ADMIN_CSS = `
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:22px}
.tile{display:flex;flex-direction:column;gap:4px;padding:16px 18px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line);text-align:left;font:inherit;color:inherit;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .15s}
.tile:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));transform:translateY(-1px)}
.tile[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
.tile span{display:flex;align-items:center;gap:7px;color:var(--fg3);font-size:12.5px;font-weight:600}.tile span svg{width:15px;height:15px}
.tile b{font:700 28px/1.1 var(--head)}
.tbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.filter{flex:1 1 260px;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.filter:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px var(--soft)}.filter svg{color:var(--fg3)}.filter input{border:0;background:none;height:38px;padding:0;box-shadow:none!important}
.tablewrap{overflow-x:auto;border-radius:var(--radius);border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow)}
table.dt{width:100%;border-collapse:collapse;min-width:860px}
.dt th{position:sticky;top:0;text-align:left;padding:11px 14px;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg3);background:var(--surface2);border-bottom:1px solid var(--line)}
.dt td{padding:12px 14px;border-bottom:1px solid var(--line2);vertical-align:middle}.dt tr:last-child td{border-bottom:0}
.dt tr:hover td{background:color-mix(in srgb,var(--soft) 45%,transparent)}
.dt tr[hidden]{display:none}
.th{width:112px;aspect-ratio:16/10;border-radius:8px;background:var(--bg2) center top/cover no-repeat;border:1px solid var(--line);display:block}
.nm a{font-weight:650;text-decoration:none;font-size:15px}.nm a:hover{color:var(--accent)}
.nm small{display:block;color:var(--fg3);font-size:12px;margin-top:2px}.nm .tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.nm .tags span{font-size:11px;padding:1px 7px;border-radius:99px;background:var(--surface2);border:1px solid var(--line2);color:var(--fg2)}
.dt select{height:32px;width:auto;padding:0 28px 0 10px;font-size:13px;border-radius:8px;appearance:none;background:var(--surface2) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23888' d='m7 10 5 5 5-5z'/%3E%3C/svg%3E") right 6px center/16px no-repeat;cursor:pointer;font-weight:600}
.dt select[data-v=public]{color:var(--ok)}.dt select[data-v=password]{color:var(--warn)}
.dt .ctr{text-align:center}.dt .act{white-space:nowrap;text-align:right}
.muted{color:var(--fg3);font-size:13px}
/* edit */
.ehead{display:flex;flex-wrap:wrap;gap:18px;align-items:center;padding:18px 0 22px}
.ehead .th{width:150px}.ehead h1{font-size:clamp(24px,3vw,32px)}.ehead .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.ehead .grow{flex:1;min-width:240px}
.ehead .acts{display:flex;gap:8px;flex-wrap:wrap}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:20px;overflow-x:auto}
.tabs button{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:none;color:var(--fg2);font:600 14px/1 var(--body);cursor:pointer;white-space:nowrap;margin-bottom:-1px}
.tabs button:hover{color:var(--fg)}.tabs button[aria-selected=true]{color:var(--accent);border-bottom-color:var(--accent)}.tabs svg{width:16px;height:16px}
.tabs .danger-tab[aria-selected=true]{color:var(--bad);border-bottom-color:var(--bad)}
.ecols{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}
.sec{padding:24px;margin-bottom:18px}.sec h2{font-size:17px;margin-bottom:4px}.sec>p{color:var(--fg3);margin:0 0 16px;font-size:13.5px}
.opts{display:grid;gap:10px}
.opt{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border:1px solid var(--line);border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s}
.opt:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.opt:has(input:checked){border-color:var(--accent);background:var(--soft)}
.opt input{margin:3px 0 0;accent-color:var(--accent)}.opt .oi{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--surface2);color:var(--fg2);flex:none}.opt:has(input:checked) .oi{background:var(--accent);color:var(--accent-fg)}
.opt b{display:block}.opt small{color:var(--fg3)}
.pwbox{margin:8px 0 0 50px}
.prev{position:sticky;top:calc(var(--top) + 16px);display:grid;gap:16px}
.prev .pc{overflow:hidden}.prev .pc .im{aspect-ratio:16/10;background:var(--bg2) center top/cover no-repeat;border-bottom:1px solid var(--line2)}
.prev .pc .pb{padding:14px 16px}.prev .pc .pt{font-weight:650;font-size:16px}.prev .pc .pd{color:var(--fg2);font-size:13px;margin-top:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.prev .pc .ptags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.prev .pc .ptags span{font-size:11.5px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--fg2)}
.prev h3{font:700 11.5px/1 var(--body);letter-spacing:.07em;text-transform:uppercase;color:var(--fg3);margin-bottom:10px}
dl.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 12px;margin:0;font-size:13px}dl.kv dt{color:var(--fg3)}dl.kv dd{margin:0;text-align:right;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.savebar{position:sticky;bottom:16px;z-index:30;display:flex;align-items:center;gap:12px;padding:12px 14px 12px 18px;margin-top:8px;border-radius:14px;background:var(--fg);color:var(--bg);box-shadow:var(--shadow-lg);transform:translateY(12px);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.savebar.on{opacity:1;transform:none;pointer-events:auto}.savebar span{flex:1;font-weight:600}.savebar .btn.ghost{background:transparent;color:var(--bg);border-color:color-mix(in srgb,var(--bg) 30%,transparent)}
.embedview{border:1px solid var(--line);border-radius:12px;overflow:hidden;aspect-ratio:16/9;background:var(--bg2)}.embedview iframe{width:100%;height:100%;border:0;display:block}
.codewrap{position:relative}.codewrap .btn{position:absolute;top:8px;right:8px}
.danger{border-color:color-mix(in srgb,var(--bad) 40%,var(--line))}.danger h2{color:var(--bad)}
.themes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.theme{display:block;border:1px solid var(--line);border-radius:14px;padding:14px;cursor:pointer;transition:border-color .15s}
.theme:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}.theme input{position:absolute;opacity:0}
.theme .sw{display:flex;height:54px;border-radius:9px;overflow:hidden;margin-bottom:12px}.theme .sw i{flex:1}
.theme b{display:block}.theme small{color:var(--fg3)}
.accentrow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.accentrow input[type=color]{width:46px;height:40px;padding:3px;border-radius:10px;border:1px solid var(--line);background:var(--surface2);cursor:pointer}
.accentrow input[type=text]{width:130px}.swatches{display:flex;gap:6px}.swatches button{width:26px;height:26px;border-radius:50%;border:2px solid var(--surface);box-shadow:0 0 0 1px var(--line);cursor:pointer;padding:0}
.mini{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--bg)}
.mini .mt{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line2);font-weight:700;font-family:var(--head)}.mini .mt i{width:22px;height:22px;border-radius:6px;background:var(--mini-accent,var(--accent))}
.mini .mb{padding:16px 14px}.mini .mb h4{margin:0;font:700 22px/1.1 var(--head)}.mini .mb p{margin:6px 0 12px;color:var(--fg3);font-size:12.5px}.mini .mb span{display:inline-block;padding:7px 12px;border-radius:8px;background:var(--mini-accent,var(--accent));color:#fff;font-weight:600;font-size:12px}
@media (max-width:1100px){.ecols{grid-template-columns:1fr}.prev{position:static}}
`

const LIST_SCRIPT = `
(() => {
  const rows = [...document.querySelectorAll('tr[data-slug]')], q = document.getElementById('q'), count = document.getElementById('count')
  let mode = 'all'
  const apply = () => {
    const t = (q.value || '').trim().toLowerCase(); let n = 0
    for (const r of rows) { const ok = (mode === 'all' || r.dataset.f.split(' ').includes(mode)) && (!t || r.dataset.search.includes(t)); r.hidden = !ok; if (ok) n++ }
    count.textContent = n + ' of ' + rows.length
  }
  q.addEventListener('input', apply)
  for (const b of document.querySelectorAll('.tile[data-mode]')) b.addEventListener('click', () => { mode = mode === b.dataset.mode ? 'all' : b.dataset.mode; for (const o of document.querySelectorAll('.tile[data-mode]')) o.setAttribute('aria-pressed', String(o.dataset.mode === mode)); apply() })
  const csrf = document.body.dataset.csrf
  const quick = async (slug, field, value, el, revert) => {
    try {
      const r = await fetch('/admin/d/' + slug + '/quick', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, field, value: String(value) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Not saved')
      const row = el.closest('tr'); row.dataset.f = j.f; const e = row.querySelector('input[data-field=embed]'); if (e) e.disabled = j.access !== 'public'
      window.lumenToast(j.message || 'Saved')
    } catch (err) { revert(); window.lumenToast(err.message) }
  }
  for (const t of document.querySelectorAll('input[data-field]')) t.addEventListener('change', () => quick(t.closest('tr').dataset.slug, t.dataset.field, t.checked, t, () => (t.checked = !t.checked)))
  for (const s of document.querySelectorAll('select[data-field]')) { let prev = s.value; s.addEventListener('change', () => { const was = prev; prev = s.value; s.dataset.v = s.value; quick(s.closest('tr').dataset.slug, 'access', s.value, s, () => { s.value = was; s.dataset.v = was; prev = was }) }) }
  apply()
})()
`

const EDIT_SCRIPT = `
(() => {
  const tabs = [...document.querySelectorAll('.tabs [role=tab]')], panels = [...document.querySelectorAll('[role=tabpanel]')]
  const show = (id, push) => { for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === id)); for (const p of panels) p.hidden = p.id !== 'tab-' + id; if (push) history.replaceState(null, '', '#' + id) }
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab, true)))
  show(tabs.some((t) => t.dataset.tab === location.hash.slice(1)) ? location.hash.slice(1) : 'details')
  const form = document.getElementById('edit'), bar = document.querySelector('.savebar')
  if (!form) return
  const initial = new URLSearchParams(new FormData(form)).toString()
  const sync = () => {
    bar.classList.toggle('on', new URLSearchParams(new FormData(form)).toString() !== initial)
    const v = (n) => form.elements[n]?.value ?? ''
    document.querySelector('.pc .pt').textContent = v('title') || document.querySelector('.pc .pt').dataset.fallback
    const d = document.querySelector('.pc .pd'); d.textContent = v('description'); d.hidden = !v('description')
    document.querySelector('.pc .ptags').innerHTML = ''; for (const t of v('tags').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6)) { const s = document.createElement('span'); s.textContent = '#' + t; document.querySelector('.pc .ptags').appendChild(s) }
    const access = form.querySelector('input[name=access]:checked')?.value
    document.getElementById('pw').hidden = access !== 'password'
    const embed = form.elements.embed; if (embed) { embed.disabled = access !== 'public'; document.getElementById('embed-note').hidden = access === 'public' }
  }
  form.addEventListener('input', sync); form.addEventListener('change', sync)
  document.getElementById('discard')?.addEventListener('click', () => { form.reset(); sync() })
  addEventListener('beforeunload', (e) => { if (bar.classList.contains('on') && !form.dataset.submitting) e.preventDefault() })
  form.addEventListener('submit', () => (form.dataset.submitting = '1'))
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); form.requestSubmit() } })
  sync()
})()
`

const SETTINGS_SCRIPT = `
(() => {
  const form = document.getElementById('settings'), bar = document.querySelector('.savebar'), mini = document.querySelector('.mini')
  const color = document.getElementById('accent-color'), hex = document.getElementById('accent')
  const initial = new URLSearchParams(new FormData(form)).toString()
  const sync = () => {
    bar.classList.toggle('on', new URLSearchParams(new FormData(form)).toString() !== initial)
    mini.querySelector('.mt span').textContent = form.elements.title.value || 'Dashboards'
    mini.querySelector('h4').textContent = form.elements.title.value || 'Dashboards'
    mini.querySelector('p').textContent = form.elements.tagline.value || 'Your tagline appears here.'
    const t = form.querySelector('input[name=theme]:checked')
    const a = /^#[0-9a-f]{6}$/i.test(hex.value) ? hex.value : (t?.dataset.accent || '')
    mini.style.setProperty('--mini-accent', a)
  }
  color.addEventListener('input', () => { hex.value = color.value; sync() })
  hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) color.value = hex.value; sync() })
  for (const b of document.querySelectorAll('.swatches button')) b.addEventListener('click', () => { hex.value = b.dataset.c; color.value = b.dataset.c || '#117865'; sync() })
  form.addEventListener('input', sync); form.addEventListener('change', sync)
  document.getElementById('discard')?.addEventListener('click', () => { form.reset(); sync() })
  form.addEventListener('submit', () => (form.dataset.submitting = '1'))
  addEventListener('beforeunload', (e) => { if (bar.classList.contains('on') && !form.dataset.submitting) e.preventDefault() })
  sync()
})()
`

export function createAdmin(ctx) {
  const { auth, allMeta, readMeta, writeMeta, displayMeta, dir, siteSettings, saveSettings, send, readBody, byPlacement, chrome, paletteIndex } = ctx
  const base = String(ctx.publicUrl ?? '').replace(/\/+$/, '')
  const html = (res, status, body, extra = {}) => send(res, status, body, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...extra })
  const csrfField = (req) => `<input type="hidden" name="csrf" value="${esc(auth.csrf(req))}">`
  const cache = { index: [], count: null }

  async function refresh() {
    const all = (await allMeta()).map(displayMeta).sort(byPlacement)
    cache.count = all.length
    cache.index = [...all.map((d) => ({ g: 'Edit dashboard', t: d.title, s: `/d/${d.slug}/ · ${ACCESS[d.access]?.[0] ?? d.access}`, u: `/admin/d/${d.slug}`, i: 'edit', k: `${d.slug} ${d.tags.join(' ')}` })), ...paletteIndex(all)]
    return all
  }

  /** An admin page in the shell (also used by auth.mjs for /account). */
  function page(req, o) {
    const c = chrome(req)
    return shell({
      ...c,
      nav: 'admin',
      title: o.title,
      crumbs: o.crumbs ?? [['Admin', '/admin'], [o.title]],
      admin: { active: o.admin ?? 'dashboards' },
      side: { dashboards: cache.count, keys: o.keys ?? (c.user ? auth.keyCount(c.user.email) : null) },
      index: cache.index,
      flash: o.flash,
      css: ADMIN_CSS + (o.css ?? ''),
      body: o.body,
      script: o.script,
      bodyClass: 'admin'
    }).replace('<body class="admin"', `<body class="admin" data-csrf="${esc(auth.csrf(req))}"`)
  }

  async function form(req) {
    const f = new URLSearchParams((await readBody(req, 64 * 1024)).toString('utf8'))
    if (!safeEqual(f.get('csrf') ?? '', auth.csrf(req))) throw Object.assign(new Error('This page expired. Reload it and try again.'), { status: 400 })
    return f
  }

  const flags = (d) => [d.access, d.featured ? 'featured' : '', d.listed ? '' : 'unlisted', d.access === 'public' && d.embed.enabled ? 'embeddable' : ''].filter(Boolean).join(' ')

  async function list(req, res, flash) {
    const all = await refresh()
    const n = (f) => all.filter((d) => flags(d).split(' ').includes(f)).length
    const tile = (mode, label, icon, value) => `<button type="button" class="tile" data-mode="${mode}" aria-pressed="false"><span>${ICON[icon]}${label}</span><b>${value}</b></button>`
    const rows = all
      .map((d) => {
        const thumb = d.previews[0] ? ` style="background-image:url('${esc(d.previews[0].src)}')"` : ''
        const search = [d.title, d.slug, d.description, ...d.tags].join(' ').toLowerCase()
        return `<tr data-slug="${d.slug}" data-f="${flags(d)}" data-search="${esc(search)}">
<td><a class="th" href="/admin/d/${d.slug}"${thumb} aria-label="Edit ${esc(d.title)}"></a></td>
<td class="nm"><a href="/admin/d/${d.slug}">${esc(d.title)}</a><small>/d/${d.slug}/ · ${d.pages.length} page${d.pages.length === 1 ? '' : 's'} · <span data-rel="${esc(d.publishedAt)}">${esc(String(d.publishedAt).slice(0, 10))}</span></small>${d.tags.length ? `<div class="tags">${d.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</td>
<td><select data-field="access" data-v="${d.access}" aria-label="Visibility of ${esc(d.title)}"><option value="public"${d.access === 'public' ? ' selected' : ''}>Public</option><option value="users"${d.access === 'users' ? ' selected' : ''}>Private</option><option value="password"${d.access === 'password' ? ' selected' : ''}>Password</option></select></td>
<td class="ctr"><input class="tog" type="checkbox" data-field="featured"${d.featured ? ' checked' : ''} aria-label="Featured"></td>
<td class="ctr"><input class="tog" type="checkbox" data-field="listed"${d.listed ? ' checked' : ''} aria-label="Listed on the home page"></td>
<td class="ctr"><input class="tog" type="checkbox" data-field="embed"${d.embed.enabled ? ' checked' : ''}${d.access === 'public' ? '' : ' disabled'} aria-label="Embeddable" title="Public dashboards only"></td>
<td class="act"><a class="btn quiet sm icon" href="${d.url}" target="_blank" rel="noopener" title="Open" aria-label="Open ${esc(d.title)}">${ICON.external}</a><a class="btn ghost sm" href="/admin/d/${d.slug}">${ICON.edit}Edit</a></td></tr>`
      })
      .join('')
    const s = siteSettings()
    const body = `<div class="head"><div><h1>Dashboards</h1><p>Everything published to this server. Change visibility, featuring and listing right here, or open one to edit its details. New dashboards from Lumen start as <b>${ACCESS[s.defaultAccess]?.[0]}</b>.</p></div><div style="display:flex;gap:8px"><a class="btn ghost" href="/" target="_blank" rel="noopener">${ICON.eye}View site</a><a class="btn" href="/admin/settings">${ICON.gear}Site settings</a></div></div>
${
  all.length
    ? `<div class="stats">${tile('all', 'All', 'dash', all.length)}${tile('public', 'Public', 'globe', n('public'))}${tile('users', 'Private', 'users', n('users'))}${tile('password', 'Password', 'lock', n('password'))}${tile('featured', 'Featured', 'star', n('featured'))}${tile('embeddable', 'Embeddable', 'code', n('embeddable'))}</div>
<div class="tbar"><label class="filter">${ICON.search}<input id="q" type="search" placeholder="Filter by title, address or tag" aria-label="Filter" autocomplete="off"></label><span class="muted" id="count"></span></div>
<div class="tablewrap"><table class="dt"><thead><tr><th></th><th>Dashboard</th><th>Visibility</th><th class="ctr">Featured</th><th class="ctr">Listed</th><th class="ctr">Embed</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty"><div class="ill">${ICON.dash}</div><h2>No dashboards yet</h2><p>In Lumen, use File › Publish with this server as the destination.</p></div>`
}`
    return html(res, 200, page(req, { title: 'Dashboards', crumbs: [['Admin', '/admin'], ['Dashboards']], admin: 'dashboards', body, script: LIST_SCRIPT, flash }))
  }

  async function quick(req, res, user, slug) {
    const meta = await readMeta(slug)
    const out = (status, v) => send(res, status, JSON.stringify(v), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    if (!meta) return out(404, { error: 'No such dashboard.' })
    const f = await form(req)
    const field = f.get('field')
    const on = f.get('value') === 'true'
    const c = { ...(meta.custom ?? {}) }
    let message = 'Saved'
    if (field === 'featured') ((c.featured = on), (message = on ? 'Featured' : 'No longer featured'))
    else if (field === 'listed') ((c.listed = on), (message = on ? 'Shown on the home page' : 'Hidden from the home page'))
    else if (field === 'embed') ((c.embed = { enabled: on, origins: c.embed?.origins ?? [] }), (message = on ? 'Embedding allowed' : 'Embedding off'))
    else if (field === 'access') {
      const v = f.get('value')
      if (v === 'password' && !(meta.access?.mode === 'password' && meta.access.hash)) return out(400, { error: 'Set a password on the dashboard page first' })
      if (v === 'public' || v === 'users') meta.access = { mode: v }
      else if (v !== 'password') return out(400, { error: 'Unknown visibility' })
      message = `Now ${ACCESS[v][0].toLowerCase()}`
    } else return out(400, { error: 'Unknown change' })
    meta.custom = { ...c, updatedBy: user.email, updatedAt: new Date(ctx.now()).toISOString() }
    await writeMeta(slug, meta)
    const d = displayMeta(meta)
    return out(200, { ok: true, f: flags(d), access: d.access, message })
  }

  async function edit(req, res, user, slug, flash) {
    const meta = await readMeta(slug)
    if (!meta) return html(res, 404, page(req, { title: 'Not found', body: `<div class="empty" style="margin-top:24px"><div class="ill">${ICON.info}</div><h2>Dashboard not found</h2><p>It may have been deleted.</p><a class="btn" href="/admin">All dashboards</a></div>` }))
    if (cache.count === null) await refresh()
    const d = displayMeta(meta)
    const [label, icon] = ACCESS[d.access] ?? ACCESS.users
    const thumb = d.previews[0] ? ` style="background-image:url('${esc(d.previews[0].src)}')"` : ''
    const opt = (v, title, text, ic) => `<label class="opt"><input type="radio" name="access" value="${v}"${d.access === v ? ' checked' : ''}><span class="oi">${ICON[ic]}</span><span><b>${title}</b><small>${text}</small></span></label>`
    const embedUrl = `${base || ''}${d.url}?embed=1`
    const snippet = `<iframe src="${embedUrl}" title="${d.title.replace(/"/g, '&quot;')}" style="width:100%;aspect-ratio:16/9;border:0" loading="lazy" allowfullscreen></iframe>`
    const tab = (id, text, ic, cls = '') => `<button type="button" role="tab" data-tab="${id}" aria-selected="false"${cls ? ` class="${cls}"` : ''}>${ICON[ic]}${text}</button>`
    const body = `<div class="ehead"><span class="th"${thumb}></span><div class="grow"><h1>${esc(d.title)}</h1><div class="chips"><span class="chip ${d.access}">${ICON[icon]}${label}</span>${d.featured ? `<span class="chip star">${ICON.star}Featured</span>` : ''}${d.listed ? '' : '<span class="chip">Unlisted</span>'}${d.access === 'public' && d.embed.enabled ? `<span class="chip">${ICON.code}Embeddable</span>` : ''}</div></div>
<div class="acts"><a class="btn ghost" href="${d.url}" target="_blank" rel="noopener">${ICON.external}Open</a><a class="btn ghost" href="/dashboards/${d.slug}" target="_blank" rel="noopener">${ICON.info}Details page</a><button class="btn ghost" type="button" data-copy="${d.url}">${ICON.copy}Copy link</button></div></div>
<div class="tabs" role="tablist">${tab('details', 'Details', 'edit')}${tab('access', 'Access', 'lock')}${tab('embedding', 'Embedding', 'code')}${tab('danger', 'Danger zone', 'trash', 'danger-tab')}</div>
<div class="ecols"><div>
<form method="post" action="/admin/d/${d.slug}" id="edit">${csrfField(req)}
<section role="tabpanel" id="tab-details"><div class="panel sec"><h2>How it shows</h2><p>Title, description and tags on the gallery, details page and search.</p>
<label class="f" for="title">Title</label><input type="text" id="title" name="title" value="${esc(d.title)}" maxlength="200"><div class="hint">Published from Lumen as “${esc(d.publishedTitle)}”. Republishing keeps your title.</div>
<label class="f" for="description">Description</label><textarea id="description" name="description" maxlength="1000" placeholder="What this dashboard answers, who it is for, where the data comes from.">${esc(d.description)}</textarea>
<label class="f" for="tags">Tags</label><input type="text" id="tags" name="tags" value="${esc(d.tags.join(', '))}" placeholder="Finance, Monthly"><div class="hint">Separate with commas. Each tag is a collection on the site.</div></div>
<div class="panel sec"><h2>Placement</h2><p>Where it appears on the home page.</p>
<label class="switch"><span><b>Show on the home page</b><small>Unlisted dashboards still open from their address.</small></span><input type="checkbox" name="listed"${d.listed ? ' checked' : ''}></label>
<label class="switch"><span><b>Featured</b><small>Shown in the spotlight at the top and first in the gallery.</small></span><input type="checkbox" name="featured"${d.featured ? ' checked' : ''}></label>
<label class="f" for="order">Order</label><input type="number" id="order" name="order" value="${d.order}" style="max-width:140px"><div class="hint">Lower comes first among dashboards that are both featured or both not.</div></div></section>
<section role="tabpanel" id="tab-access" hidden><div class="panel sec"><h2>Who can open it</h2><p>Changing this takes effect at once for everyone.</p><div class="opts">
${opt('users', 'Private', 'Only approved Google accounts, after signing in.', 'users')}
${opt('password', 'Password', 'Anyone with the password. Typing a new one signs everyone out.', 'lock')}
<div class="pwbox" id="pw"><input type="password" name="password" placeholder="${d.access === 'password' ? 'Leave empty to keep the current password' : 'Choose a password'}" autocomplete="new-password"></div>
${opt('public', 'Public', 'Anyone with the link, no sign-in. The data in it can be read by anyone.', 'globe')}
</div></div></section>
<section role="tabpanel" id="tab-embedding" hidden><div class="panel sec"><h2>Embedding</h2><p>Show this dashboard inside another site, such as a portfolio, in an iframe.</p>
<label class="switch"><span><b>Allow embedding</b><small>Public dashboards only.</small></span><input type="checkbox" name="embed"${d.embed.enabled ? ' checked' : ''}></label>
<div class="hint" id="embed-note" hidden>Make the dashboard public (Access tab) to embed it.</div>
<label class="f" for="origins">Sites allowed to embed it</label><textarea id="origins" name="origins" placeholder="https://hemlineanalytics.com">${esc(d.embed.origins.join('\n'))}</textarea><div class="hint">One per line. Leave empty to allow any site.</div>
${d.access === 'public' && d.embed.enabled ? `<label class="f">Embed code</label><div class="codewrap"><pre class="code" id="snippet">${esc(snippet)}</pre><button class="btn ghost sm" type="button" data-copy="#snippet">${ICON.copy}Copy</button></div><label class="f">Live preview</label><div class="embedview"><iframe src="${esc(d.url)}?embed=1" title="Embed preview" loading="lazy"></iframe></div>` : ''}
</div></section>
<div class="savebar" role="region" aria-label="Unsaved changes"><span>Unsaved changes</span><button class="btn ghost sm" type="button" id="discard">Discard</button><button class="btn sm" type="submit">${ICON.check}Save changes</button></div>
</form>
<section role="tabpanel" id="tab-danger" hidden><div class="panel sec danger"><h2>Delete dashboard</h2><p>Removes it from this server, with its previews and settings. Lumen can publish it again later; the settings here would start over.</p>
<form method="post" action="/admin/d/${d.slug}/delete" data-msg="Delete ${esc(d.title)} from the server?" onsubmit="return confirm(this.dataset.msg)">${csrfField(req)}<button class="btn danger" type="submit">${ICON.trash}Delete ${esc(d.title)}</button></form></div></section>
</div>
<aside class="prev"><div><h3>Card preview</h3><div class="panel pc"><div class="im"${thumb}></div><div class="pb"><div class="pt" data-fallback="${esc(d.publishedTitle)}">${esc(d.title)}</div><div class="pd"${d.description ? '' : ' hidden'}>${esc(d.description)}</div><div class="ptags"></div></div></div></div>
<div class="panel" style="padding:18px"><h3>Status</h3><dl class="kv"><dt>Address</dt><dd>/d/${d.slug}/</dd><dt>Pages</dt><dd>${d.pages.length}</dd><dt>Published</dt><dd data-rel="${esc(d.publishedAt)}">${esc(String(d.publishedAt).slice(0, 10))}</dd><dt>Size</dt><dd>${d.bytes ? `${(d.bytes / 1048576).toFixed(1)} MB` : '—'}</dd>${meta.custom?.updatedBy ? `<dt>Edited</dt><dd title="${esc(meta.custom.updatedBy)}" data-rel="${esc(meta.custom.updatedAt)}">${esc(String(meta.custom.updatedAt).slice(0, 10))}</dd>` : ''}</dl></div></aside>
</div>`
    return html(res, 200, page(req, { title: d.title, crumbs: [['Admin', '/admin'], ['Dashboards', '/admin'], [d.title]], admin: 'dashboards', body, script: EDIT_SCRIPT, flash }))
  }

  async function saveDashboard(req, res, user, slug) {
    const meta = await readMeta(slug)
    if (!meta) return edit(req, res, user, slug)
    const f = await form(req)
    const access = f.get('access')
    if (access === 'password') {
      const pw = f.get('password') ?? ''
      if (pw) meta.access = { mode: 'password', ...hashPassword(pw) }
      else if (meta.access?.mode !== 'password') return edit(req, res, user, slug, 'Type a password to protect this dashboard with one.')
    } else if (access === 'public' || access === 'users') meta.access = { mode: access }
    const order = Number(f.get('order'))
    meta.custom = {
      title: (f.get('title') ?? '').trim().slice(0, 200) || undefined,
      description: (f.get('description') ?? '').trim().slice(0, 1000),
      tags: parseTags(f.get('tags')),
      listed: f.has('listed'),
      featured: f.has('featured'),
      order: Number.isFinite(order) ? Math.round(order) : 0,
      embed: { enabled: f.has('embed'), origins: parseOrigins(f.get('origins')) },
      updatedBy: user.email,
      updatedAt: new Date(ctx.now()).toISOString()
    }
    await writeMeta(slug, meta)
    await refresh()
    return edit(req, res, user, slug, 'Saved')
  }

  async function remove(req, res, user, slug) {
    await form(req)
    await fsp.rm(dir(slug), { recursive: true, force: true })
    return list(req, res, `Deleted ${slug}`)
  }

  async function settingsPage(req, res, flash) {
    if (cache.count === null) await refresh()
    const s = siteSettings()
    const themeCard = (k) => {
      const t = THEMES[k]
      return `<label class="theme"><input type="radio" name="theme" value="${k}" data-accent="${t.accent}"${s.theme === k ? ' checked' : ''}><div class="sw">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</div><b>${t.label}</b><small>${t.note}</small></label>`
    }
    const accent = s.accent || ''
    const body = `<div class="head"><div><h1>Site settings</h1><p>How the site looks and what new dashboards start as.</p></div><a class="btn ghost" href="/" target="_blank" rel="noopener">${ICON.eye}View site</a></div>
<div class="ecols"><div><form method="post" action="/admin/settings" id="settings">${csrfField(req)}
<div class="panel sec"><h2>Branding</h2><p>The name and look visitors see.</p>
<label class="f" for="title">Site title</label><input type="text" id="title" name="title" value="${esc(s.title)}" maxlength="120">
<label class="f" for="tagline">Tagline</label><input type="text" id="tagline" name="tagline" value="${esc(s.tagline)}" maxlength="240" placeholder="Interactive dashboards by …">
<label class="f">Theme</label><div class="themes">${Object.keys(THEMES).map(themeCard).join('')}</div>
<label class="f" for="accent">Accent colour</label><div class="accentrow"><input type="color" id="accent-color" value="${esc(accent || '#117865')}" aria-label="Pick a colour"><input type="text" id="accent" name="accent" value="${esc(accent)}" placeholder="Theme default"><div class="swatches">${['', '#117865', '#1e3a2b', '#b08d57', '#3b6fd8', '#9b5de5', '#d9480f'].map((c) => `<button type="button" data-c="${c}" title="${c || 'Theme default'}" style="background:${c || 'conic-gradient(#117865 0 50%,#b08d57 0)'}"></button>`).join('')}</div></div><div class="hint">Buttons, links and highlights. Leave empty to use the theme's own.</div></div>
<div class="panel sec"><h2>Home page</h2><p>What visitors see at the site's address.</p>
<label class="switch"><span><b>List dashboards on the home page</b><small>When off, dashboards open only from their own address (you still see the list when signed in).</small></span><input type="checkbox" name="listing"${s.listing ? ' checked' : ''}></label></div>
<div class="panel sec"><h2>New dashboards</h2><p>Lumen can still choose per publish. Make a dashboard public once it is ready to share.</p><div class="opts">
<label class="opt"><input type="radio" name="defaultAccess" value="users"${s.defaultAccess === 'users' ? ' checked' : ''}><span class="oi">${ICON.users}</span><span><b>Private</b><small>Only approved Google accounts.</small></span></label>
<label class="opt"><input type="radio" name="defaultAccess" value="public"${s.defaultAccess === 'public' ? ' checked' : ''}><span class="oi">${ICON.globe}</span><span><b>Public</b><small>Anyone with the link.</small></span></label></div></div>
<div class="savebar" role="region" aria-label="Unsaved changes"><span>Unsaved changes</span><button class="btn ghost sm" type="button" id="discard">Discard</button><button class="btn sm" type="submit">${ICON.check}Save settings</button></div>
</form>
<div class="panel sec"><h2>For other sites</h2><p>Public, listed dashboards as JSON (title, description, tags, preview, embed address), for a portfolio page.</p><div class="codewrap"><pre class="code" id="api">${esc(base)}/api/public/dashboards</pre><button class="btn ghost sm" type="button" data-copy="#api">${ICON.copy}Copy</button></div></div>
</div>
<aside class="prev"><div><h3>Preview</h3><div class="mini"><div class="mt"><i></i><span></span></div><div class="mb"><h4></h4><p></p><span>Open dashboard</span></div></div></div></aside></div>`
    return html(res, 200, page(req, { title: 'Site settings', crumbs: [['Admin', '/admin'], ['Site settings']], admin: 'settings', body, script: SETTINGS_SCRIPT, flash }))
  }

  async function saveSiteSettings(req, res) {
    const f = await form(req)
    const accent = (f.get('accent') ?? '').trim()
    await saveSettings({
      title: (f.get('title') ?? '').trim().slice(0, 120),
      tagline: (f.get('tagline') ?? '').trim().slice(0, 240),
      accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '',
      theme: THEMES[f.get('theme')] ? f.get('theme') : 'lumen',
      listing: f.has('listing'),
      defaultAccess: f.get('defaultAccess') === 'public' ? 'public' : 'users'
    })
    return settingsPage(req, res, 'Settings saved')
  }

  async function handle(req, res, path, url) {
    if (!auth.enabled) return html(res, 404, shell({ ...chrome(req), title: 'Admin', body: `<div class="empty" style="margin-top:24px"><div class="ill">${ICON.gear}</div><h2>Set up Google sign-in to use the admin console</h2><p>See README.md, “Google sign-in”.</p></div>` }))
    const user = auth.currentUser(req)
    if (!user) return auth.loginRedirect(res, { send }, `${url.pathname}${url.search}`)
    try {
      if (path === '/admin' || path === '/admin/') return await list(req, res)
      if (path === '/admin/settings') return req.method === 'POST' ? await saveSiteSettings(req, res) : await settingsPage(req, res)
      const m = /^\/admin\/d\/([^/]+)(\/delete|\/quick)?$/.exec(path)
      if (m && SLUG.test(m[1])) {
        if (m[2] === '/delete') return req.method === 'POST' ? await remove(req, res, user, m[1]) : html(res, 405, 'Method not allowed')
        if (m[2] === '/quick') return req.method === 'POST' ? await quick(req, res, user, m[1]) : html(res, 405, 'Method not allowed')
        return req.method === 'POST' ? await saveDashboard(req, res, user, m[1]) : await edit(req, res, user, m[1])
      }
      return html(res, 404, page(req, { title: 'Not found', body: `<div class="empty" style="margin-top:24px"><div class="ill">${ICON.info}</div><h2>Not found</h2><a class="btn" href="/admin">Admin home</a></div>` }))
    } catch (e) {
      if (e?.status === 400) {
        if (path.endsWith('/quick')) return send(res, 400, JSON.stringify({ error: e.message }), { 'content-type': 'application/json; charset=utf-8' })
        return html(res, 400, page(req, { title: 'Expired', body: `<div class="empty" style="margin-top:24px"><div class="ill">${ICON.info}</div><h2>${esc(e.message)}</h2><a class="btn" href="${esc(path)}">Reload</a></div>` }))
      }
      throw e
    }
  }

  return { handle, page }
}

/**
 * The admin console (/admin), for approved Google accounts: every dashboard on the server with how it shows, who can
 * open it, whether it is listed or featured on the home page, whether other sites may embed it, and the site's own
 * settings.
 *
 *   GET  /admin                     dashboards
 *   GET  /admin/d/<slug>            one dashboard's settings and its embed code
 *   POST /admin/d/<slug>            save them
 *   POST /admin/d/<slug>/delete     remove the dashboard
 *   GET  /admin/settings            site title, tagline, accent colour, home page list, default visibility
 *   POST /admin/settings            save them
 *
 * Changes are kept in meta.json under `custom` (republishing from Lumen keeps them) and in settings.json.
 */
import { promises as fsp } from 'node:fs'
import { esc, hashPassword, safeEqual } from './server.mjs'

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
const ACCESS_LABEL = { public: 'Public', users: 'Private', password: 'Password' }

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

function shell(title, body, { active = '', user, accent } = {}) {
  const nav = [
    ['/admin', 'Dashboards', 'dashboards'],
    ['/admin/settings', 'Site settings', 'settings'],
    ['/account', 'Connected computers', 'account'],
    ['/', 'View site', 'site']
  ]
    .map(([href, label, key]) => `<a href="${href}" class="${key === active ? 'on' : ''}">${label}</a>`)
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Admin</title><style>
:root{--fg:#1f2328;--fg2:#57606a;--bg:#f6f7f9;--panel:#fff;--line:#e4e7eb;--accent:${accent || '#117865'};--soft:color-mix(in srgb,var(--accent) 12%,transparent);--ok:#1a7f37;--warn:#9a6700;--bad:#cf222e}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--fg2:#9198a1;--bg:#0d1117;--panel:#161b22;--line:#2a313c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 'Segoe UI',system-ui,-apple-system,sans-serif}
.app{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
aside{background:var(--panel);border-right:1px solid var(--line);padding:20px 12px;position:sticky;top:0;height:100vh}
.brand{font-weight:700;font-size:15px;padding:4px 10px 16px}.brand small{display:block;font-weight:400;color:var(--fg2);font-size:12px}
aside a{display:block;padding:8px 10px;border-radius:6px;color:var(--fg2);text-decoration:none;margin-bottom:2px}aside a:hover{background:var(--soft);color:var(--fg)}aside a.on{background:var(--soft);color:var(--accent);font-weight:600}
.who{position:absolute;bottom:16px;left:12px;right:12px;font-size:12px;color:var(--fg2);padding:0 10px;overflow:hidden;text-overflow:ellipsis}
main{padding:28px 32px;max-width:1100px}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--fg2);margin:0 0 20px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:12px;color:var(--fg2);font-weight:600;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:0}
td a{color:inherit;font-weight:600;text-decoration:none}td a:hover{color:var(--accent)}.slug{color:var(--fg2);font-size:12px;font-weight:400}
.thumb{width:96px;aspect-ratio:16/9;border-radius:6px;background:var(--soft) center/cover no-repeat;border:1px solid var(--line)}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line);margin-right:4px;white-space:nowrap}
.chip.public{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}.chip.users{color:var(--fg2)}.chip.password{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}.chip.star{color:var(--accent)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px;margin-bottom:16px}.card h2{font-size:15px;margin:0 0 12px}
label{display:block;font-weight:600;margin:14px 0 4px}label:first-child{margin-top:0}.hint{color:var(--fg2);font-size:12px;margin-top:4px}
input[type=text],input[type=password],input[type=number],textarea,select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}textarea{min-height:70px;resize:vertical}
.check{display:flex;gap:8px;align-items:center;font-weight:400;margin:10px 0}.check input{margin:0}
.radio{display:flex;gap:8px;align-items:flex-start;font-weight:400;margin:8px 0}.radio b{display:block}.radio span{color:var(--fg2);font-size:12px}
button,.btn{display:inline-block;padding:8px 16px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}button.danger{background:var(--bad)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-all;font-size:12px;margin:6px 0 0}
.flash{background:var(--soft);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);color:var(--fg);padding:8px 12px;border-radius:6px;margin-bottom:16px}
@media (max-width:760px){.app{grid-template-columns:1fr}aside{position:static;height:auto}.who{position:static;padding-top:8px}.grid2{grid-template-columns:1fr}main{padding:20px 16px}.hide-sm{display:none}}
</style></head><body><div class="app"><aside><div class="brand">Lumen Server<small>Admin</small></div>${nav}<div class="who">${user ? esc(user.email) : ''}</div></aside><main>${body}</main></div></body></html>`
}

export function createAdmin(ctx) {
  const { auth, allMeta, readMeta, writeMeta, displayMeta, dir, siteSettings, saveSettings, send, readBody, byPlacement } = ctx
  const base = String(ctx.publicUrl ?? '').replace(/\/+$/, '')
  const html = (res, status, body, extra = {}) => send(res, status, body, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...extra })
  const csrfField = (req) => `<input type="hidden" name="csrf" value="${esc(auth.csrf(req))}">`

  async function form(req) {
    const f = new URLSearchParams((await readBody(req, 64 * 1024)).toString('utf8'))
    if (!safeEqual(f.get('csrf') ?? '', auth.csrf(req))) throw Object.assign(new Error('This page expired. Reload it and try again.'), { status: 400 })
    return f
  }

  async function list(req, res, user, flash) {
    const all = (await allMeta()).map(displayMeta).sort(byPlacement)
    const rows = all
      .map((d) => {
        const thumb = d.previews[0] ? `style="background-image:url('${esc(d.previews[0].src)}')"` : ''
        return `<tr><td class="hide-sm"><div class="thumb" ${thumb}></div></td><td><a href="/admin/d/${d.slug}">${esc(d.title)}</a><div class="slug">/d/${d.slug}/</div></td><td><span class="chip ${d.access}">${ACCESS_LABEL[d.access] ?? d.access}</span>${d.featured ? '<span class="chip star">Featured</span>' : ''}${d.listed ? '' : '<span class="chip">Unlisted</span>'}${d.embed.enabled && d.access === 'public' ? '<span class="chip">Embeddable</span>' : ''}</td><td class="hide-sm">${d.pages.length}</td><td class="hide-sm">${esc(String(d.publishedAt).slice(0, 10))}</td><td><a class="btn ghost" href="/admin/d/${d.slug}">Edit</a></td></tr>`
      })
      .join('')
    const counts = { public: all.filter((d) => d.access === 'public').length, total: all.length }
    return html(
      res,
      200,
      shell(
        'Dashboards',
        `${flash ? `<div class="flash">${esc(flash)}</div>` : ''}<h1>Dashboards</h1><p class="sub">${counts.total} on this server, ${counts.public} public. New dashboards from Lumen start as <b>${ACCESS_LABEL[siteSettings().defaultAccess]}</b>.</p>${
          rows
            ? `<table><thead><tr><th class="hide-sm"></th><th>Dashboard</th><th>Visibility</th><th class="hide-sm">Pages</th><th class="hide-sm">Published</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="card">No dashboards yet. In Lumen, use File &gt; Publish with this server as the destination.</div>'
        }`,
        { active: 'dashboards', user, accent: siteSettings().accent }
      )
    )
  }

  async function edit(req, res, user, slug, flash) {
    const meta = await readMeta(slug)
    if (!meta) return html(res, 404, shell('Not found', '<h1>Dashboard not found</h1>', { user }))
    const d = displayMeta(meta)
    const radio = (v, title, text) => `<label class="radio"><input type="radio" name="access" value="${v}" ${d.access === v ? 'checked' : ''}><div><b>${title}</b><span>${text}</span></div></label>`
    const embedUrl = `${base || ''}${d.url}?embed=1`
    const snippet = `<iframe src="${embedUrl}" title="${d.title.replace(/"/g, '&quot;')}" style="width:100%;aspect-ratio:16/9;border:0" loading="lazy" allowfullscreen></iframe>`
    const body = `${flash ? `<div class="flash">${esc(flash)}</div>` : ''}<div class="row" style="justify-content:space-between"><div><h1>${esc(d.title)}</h1><p class="sub">/d/${d.slug}/ · published ${esc(String(d.publishedAt).slice(0, 16).replace('T', ' '))} UTC · ${d.pages.length} page${d.pages.length === 1 ? '' : 's'}</p></div><a class="btn ghost" href="${d.url}" target="_blank" rel="noopener">Open dashboard</a></div>
<form method="post" action="/admin/d/${d.slug}">${csrfField(req)}
<div class="grid2"><div class="card"><h2>How it shows</h2>
<label for="title">Title</label><input type="text" id="title" name="title" value="${esc(d.title)}" maxlength="200"><div class="hint">Published from Lumen as "${esc(d.publishedTitle)}". Republishing keeps this title.</div>
<label for="description">Description</label><textarea id="description" name="description" maxlength="1000">${esc(d.description)}</textarea>
<label for="tags">Tags</label><input type="text" id="tags" name="tags" value="${esc(d.tags.join(', '))}" placeholder="finance, monthly"><div class="hint">Separate with commas.</div>
<label class="check"><input type="checkbox" name="listed" ${d.listed ? 'checked' : ''}> Show on the home page</label>
<label class="check"><input type="checkbox" name="featured" ${d.featured ? 'checked' : ''}> Feature it (shown first)</label>
<label for="order">Order</label><input type="number" id="order" name="order" value="${d.order}" style="max-width:120px"><div class="hint">Lower comes first among dashboards that are both featured or both not.</div>
</div><div class="card"><h2>Who can open it</h2>
${radio('users', 'Private', 'Only approved Google accounts, after signing in.')}
${radio('password', 'Password', 'Anyone with the password. Typing a new one signs everyone out.')}
<div id="pw"><input type="password" name="password" placeholder="${d.access === 'password' ? 'Leave empty to keep the current password' : 'Password'}" autocomplete="new-password"></div>
${radio('public', 'Public', 'Anyone with the link, no sign-in. The data in it can be read by anyone.')}
<h2 style="margin-top:20px">Embedding</h2>
<label class="check"><input type="checkbox" name="embed" ${d.embed.enabled ? 'checked' : ''}> Let other sites show it in an iframe (public dashboards only)</label>
<label for="origins">Sites allowed to embed it</label><textarea id="origins" name="origins" placeholder="https://hemlineanalytics.com">${esc(d.embed.origins.join('\n'))}</textarea><div class="hint">One per line. Leave empty to allow any site.</div>
${d.access === 'public' && d.embed.enabled ? `<label>Embed code</label><pre>${esc(snippet)}</pre>` : ''}
</div></div>
<div class="row"><button type="submit">Save changes</button><a class="btn ghost" href="/admin">Back</a></div></form>
<form method="post" action="/admin/d/${d.slug}/delete" style="margin-top:28px" onsubmit="return confirm('Delete this dashboard from the server? Lumen can publish it again later.')">${csrfField(req)}<button class="danger" type="submit">Delete dashboard</button></form>`
    return html(res, 200, shell(d.title, body, { active: 'dashboards', user, accent: siteSettings().accent }))
  }

  async function saveDashboard(req, res, user, slug) {
    const meta = await readMeta(slug)
    if (!meta) return html(res, 404, shell('Not found', '<h1>Dashboard not found</h1>', { user }))
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
    return edit(req, res, user, slug, 'Saved.')
  }

  async function remove(req, res, user, slug) {
    await form(req)
    await fsp.rm(dir(slug), { recursive: true, force: true })
    return list(req, res, user, `Deleted ${slug}.`)
  }

  function settingsPage(req, res, user, flash) {
    const s = siteSettings()
    const body = `${flash ? `<div class="flash">${esc(flash)}</div>` : ''}<h1>Site settings</h1><p class="sub">How the home page looks and what new dashboards start as.</p>
<form method="post" action="/admin/settings">${csrfField(req)}<div class="card">
<label for="title">Site title</label><input type="text" id="title" name="title" value="${esc(s.title)}" maxlength="120">
<label for="tagline">Tagline</label><input type="text" id="tagline" name="tagline" value="${esc(s.tagline)}" maxlength="240" placeholder="Interactive dashboards by …">
<label for="accent">Accent colour</label><input type="text" id="accent" name="accent" value="${esc(s.accent)}" placeholder="#117865" style="max-width:160px"><div class="hint">A hex colour, e.g. #1E3A2B. Leave empty for the default.</div>
<label class="check"><input type="checkbox" name="listing" ${s.listing ? 'checked' : ''}> Show the list of dashboards on the home page</label>
<label for="defaultAccess">New dashboards start as</label><select id="defaultAccess" name="defaultAccess"><option value="users" ${s.defaultAccess === 'users' ? 'selected' : ''}>Private (approved Google accounts)</option><option value="public" ${s.defaultAccess === 'public' ? 'selected' : ''}>Public</option></select><div class="hint">Lumen can still choose per publish. Make a dashboard public here once it is ready to share.</div>
</div><button type="submit">Save settings</button></form>
<div class="card" style="margin-top:20px"><h2>For other sites</h2><p class="sub" style="margin:0">Public, listed dashboards as JSON (title, description, tags, preview, embed address), for a portfolio page:</p><pre>${esc(base)}/api/public/dashboards</pre></div>`
    return html(res, 200, shell('Site settings', body, { active: 'settings', user, accent: s.accent }))
  }

  async function saveSiteSettings(req, res, user) {
    const f = await form(req)
    const accent = (f.get('accent') ?? '').trim()
    await saveSettings({
      title: (f.get('title') ?? '').trim().slice(0, 120),
      tagline: (f.get('tagline') ?? '').trim().slice(0, 240),
      accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '',
      listing: f.has('listing'),
      defaultAccess: f.get('defaultAccess') === 'public' ? 'public' : 'users'
    })
    return settingsPage(req, res, user, 'Saved.')
  }

  async function handle(req, res, path, url) {
    if (!auth.enabled) return html(res, 404, shell('Admin', '<h1>Set up Google sign-in to use the admin console</h1><p class="sub">See README.md, "Google sign-in".</p>'))
    const user = auth.currentUser(req)
    if (!user) return auth.loginRedirect(res, { send }, `${url.pathname}${url.search}`)
    try {
      if (path === '/admin' || path === '/admin/') return await list(req, res, user)
      if (path === '/admin/settings') return req.method === 'POST' ? await saveSiteSettings(req, res, user) : settingsPage(req, res, user)
      const m = /^\/admin\/d\/([^/]+)(\/delete)?$/.exec(path)
      if (m && SLUG.test(m[1])) {
        if (m[2]) return req.method === 'POST' ? await remove(req, res, user, m[1]) : html(res, 405, 'Method not allowed')
        return req.method === 'POST' ? await saveDashboard(req, res, user, m[1]) : await edit(req, res, user, m[1])
      }
      return html(res, 404, shell('Not found', '<h1>Not found</h1>', { user }))
    } catch (e) {
      if (e?.status === 400) return html(res, 400, shell('Expired', `<h1>${esc(e.message)}</h1><p><a href="${esc(path)}">Reload</a></p>`, { user }))
      throw e
    }
  }

  return { handle }
}

/**
 * Lumen Server's design system: one page shell for every HTML page the server renders (gallery, collections,
 * dashboard details, password and sign-in pages, account and the admin console), so they share one look and one
 * navigation:
 *
 *   - a sticky top bar: brand, primary navigation (Dashboards, Collections, Admin when signed in), a search button that
 *     opens the command palette (/ or Ctrl+K: every dashboard, page and admin screen), and the account menu
 *   - breadcrumbs under it
 *   - in the admin console, a sidebar (a tab bar on phones)
 *
 * Themes: 'lumen' (default) and 'hemline' (deep green, brass and ivory with Bodoni Moda / Jost), light and dark, with
 * the site's accent colour on top. Pure strings: no assets, no dependencies.
 */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** JSON for an inline <script> (no </script> breakout). */
export function inlineJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}><path d="${d}"/></svg>`
export const ICON = {
  logo: svg('M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z'),
  grid: svg('M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z'),
  list: svg('M4 5h3v3H4V5Zm5 0h11v3H9V5ZM4 10.5h3v3H4v-3Zm5 0h11v3H9v-3ZM4 16h3v3H4v-3Zm5 0h11v3H9v-3Z'),
  folder: svg('M3 6a2 2 0 0 1 2-2h4.6l2 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z'),
  tag: svg('M3 3h8.6l9.4 9.4-8.6 8.6L3 11.6V3Zm4.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z'),
  search: svg('M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z'),
  lock: svg('M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z'),
  globe: svg('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 17.9A8 8 0 0 1 4.1 13H8a15 15 0 0 0 3 6.9Zm0-8.9H4.1A8 8 0 0 1 11 4.1 15 15 0 0 0 8 11h3Zm2 8.9A15 15 0 0 0 16 13h3.9a8 8 0 0 1-6.9 6.9ZM13 11V4.1a8 8 0 0 1 6.9 6.9H13Zm-2 2h3a13 13 0 0 1-1.5 5.3A13 13 0 0 1 11 13Zm1.5-7.3A13 13 0 0 1 14 11h-4a13 13 0 0 1 1.5-5.3l.5-.7.5.7Z'),
  users: svg('M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm-7 9a7 7 0 0 1 14 0v1H2v-1Zm15.5-9.2a3.5 3.5 0 0 0 0-6.6 5.5 5.5 0 0 1 0 6.6ZM18 14.2a8.9 8.9 0 0 1 3 6.8v0h1v-1a6 6 0 0 0-4-5.8Z'),
  pages: svg('M8 3h9a3 3 0 0 1 3 3v11h-2V6a1 1 0 0 0-1-1H8V3ZM4 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z'),
  star: svg('m12 2.5 2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6-5-4.5 6.6-.7L12 2.5Z'),
  arrow: svg('M13.3 5.3 19.9 12l-6.6 6.7-1.4-1.4 4.2-4.3H4v-2h12.1l-4.2-4.3 1.4-1.4Z'),
  back: svg('M10.7 5.3 4.1 12l6.6 6.7 1.4-1.4L7.9 13H20v-2H7.9l4.2-4.3-1.4-1.4Z'),
  external: svg('M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z'),
  info: svg('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1 8v7h2v-7h-2Zm0-4v2h2V6h-2Z'),
  copy: svg('M8 3h11a2 2 0 0 1 2 2v11h-2V5H8V3ZM4 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z'),
  edit: svg('M15.2 3.8a2.5 2.5 0 0 1 3.5 0l1.5 1.5a2.5 2.5 0 0 1 0 3.5L9 20H4v-5L15.2 3.8ZM6 15.8V18h2.2l8.9-8.9-2.2-2.2L6 15.8Z'),
  gear: svg('M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8.5-2.6ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z'),
  dash: svg('M3 5a2 2 0 0 1 2-2h5v8H3V5Zm0 8h7v8H5a2 2 0 0 1-2-2v-6Zm9-10h7a2 2 0 0 1 2 2v4h-9V3Zm0 8h9v8a2 2 0 0 1-2 2h-7V11Z'),
  laptop: svg('M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10H4V5Zm-2 12h20v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1Z'),
  home: svg('M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z'),
  out: svg('M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm5.6 4.6-1.4 1.4 2 2H9v2h7.2l-2 2 1.4 1.4L20 12l-4.4-4.4Z'),
  menu: svg('M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z'),
  eye: svg('M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z'),
  code: svg('m8.6 6.6 1.4 1.4L6 12l4 4-1.4 1.4L3.2 12l5.4-5.4Zm6.8 0L20.8 12l-5.4 5.4L14 16l4-4-4-4 1.4-1.4Z'),
  trash: svg('M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z'),
  check: svg('m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6L20.6 7.9l-1.4-1.4-9.7 9.7Z'),
  sun: svg('M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-1-6h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.2 2.8l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4Zm13.5 13.5 2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4Zm2.1-12.1-2.1 2.1-1.4-1.4 2.1-2.1 1.4 1.4ZM6.3 19.1l-2.1 2.1-1.4-1.4 2.1-2.1 1.4 1.4Z')
}

export const THEMES = {
  lumen: { label: 'Lumen', note: 'Clean neutrals with a teal accent.', accent: '#117865', swatch: ['#0d0f10', '#117865', '#f4f3f1'] },
  hemline: { label: 'Hemline', note: 'Deep green, brass and ivory, with Bodoni Moda headings.', accent: '#b08d57', swatch: ['#1e3a2b', '#b08d57', '#f3eee3'] }
}

function themeCss(site) {
  const t = THEMES[site?.theme] ? site.theme : 'lumen'
  const base =
    t === 'hemline'
      ? `:root{--bg:#f3eee3;--bg2:#ebe4d4;--surface:#fffdf8;--surface2:#f8f3e8;--fg:#1b2a21;--fg2:#3f4c43;--fg3:#6d766e;--line:#1e3a2b1f;--line2:#1e3a2b12;--brand:#1e3a2b;--brand-fg:#f3eee3;--accent:#9a7640;--accent-fg:#fff;--head:'Bodoni Moda',Georgia,serif;--body:'Jost','Segoe UI',system-ui,sans-serif;--radius:14px;--glow1:#b08d57;--glow2:#1e3a2b;--glow3:#6f8f5a}
@media (prefers-color-scheme:dark){:root{--bg:#0e1712;--bg2:#13201a;--surface:#15231c;--surface2:#1a2b22;--fg:#f3eee3;--fg2:#d6cfbf;--fg3:#9a9a8a;--line:#f3eee31f;--line2:#f3eee30f;--brand:#b08d57;--brand-fg:#0e1712;--accent:#c9a66b;--accent-fg:#0e1712}}`
      : `:root{--bg:#f5f5f3;--bg2:#ecebe8;--surface:#ffffff;--surface2:#f8f8f6;--fg:#18191a;--fg2:#45474a;--fg3:#75787c;--line:#0000001a;--line2:#0000000d;--brand:#18191a;--brand-fg:#fff;--accent:#117865;--accent-fg:#fff;--head:'Segoe UI Variable Display','Segoe UI','Selawik','Open Sans',system-ui,sans-serif;--body:'Segoe UI Variable Text','Segoe UI','Selawik','Open Sans',system-ui,-apple-system,sans-serif;--radius:14px;--glow1:#1aa58b;--glow2:#3b6fd8;--glow3:#9b5de5}
@media (prefers-color-scheme:dark){:root{--bg:#0c0e0f;--bg2:#111415;--surface:#16191b;--surface2:#1b1f21;--fg:#f2f1ef;--fg2:#c9c6c2;--fg3:#8d8a86;--line:#ffffff1a;--line2:#ffffff0d;--brand:#f2f1ef;--brand-fg:#0c0e0f;--accent:#4fd1b5;--accent-fg:#06231d}}`
  const accent = /^#[0-9a-f]{6}$/i.test(site?.accent ?? '') ? `:root{--accent:${site.accent}}` : ''
  return base + accent
}

const FONTS = {
  hemline: '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,700&family=Jost:wght@400;500;600&display=swap">'
}

export const BASE_CSS = `
:root{--soft:color-mix(in srgb,var(--accent) 13%,transparent);--soft2:color-mix(in srgb,var(--accent) 22%,transparent);--shadow:0 1px 2px #0000000f,0 10px 30px -16px #00000040;--shadow-lg:0 2px 6px #00000014,0 30px 60px -24px #00000059;--ok:#1a7f37;--warn:#b0620a;--bad:#c62828;--top:60px;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ok:#4ac26b;--warn:#f0a84b;--bad:#ff6b6b;--shadow:0 1px 2px #0000004d,0 10px 30px -16px #000000a0;--shadow-lg:0 2px 6px #00000066,0 30px 60px -24px #000000c0}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-padding-top:calc(var(--top) + 16px)}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:14.5px/1.55 var(--body);-webkit-font-smoothing:antialiased}
a{color:inherit}h1,h2,h3{font-family:var(--head);letter-spacing:-.015em;line-height:1.15;margin:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.skip{position:absolute;left:12px;top:-60px;z-index:100;padding:8px 14px;border-radius:8px;background:var(--accent);color:var(--accent-fg);font-weight:600;text-decoration:none}.skip:focus{top:12px}
svg{width:18px;height:18px;fill:currentColor;flex:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.aurora{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.aurora b{position:absolute;border-radius:50%;filter:blur(100px);opacity:.22;animation:drift 30s ease-in-out infinite alternate}
.aurora b:nth-child(1){width:52vw;height:52vw;left:-16vw;top:-26vw;background:radial-gradient(circle,var(--glow1) 0,transparent 70%)}
.aurora b:nth-child(2){width:44vw;height:44vw;right:-14vw;top:-20vw;background:radial-gradient(circle,var(--glow2) 0,transparent 70%);animation-delay:-9s}
.aurora b:nth-child(3){width:36vw;height:36vw;left:34vw;top:4vw;background:radial-gradient(circle,var(--glow3) 0,transparent 70%);opacity:.12;animation-delay:-18s}
@media (prefers-color-scheme:dark){.aurora b{opacity:.42}.aurora b:nth-child(3){opacity:.22}}
@keyframes drift{to{transform:translate3d(4vw,3vw,0) scale(1.08)}}
/* top bar */
.topbar{position:sticky;top:0;z-index:40;height:var(--top);display:flex;align-items:center;gap:8px;padding:0 20px;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);border-bottom:1px solid var(--line2)}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-family:var(--head);font-weight:700;font-size:16px;letter-spacing:-.01em;white-space:nowrap;margin-right:10px;min-width:0}
.brand span{overflow:hidden;text-overflow:ellipsis}
.logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 45%,var(--brand)));display:grid;place-items:center;box-shadow:0 4px 14px var(--soft2);flex:none}
.logo svg{width:17px;height:17px;fill:#fff}
.nav{display:flex;gap:2px}
.nav a{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px;border-radius:9px;color:var(--fg2);text-decoration:none;font-weight:500;transition:background .15s,color .15s}
.nav a:hover{background:var(--line2);color:var(--fg)}.nav a[aria-current=page]{background:var(--soft);color:var(--accent);font-weight:600}
.nav a svg{width:16px;height:16px}
.spacer{flex:1}
.searchbtn{display:flex;align-items:center;gap:10px;height:38px;min-width:240px;padding:0 10px 0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--fg3);font:inherit;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.searchbtn:hover{border-color:color-mix(in srgb,var(--accent) 50%,var(--line));box-shadow:0 0 0 4px var(--soft)}
.searchbtn span{flex:1;text-align:left}
kbd{font:600 11px/1 var(--body);color:var(--fg3);border:1px solid var(--line);border-bottom-width:2px;border-radius:6px;padding:3px 6px;background:var(--surface2)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 16px;border:1px solid transparent;border-radius:10px;background:var(--accent);color:var(--accent-fg);font:600 14px/1 var(--body);text-decoration:none;cursor:pointer;white-space:nowrap;transition:filter .15s,transform .15s,box-shadow .15s,background .15s}
.btn:hover{filter:brightness(1.07);box-shadow:0 6px 18px -8px var(--accent)}.btn:active{transform:translateY(1px)}
.btn svg{width:16px;height:16px}
.btn.ghost{background:var(--surface);color:var(--fg);border-color:var(--line)}.btn.ghost:hover{border-color:color-mix(in srgb,var(--accent) 50%,var(--line));box-shadow:none;filter:none}
.btn.quiet{background:transparent;color:var(--fg2);border-color:transparent}.btn.quiet:hover{background:var(--line2);box-shadow:none;filter:none}
.btn.danger{background:var(--bad);color:#fff}.btn.sm{height:32px;padding:0 12px;font-size:13px;border-radius:8px}.btn.lg{height:46px;padding:0 22px;font-size:15px;border-radius:12px}
.btn.icon{width:38px;padding:0}
.acct{position:relative}
.avatar{width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 40%,var(--brand)));color:#fff;font:700 14px/1 var(--body);display:grid;place-items:center;cursor:pointer;padding:0}
.menu{position:absolute;right:0;top:calc(100% + 8px);min-width:240px;padding:6px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-lg);display:none;z-index:60}
.menu.open{display:block;animation:pop .14s ease-out}
@keyframes pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
.menu .who{padding:10px 10px 12px;border-bottom:1px solid var(--line2);margin-bottom:6px}.menu .who b{display:block}.menu .who small{color:var(--fg3)}
.menu a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;text-decoration:none;color:var(--fg2)}.menu a:hover{background:var(--line2);color:var(--fg)}
.burger{display:none}
/* page */
.page{position:relative;z-index:1}
.wrap{max-width:1320px;margin:0 auto;padding:0 24px 72px}
.crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:16px 0 0;color:var(--fg3);font-size:13px}
.crumbs a{color:var(--fg3);text-decoration:none;border-radius:6px;padding:2px 4px;margin:0 -4px}.crumbs a:hover{color:var(--fg);background:var(--line2)}
.crumbs .sep{opacity:.5}.crumbs [aria-current]{color:var(--fg);font-weight:600}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;gap:16px;justify-content:space-between;padding:18px 0 22px}
.head h1{font-size:clamp(26px,3.2vw,36px);font-weight:700}
.head p{margin:6px 0 0;color:var(--fg3);max-width:720px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid var(--line);color:var(--fg2);background:var(--surface);white-space:nowrap;text-decoration:none}
.chip svg{width:13px;height:13px}
.chip.public{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent);background:color-mix(in srgb,var(--ok) 8%,var(--surface))}
.chip.password{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:color-mix(in srgb,var(--warn) 8%,var(--surface))}
.chip.users{color:var(--fg2)}.chip.star{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,transparent);background:var(--soft)}
a.chip:hover{border-color:var(--accent);color:var(--accent)}
.empty{display:grid;justify-items:center;text-align:center;gap:12px;padding:64px 24px;border:1px dashed var(--line);border-radius:var(--radius);background:var(--surface);color:var(--fg3)}
.empty h2{color:var(--fg);font-size:20px}
.empty .ill{width:72px;height:72px;border-radius:20px;display:grid;place-items:center;background:var(--soft);color:var(--accent)}.empty .ill svg{width:34px;height:34px}
footer.foot{position:relative;z-index:1;border-top:1px solid var(--line2);padding:22px 24px;color:var(--fg3);font-size:12.5px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
footer.foot a{color:var(--fg3);text-decoration:none}footer.foot a:hover{color:var(--fg)}
/* forms */
label.f{display:block;font-weight:600;font-size:13px;margin:16px 0 6px}label.f:first-child{margin-top:0}
.hint{color:var(--fg3);font-size:12.5px;margin-top:6px}
input[type=text],input[type=password],input[type=number],input[type=search],input[type=email],textarea,select{width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface2);color:var(--fg);font:inherit;transition:border-color .15s,box-shadow .15s}
textarea{height:auto;min-height:92px;padding:10px 12px;resize:vertical;line-height:1.5}
input:focus,textarea:focus,select:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 4px var(--soft)}
.switch{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid var(--line2);cursor:pointer}.switch:first-of-type{border-top:0}
.switch b{display:block;font-weight:600}.switch small{color:var(--fg3)}
.switch input{appearance:none;width:42px;height:24px;border-radius:99px;background:var(--line);position:relative;cursor:pointer;flex:none;transition:background .2s;margin:0}
.switch input::after{content:'';position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0004;transition:transform .2s}
.switch input:checked{background:var(--accent)}.switch input:checked::after{transform:translateX(18px)}
.tog{appearance:none;width:36px;height:20px;border-radius:99px;background:var(--line);position:relative;cursor:pointer;margin:0;vertical-align:middle;transition:background .2s}
.tog::after{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0004;transition:transform .2s}
.tog:checked{background:var(--accent)}.tog:disabled{opacity:.35;cursor:not-allowed}.tog:checked::after{transform:translateX(16px)}
.seg{display:inline-flex;padding:3px;border:1px solid var(--line);border-radius:11px;background:var(--surface)}
.seg button,.seg a{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:8px;background:none;color:var(--fg2);font:500 13.5px/1 var(--body);cursor:pointer;text-decoration:none}
.seg [aria-pressed=true],.seg [aria-current=page]{background:var(--fg);color:var(--bg)}
.seg svg{width:15px;height:15px}
pre.code{margin:0;padding:14px;border-radius:10px;background:var(--surface2);border:1px solid var(--line);font:12.5px/1.6 ui-monospace,'Cascadia Code',Menlo,monospace;white-space:pre-wrap;word-break:break-all}
.toast{position:fixed;left:50%;bottom:24px;z-index:90;transform:translateX(-50%) translateY(20px);opacity:0;display:flex;align-items:center;gap:10px;padding:11px 16px;border-radius:12px;background:var(--fg);color:var(--bg);font-weight:600;box-shadow:var(--shadow-lg);transition:opacity .25s,transform .25s;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%)}.toast svg{width:18px;height:18px}
/* command palette */
.pal{position:fixed;inset:0;z-index:80;display:none;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;background:#0006;backdrop-filter:blur(3px)}
.pal.open{display:flex}
.pal-box{width:min(640px,100%);border-radius:16px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow-lg);overflow:hidden;animation:pop .16s ease-out}
.pal-in{display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line2)}
.pal-in svg{color:var(--fg3)}.pal-in input{flex:1;height:56px;border:0;background:none;box-shadow:none;font-size:16px;padding:0}.pal-in input:focus{box-shadow:none}
.pal-list{max-height:min(420px,60vh);overflow:auto;padding:6px}
.pal-group{padding:10px 10px 4px;color:var(--fg3);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.pal-item{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:10px;text-decoration:none;color:var(--fg)}
.pal-item .pi{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:var(--surface2);border:1px solid var(--line2);color:var(--fg2);flex:none}.pal-item .pi svg{width:15px;height:15px}
.pal-item .pt{flex:1;min-width:0}.pal-item .pt b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pal-item .pt small{color:var(--fg3)}
.pal-item[aria-selected=true]{background:var(--soft)}.pal-item[aria-selected=true] .pi{background:var(--accent);color:var(--accent-fg);border-color:transparent}
.pal-foot{display:flex;gap:14px;padding:10px 16px;border-top:1px solid var(--line2);color:var(--fg3);font-size:12px}
.pal-none{padding:28px;text-align:center;color:var(--fg3)}
/* admin layout */
.adm{display:grid;grid-template-columns:248px 1fr;min-height:calc(100vh - var(--top))}
.side{position:sticky;top:var(--top);height:calc(100vh - var(--top));padding:18px 12px;border-right:1px solid var(--line2);background:color-mix(in srgb,var(--surface) 55%,transparent);display:flex;flex-direction:column;gap:2px}
.side .lbl{padding:14px 12px 6px;color:var(--fg3);font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}.side .lbl:first-child{padding-top:2px}
.side a{display:flex;align-items:center;gap:11px;height:38px;padding:0 12px;border-radius:9px;color:var(--fg2);text-decoration:none;font-weight:500}
.side a:hover{background:var(--line2);color:var(--fg)}.side a[aria-current=page]{background:var(--soft);color:var(--accent);font-weight:600}
.side a .n{margin-left:auto;font-size:12px;color:var(--fg3);font-weight:600}
.side .me{margin-top:auto;display:flex;align-items:center;gap:10px;padding:12px;border-radius:12px;border:1px solid var(--line2);background:var(--surface)}
.side .me .avatar{width:32px;height:32px;font-size:13px;cursor:default}.side .me div{min-width:0}.side .me b,.side .me small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.side .me small{color:var(--fg3);font-size:12px}
.adm-main{min-width:0;padding:0 32px 80px}
.adm-main .wrap{padding:0;max-width:1180px;margin:0}
@media (max-width:1060px){.searchbtn{min-width:0}.searchbtn span,.searchbtn kbd{display:none}}
@media (max-width:860px){
  .nav{display:none}.burger{display:inline-flex}
  .nav.open{display:flex;position:absolute;left:0;right:0;top:var(--top);flex-direction:column;padding:10px;background:var(--surface);border-bottom:1px solid var(--line);box-shadow:var(--shadow-lg)}
  .nav.open a{height:44px}
  .adm{grid-template-columns:1fr}
  .side{position:fixed;top:auto;bottom:0;left:0;right:0;height:auto;z-index:45;flex-direction:row;justify-content:space-around;padding:6px 6px calc(6px + env(safe-area-inset-bottom));border-right:0;border-top:1px solid var(--line);background:var(--surface)}
  .side .lbl,.side .me,.side a .n{display:none}
  .side a{flex-direction:column;gap:2px;height:auto;padding:6px 8px;font-size:11px;flex:1;justify-content:center;text-align:center}
  .adm-main{padding:0 16px 96px}
}
@media (max-width:640px){.wrap{padding:0 16px 56px}.topbar{padding:0 12px;gap:6px}.brand{margin-right:0}.brand span{max-width:44vw}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

const SHELL_SCRIPT = `
(() => {
  const $ = (s, r = document) => r.querySelector(s)
  // account menu and mobile nav
  const av = $('.avatar[aria-haspopup]'), menu = $('.menu')
  if (av && menu) {
    av.addEventListener('click', (e) => { e.stopPropagation(); const o = menu.classList.toggle('open'); av.setAttribute('aria-expanded', String(o)) })
    addEventListener('click', (e) => { if (!menu.contains(e.target)) { menu.classList.remove('open'); av.setAttribute('aria-expanded', 'false') } })
  }
  const burger = $('.burger'), nav = $('.nav')
  if (burger && nav) burger.addEventListener('click', () => { const o = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', String(o)) })
  // relative dates
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const rel = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (!isFinite(s)) return ''; for (const [u, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (s >= n) return rtf.format(-Math.floor(s / n), u); return 'just now' }
  for (const el of document.querySelectorAll('[data-rel]')) { const r = rel(el.dataset.rel); if (r) { el.title = new Date(el.dataset.rel).toLocaleString(); el.textContent = (el.dataset.prefix ?? '') + r } }
  // toast
  window.lumenToast = (msg) => { const t = $('.toast'); if (!t) return; t.querySelector('span').textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600) }
  const flash = document.body.dataset.flash; if (flash) setTimeout(() => window.lumenToast(flash), 150)
  // copy buttons
  for (const b of document.querySelectorAll('[data-copy]')) b.addEventListener('click', async (e) => { e.preventDefault(); const v = b.dataset.copy.startsWith('#') ? $(b.dataset.copy).textContent : b.dataset.copy; const abs = v.startsWith('/') ? location.origin + v : v; try { await navigator.clipboard.writeText(abs); window.lumenToast('Copied') } catch { window.lumenToast('Copy failed') } })
  // command palette
  const pal = $('.pal'); if (!pal) return
  const input = $('.pal-in input', pal), list = $('.pal-list', pal)
  let items = []
  try { items = JSON.parse($('#pal-data').textContent) } catch {}
  let shown = [], sel = 0
  const norm = (s) => String(s).toLowerCase()
  const score = (it, q) => { if (!q) return 1; const h = norm(it.t + ' ' + (it.s || '') + ' ' + (it.k || '')); let i = 0, last = -1, sc = 0; for (const ch of q) { const j = h.indexOf(ch, last + 1); if (j < 0) return 0; sc += j === last + 1 ? 3 : 1; last = j; i++ } if (norm(it.t).startsWith(q)) sc += 20; else if (norm(it.t).includes(q)) sc += 10; return sc }
  const render = () => {
    const q = norm(input.value.trim())
    shown = items.map((it) => [it, score(it, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([it]) => it)
    if (!q) shown = items.slice(0, 40)
    sel = Math.min(sel, Math.max(0, shown.length - 1))
    let html = '', g = ''
    shown.forEach((it, i) => { if (it.g !== g) { g = it.g; html += '<div class="pal-group">' + g + '</div>' } html += '<a class="pal-item" role="option" aria-selected="' + (i === sel) + '" data-i="' + i + '"><span class="pi">' + (ICONS[it.i] || ICONS.dash) + '</span><span class="pt"><b></b><small></small></span>' + (i === sel ? '<kbd>↵</kbd>' : '') + '</a>' })
    list.innerHTML = html || '<div class="pal-none">Nothing matches.</div>'
    list.querySelectorAll('.pal-item').forEach((a) => { const it = shown[a.dataset.i]; a.href = it.u; a.querySelector('b').textContent = it.t; a.querySelector('small').textContent = it.s || '' })
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }
  const open = () => { pal.classList.add('open'); input.value = ''; sel = 0; render(); setTimeout(() => input.focus(), 10) }
  const close = () => pal.classList.remove('open')
  for (const b of document.querySelectorAll('[data-palette]')) b.addEventListener('click', open)
  pal.addEventListener('click', (e) => { if (e.target === pal) close() })
  input.addEventListener('input', () => { sel = 0; render() })
  list.addEventListener('mousemove', (e) => { const a = e.target.closest('.pal-item'); if (a && +a.dataset.i !== sel) { sel = +a.dataset.i; render() } })
  addEventListener('keydown', (e) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !pal.classList.contains('open'))) { e.preventDefault(); pal.classList.contains('open') ? close() : open(); return }
    if (!pal.classList.contains('open')) return
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, shown.length); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + shown.length) % Math.max(1, shown.length); render() }
    else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); location.href = shown[sel].u }
  })
})()
`

const PAL_ICONS = ['dash', 'pages', 'folder', 'gear', 'laptop', 'home', 'edit', 'out', 'tag', 'lock']

function initial(user) {
  return esc(String(user?.name || user?.email || '?').trim().charAt(0).toUpperCase())
}

/**
 * Builds a page.
 *   site        { title, tagline, accent, theme }
 *   user        signed-in Google account or null; authEnabled: whether Google sign-in is set up
 *   title       document title; crumbs: [[label, href?], …] (the last one is the current page)
 *   nav         'dashboards' | 'collections' | 'admin' (current primary section)
 *   admin       { active } renders the admin sidebar; side: counts for it
 *   index       command palette entries [{ g: group, t: title, s: subtitle, u: url, i: icon, k: keywords }]
 *   body, head, script, flash (a toast shown on load), bodyClass
 */
export function shell(o) {
  const site = o.site ?? { title: 'Dashboards' }
  const theme = THEMES[site.theme] ? site.theme : 'lumen'
  const navItems = [
    ['/', 'Dashboards', 'dashboards', ICON.dash],
    ['/collections', 'Collections', 'collections', ICON.folder],
    ...(o.user ? [['/admin', 'Admin', 'admin', ICON.gear]] : [])
  ]
  const nav = navItems.map(([href, label, key, icon]) => `<a href="${href}"${o.nav === key ? ' aria-current="page"' : ''}>${icon}${label}</a>`).join('')
  const acct = o.user
    ? `<div class="acct"><button class="avatar" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Account: ${esc(o.user.email)}">${initial(o.user)}</button><div class="menu" role="menu"><div class="who"><b>${esc(o.user.name || o.user.email)}</b><small>${esc(o.user.email)}</small></div><a href="/admin" role="menuitem">${ICON.gear}Admin console</a><a href="/account" role="menuitem">${ICON.laptop}Connected computers</a><a href="/auth/logout" role="menuitem">${ICON.out}Sign out</a></div></div>`
    : o.authEnabled
      ? `<a class="btn ghost sm" href="/auth/login">Sign in</a>`
      : ''
  const crumbs = o.crumbs?.length
    ? `<nav class="crumbs" aria-label="Breadcrumb">${o.crumbs
        .map(([label, href], i, a) => (i === a.length - 1 || !href ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${esc(href)}">${esc(label)}</a><span class="sep" aria-hidden="true">/</span>`))
        .join('')}</nav>`
    : ''
  const index = [
    ...(o.index ?? []),
    { g: 'Go to', t: 'All dashboards', u: '/', i: 'home' },
    { g: 'Go to', t: 'Collections', u: '/collections', i: 'folder' },
    ...(o.user
      ? [
          { g: 'Admin', t: 'Manage dashboards', u: '/admin', i: 'gear', k: 'admin console edit' },
          { g: 'Admin', t: 'Site settings', u: '/admin/settings', i: 'gear', k: 'title theme accent' },
          { g: 'Admin', t: 'Connected computers', u: '/account', i: 'laptop', k: 'lumen keys' },
          { g: 'Admin', t: 'Sign out', u: '/auth/logout', i: 'out' }
        ]
      : o.authEnabled
        ? [{ g: 'Go to', t: 'Sign in', u: '/auth/login', i: 'out' }]
        : [])
  ]
  const side = o.admin
    ? `<aside class="side" aria-label="Admin"><div class="lbl">Manage</div>${[
        ['/admin', 'Dashboards', 'dashboards', ICON.dash, o.side?.dashboards],
        ['/admin/settings', 'Site settings', 'settings', ICON.gear],
        ['/account', 'Computers', 'account', ICON.laptop, o.side?.keys],
        ['/', 'View site', 'site', ICON.eye]
      ]
        .map(([href, label, key, icon, n]) => `<a href="${href}"${o.admin.active === key ? ' aria-current="page"' : ''}>${icon}<span>${label}</span>${n != null ? `<span class="n">${n}</span>` : ''}</a>`)
        .join('')}${o.user ? `<div class="me"><span class="avatar">${initial(o.user)}</span><div><b>${esc(o.user.name || 'Signed in')}</b><small>${esc(o.user.email)}</small></div></div>` : ''}</aside>`
    : ''
  const main = o.admin ? `<div class="adm">${side}<main class="adm-main" id="main"><div class="wrap">${crumbs}${o.body}</div></main></div>` : `<main class="page" id="main"><div class="wrap">${crumbs}${o.body}</div></main>`
  const icons = Object.fromEntries(PAL_ICONS.map((k) => [k, ICON[k]]))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="generator" content="Lumen Server">${o.admin ? '<meta name="robots" content="noindex">' : ''}<title>${esc(o.title ? `${o.title} · ${site.title}` : site.title)}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#117865"/><path fill="#fff" d="M6 18v-7h2.5v7H6Zm4.75 0V6h2.5v12h-2.5ZM15.5 18v-5H18v5h-2.5Z"/></svg>')}">
${FONTS[theme] ?? ''}<style>${themeCss(site)}${BASE_CSS}${o.css ?? ''}</style>${o.head ?? ''}</head>
<body class="${o.bodyClass ?? ''}"${o.flash ? ` data-flash="${esc(o.flash)}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
<div class="aurora" aria-hidden="true"><b></b><b></b><b></b></div>
<header class="topbar"><button class="btn quiet icon burger" type="button" aria-label="Menu" aria-expanded="false">${ICON.menu}</button><a class="brand" href="/"><span class="logo">${ICON.logo}</span><span>${esc(site.title)}</span></a><nav class="nav" aria-label="Main">${nav}</nav><div class="spacer"></div><button class="searchbtn" type="button" data-palette aria-label="Search dashboards (press /)">${ICON.search}<span>Search dashboards…</span><kbd>/</kbd></button>${acct}</header>
${main}
${o.admin ? '' : `<footer class="foot"><a href="/">All dashboards</a><a href="/collections">Collections</a>${o.user ? '<a href="/admin">Admin</a>' : ''}<span>Published with Lumen</span></footer>`}
<div class="pal" role="dialog" aria-modal="true" aria-label="Search"><div class="pal-box"><div class="pal-in">${ICON.search}<input type="text" placeholder="Search dashboards, pages, collections…" aria-label="Search" autocomplete="off"><kbd>Esc</kbd></div><div class="pal-list" role="listbox"></div><div class="pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>/</kbd> or <kbd>Ctrl K</kbd> anywhere</span></div></div></div>
<div class="toast" role="status" aria-live="polite">${ICON.check}<span></span></div>
<script type="application/json" id="pal-data">${inlineJson(index)}</script>
<script>const ICONS = ${inlineJson(icons)};${SHELL_SCRIPT}</script>${o.script ? `<script>${o.script}</script>` : ''}
</body></html>`
}

/** A small centred card page (password, sign-in messages, connect). */
export function cardPage(o) {
  return shell({
    ...o,
    css: `.solo{display:grid;place-items:center;min-height:calc(100vh - var(--top) - 140px);padding:24px 0}.solo .panel{width:min(460px,100%);padding:30px}.solo h1{font-size:26px;margin-bottom:8px}.solo p{color:var(--fg2);margin:0 0 18px}.solo .err{color:var(--bad);font-weight:600;margin-top:12px}.solo .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.solo .badge{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:var(--soft);color:var(--accent);margin-bottom:16px}.solo .badge svg{width:26px;height:26px}${o.css ?? ''}`,
    body: `<div class="solo"><div class="panel">${o.icon ? `<div class="badge">${ICON[o.icon] ?? ''}</div>` : ''}${o.body}</div></div>`
  })
}

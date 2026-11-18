#!/usr/bin/env node
/**
 * Lumen documentation: link check + PDF editions. Usage and requirements: scripts/docs/build-pdf.sh (and docs/STYLE.md).
 *
 * Pipeline per edition:
 *   1. article order: the sections' README.md tables (links in order of appearance); the combined edition follows the
 *      "All sections" table of docs/README.md. Articles no hub lists are appended (with a warning).
 *   2. each article → HTML fragment with pandoc (GFM, syntax highlighting) and scripts/docs/pdf-filter.lua
 *      (callouts, id prefixes, in-document links, absolute image paths);
 *   3. cover + table of contents + articles → one HTML file styled by scripts/docs/pdf.css (fonts embedded);
 *   4. Electron printToPDF (scripts/docs/pdf-print.cjs): A4, footer, PDF outline;
 *   5. pdfinfo page counts.
 * No npm dependencies beyond the repository's Electron.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const DOCS = join(ROOT, 'docs')
const FONTS = join(ROOT, 'src/renderer/src/assets/fonts/selawik')

/** PDF editions: id, output file, title, sections (folders under docs/), audience line for the cover. */
const EDITIONS = [
  { id: 'get-started', file: 'lumen-get-started.pdf', title: 'Get started', sections: ['get-started'], audience: 'Creators · Analysts · Developers' },
  { id: 'create-reports', file: 'lumen-create-reports.pdf', title: 'Create reports and visuals', sections: ['create-reports', 'visuals'], audience: 'Creators' },
  { id: 'data-and-modeling', file: 'lumen-data-and-modeling.pdf', title: 'Data, modeling and DAX', sections: ['connect-and-transform', 'model-data', 'dax'], audience: 'Analysts' },
  { id: 'files-and-compatibility', file: 'lumen-files-and-compatibility.pdf', title: 'Files and compatibility', sections: ['files-and-compatibility'], audience: 'Creators · Analysts · Developers' },
  { id: 'developer', file: 'lumen-developer-guide.pdf', title: 'Developer guide', sections: ['developer'], audience: 'Developers' },
  { id: 'reference', file: 'lumen-reference.pdf', title: 'Reference', sections: ['reference'], audience: 'Creators · Analysts · Developers' },
  { id: 'troubleshooting', file: 'lumen-troubleshooting.pdf', title: 'Troubleshooting', sections: ['troubleshooting'], audience: 'Creators · Analysts · Developers' }
]
const COMBINED = { id: 'documentation', file: 'lumen-documentation.pdf', title: 'Complete documentation', audience: 'Creators · Analysts · Developers' }

// ------------------------------------------------------------------------------------------------ arguments
const args = process.argv.slice(2)
const opt = { check: false, list: false, out: join(DOCS, 'pdf'), only: [], keep: false, warnLinks: false }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--check') opt.check = true
  else if (a === '--list') opt.list = true
  else if (a === '--keep-html') opt.keep = true
  else if (a === '--warn-links') opt.warnLinks = true
  else if (a === '--out') opt.out = resolve(args[++i] ?? '')
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(join(HERE, 'build-pdf.sh'), 'utf8').split('\n').filter((l) => l.startsWith('#')).map((l) => l.replace(/^# ?/, '')).join('\n'))
    process.exit(0)
  } else if (a.startsWith('-')) die(`unknown option ${a} (see --help)`)
  else opt.only.push(a)
}

function die(msg) {
  console.error(`build-pdf: ${msg}`)
  process.exit(2)
}

// ------------------------------------------------------------------------------------------------ markdown helpers
const posix = (p) => p.split(sep).join('/')

function walkMd(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (p === join(DOCS, 'pdf')) continue
      out.push(...walkMd(p))
    } else if (e.name.endsWith('.md')) out.push(p)
  }
  return out.sort()
}

/** Markdown text with fenced code blocks and inline code removed (links inside them are not links). */
function stripCode(md) {
  const lines = md.split('\n')
  let fence = null
  const out = []
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null
      out.push('')
      continue
    }
    if (m) {
      fence = m[1]
      out.push('')
      continue
    }
    out.push(line.replace(/(`+)[\s\S]*?\1/g, (s) => ' '.repeat(s.length)))
  }
  return out.join('\n')
}

/** Inline links and images: [{ text, target, image, line }]. */
function linksOf(md) {
  const src = stripCode(md)
  const out = []
  const re = /(!?)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g
  let m
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length
    out.push({ image: m[1] === '!', text: m[2], target: m[3], line })
  }
  return out
}

function slug(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** Headings need the original line (with inline code); stripCode blanks code spans, so re-read headings raw. */
function anchorsOfRaw(md) {
  // same as anchorsOf, but fenced blocks are skipped while code spans keep their text (GitHub keeps it in the slug)
  const lines = md.split('\n')
  let fence = null
  const kept = []
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence[0] && line.trim() === m[1]) fence = null
      continue
    }
    if (m) {
      fence = m[1]
      continue
    }
    kept.push(line)
  }
  const set = new Set()
  const counts = new Map()
  for (const line of kept) {
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (!h) continue
    const base = slug(h[1].replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    set.add(n ? `${base}-${n}` : base)
  }
  return set
}

// ------------------------------------------------------------------------------------------------ link check
function linkCheck() {
  const files = walkMd(DOCS)
  const anchorCache = new Map()
  const anchors = (abs) => {
    if (!anchorCache.has(abs)) anchorCache.set(abs, anchorsOfRaw(readFileSync(abs, 'utf8')))
    return anchorCache.get(abs)
  }
  const problems = []
  let count = 0
  for (const file of files) {
    const md = readFileSync(file, 'utf8')
    for (const l of linksOf(md)) {
      const t = l.target
      if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t)) continue
      count++
      const where = `${posix(relative(ROOT, file))}:${l.line}`
      const [pathPart, anchor] = t.split('#')
      let abs = file
      if (pathPart) {
        let decoded
        try {
          decoded = decodeURIComponent(pathPart)
        } catch {
          decoded = pathPart
        }
        abs = resolve(dirname(file), decoded)
        if (!existsSync(abs)) {
          problems.push(`${where}: ${l.image ? 'image' : 'link'} target not found: ${t}`)
          continue
        }
        if (statSync(abs).isDirectory()) {
          if (anchor) problems.push(`${where}: anchor on a folder link: ${t}`)
          continue
        }
      }
      if (anchor !== undefined && anchor !== '') {
        if (!abs.endsWith('.md')) continue
        if (!anchors(abs).has(anchor)) problems.push(`${where}: anchor #${anchor} not found in ${posix(relative(ROOT, abs))}`)
      }
    }
  }
  return { files: files.length, links: count, problems }
}

// ------------------------------------------------------------------------------------------------ article order
/** .md links of a hub file, in order, resolved relative to docs/; only those inside `withinDir` when given. */
function hubOrder(hubAbs, withinDir) {
  const md = readFileSync(hubAbs, 'utf8')
  const seen = new Set()
  const out = []
  for (const l of linksOf(md)) {
    if (l.image || /^[a-z][a-z0-9+.-]*:/i.test(l.target)) continue
    const p = l.target.split('#')[0]
    if (!p.endsWith('.md')) continue
    const rel = posix(relative(DOCS, resolve(dirname(hubAbs), p)))
    if (withinDir && dirname(rel) !== withinDir) continue
    if (!seen.has(rel)) {
      seen.add(rel)
      out.push(rel)
    }
  }
  return out
}

function sectionArticles(section, warnings) {
  const dir = join(DOCS, section)
  const hub = join(dir, 'README.md')
  if (!existsSync(dir)) return null
  const listed = existsSync(hub) ? hubOrder(hub, section).filter((r) => r !== `${section}/README.md` && existsSync(join(DOCS, r))) : []
  if (!existsSync(hub)) warnings.push(`${section}/README.md is missing: articles are in file-name order`)
  // sub-pages in sub-folders of the section (e.g. reference/dax-functions/*.md) follow the article that links them
  const ordered = []
  const placed = new Set()
  const place = (rel) => {
    if (placed.has(rel)) return
    placed.add(rel)
    ordered.push(rel)
    for (const sub of hubOrder(join(DOCS, rel)).filter((r) => r.startsWith(`${section}/`) && r.split('/').length > 2 && existsSync(join(DOCS, r)))) place(sub)
  }
  for (const r of listed) place(r)
  const all = walkMd(dir)
    .map((f) => posix(relative(DOCS, f)))
    .filter((r) => r !== `${section}/README.md` && !r.endsWith('/README.md'))
    .sort((x, y) => x.split('/').length - y.split('/').length || x.localeCompare(y))
  for (const r of all) {
    if (placed.has(r)) continue
    warnings.push(`${r} is not linked from ${section}/README.md (or from an article it lists): appended at the end of the section`)
    place(r)
  }
  return { hub: existsSync(hub) ? `${section}/README.md` : null, articles: ordered }
}

function hubSections() {
  const md = readFileSync(join(DOCS, 'README.md'), 'utf8')
  const start = md.indexOf('## All sections')
  const part = start >= 0 ? md.slice(start, md.indexOf('\n## ', start + 5) > 0 ? md.indexOf('\n## ', start + 5) : undefined) : md
  const out = []
  for (const l of linksOf(part)) {
    const m = /^([a-z0-9-]+)\/README\.md$/.exec(l.target)
    if (m && m[1] !== 'pdf' && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

// ------------------------------------------------------------------------------------------------ HTML
const idOf = (rel) => rel.replace(/\.md$/, '').replace(/\/README$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'hub'

let highlightCss = null
/** pandoc's syntax-highlighting CSS (the part of its standalone template after "CSS for syntax highlighting"). */
function pandocHighlightCss() {
  if (highlightCss !== null) return highlightCss
  const html = execFileSync('pandoc', ['-f', 'gfm', '-t', 'html5', '--standalone', '--metadata', 'title=x', '--highlight-style=pygments'], {
    input: '```js\nx\n```\n',
    encoding: 'utf8'
  })
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
  highlightCss = /\/\* CSS for syntax highlighting \*\/([\s\S]*)/.exec(css)?.[1] ?? ''
  return highlightCss
}

function renderArticle(rel, id, levelShift, mapFile) {
  const abs = join(DOCS, rel)
  const res = spawnSync(
    'pandoc',
    [
      '-f', 'gfm',
      '-t', 'html5',
      '--highlight-style=pygments',
      '--wrap=none',
      `--lua-filter=${join(HERE, 'pdf-filter.lua')}`,
      '--metadata', `article_id=${id}`,
      '--metadata', `article_dir=${posix(dirname(rel)) === '.' ? '' : posix(dirname(rel))}`,
      '--metadata', `docs_root=${DOCS}`,
      '--metadata', `edition_map=${mapFile}`,
      '--metadata', `level_shift=${levelShift}`,
      abs
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (res.status !== 0) throw new Error(`pandoc failed on ${rel}: ${res.stderr}`)
  if (res.stderr.trim()) for (const l of res.stderr.trim().split('\n')) console.warn(`  pandoc ${rel}: ${l}`)
  return res.stdout
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

function fontFaces() {
  const f = (file, weight) => `@font-face { font-family: 'Selawik'; src: url('file://${join(FONTS, file)}') format('woff2'); font-weight: ${weight}; font-style: normal; }`
  return [f('selawkl.woff2', 300), f('selawk.woff2', 400), f('selawksb.woff2', 600), f('selawkb.woff2', 700)].join('\n')
}

function gitInfo() {
  const run = (a) => {
    try {
      return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const commit = run(['rev-parse', '--short', 'HEAD']) || 'unknown'
  const dirty = run(['status', '--porcelain', '--', 'docs', ':!docs/pdf']) ? ' (with uncommitted changes)' : ''
  return { commit: commit + dirty, date: new Date().toISOString().slice(0, 10) }
}

/**
 * Build one edition's HTML. parts: [{ section, hub, articles }]. withHub: put docs/README.md first (combined edition).
 */
function editionHtml(edition, parts, withHub, work, info) {
  // map every article of this edition to its id, for in-document links
  const map = {}
  if (withHub) map['README.md'] = 'hub'
  for (const p of parts) {
    if (p.hub) map[p.hub] = idOf(p.hub)
    for (const a of p.articles) map[a] = idOf(a)
  }
  const mapFile = join(work, `${edition.id}-map.json`)
  writeFileSync(mapFile, JSON.stringify(map))

  const body = []
  const toc = []
  const disclaimer = readFileSync(join(DOCS, '_includes/disclaimer.md'), 'utf8').trim()
  const addPart = (rel, title) => {
    toc.push({ level: 1, id: idOf(rel), title })
  }
  if (withHub) {
    const html = renderArticle('README.md', 'hub', 0, mapFile)
    body.push(`<section class="part hub" id="hub">${html}</section>`)
    addPart('README.md', 'Lumen documentation')
  }
  for (const p of parts) {
    let title = p.section
    if (p.hub) {
      const html = renderArticle(p.hub, idOf(p.hub), 0, mapFile)
      title = stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? p.section)
      body.push(`<section class="part" id="${idOf(p.hub)}">${html}</section>`)
    } else body.push(`<section class="part" id="${idOf(p.section + '/README.md')}"><h1>${escHtml(p.section)}</h1></section>`)
    addPart(p.hub ?? `${p.section}/README.md`, title)
    for (const a of p.articles) {
      const html = renderArticle(a, idOf(a), 1, mapFile)
      const t = stripTags(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(html)?.[1] ?? a)
      toc.push({ level: 2, id: idOf(a), title: t })
      body.push(`<article class="doc" id="${idOf(a)}">${html}</article>`)
    }
  }
  const tocHtml = `<nav class="toc"><h1 class="toc-title">Contents</h1><ol>${toc
    .map((t) => `<li class="toc-l${t.level}"><a href="#${t.id}">${escHtml(t.title)}</a></li>`)
    .join('')}</ol></nav>`
  const cover = `<section class="cover">
    <div class="cover-brand">Lumen</div>
    <div class="cover-kind">Lumen documentation</div>
    <h1 class="cover-title">${escHtml(edition.title)}</h1>
    <div class="cover-audience">For ${escHtml(edition.audience)}</div>
    <div class="cover-meta">Built ${info.date} from commit ${escHtml(info.commit)}</div>
    <div class="cover-disclaimer">${escHtml(disclaimer)}</div>
  </section>`
  const css = readFileSync(join(HERE, 'pdf.css'), 'utf8')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lumen documentation: ${escHtml(edition.title)}</title>
<style>${fontFaces()}\n${pandocHighlightCss()}\n${css}</style></head>
<body>${cover}${tocHtml}${body.join('\n')}</body></html>`
}

// ------------------------------------------------------------------------------------------------ main
function main() {
  const t0 = Date.now()
  // 1. link check
  const lc = linkCheck()
  if (lc.problems.length) {
    console.error(`Link check: ${lc.problems.length} broken link(s) in ${lc.files} Markdown files:`)
    for (const p of lc.problems) console.error(`  ${p}`)
    if (!opt.warnLinks || opt.check) process.exit(1)
    console.error('Continuing because of --warn-links.')
  } else
  console.log(`Link check: ${lc.links} relative links and images in ${lc.files} Markdown files, all resolve.`)
  if (opt.check) return

  // 2. editions
  const warnings = []
  const sectionsOf = (names) => names.map((s) => ({ section: s, ...(sectionArticles(s, warnings) ?? { missing: true }) })).filter((p) => !p.missing)
  const hubList = hubSections()
  const known = new Set(EDITIONS.flatMap((e) => e.sections))
  for (const s of hubList) if (!known.has(s)) warnings.push(`section ${s}/ is in the hub but in no edition: it is only in the combined PDF`)
  const plan = EDITIONS.map((e) => {
    const parts = sectionsOf(e.sections)
    for (const s of e.sections) if (!parts.some((p) => p.section === s)) warnings.push(`section ${s}/ does not exist yet: left out of ${e.file}`)
    return { edition: e, parts, withHub: false }
  })
  plan.push({ edition: COMBINED, parts: sectionsOf(hubList), withHub: true })

  if (opt.list) {
    for (const p of plan) {
      console.log(`${p.edition.id.padEnd(24)} ${p.edition.file}`)
      for (const part of p.parts) console.log(`    ${part.section}/ (${part.articles.length} articles)`)
    }
    for (const w of warnings) console.warn(`warning: ${w}`)
    return
  }
  const wanted = opt.only.length ? plan.filter((p) => opt.only.includes(p.edition.id)) : plan
  for (const o of opt.only) if (!plan.some((p) => p.edition.id === o)) die(`unknown edition ${o} (see --list)`)
  for (const w of warnings) console.warn(`warning: ${w}`)

  mkdirSync(opt.out, { recursive: true })
  const work = mkdtempSync(join(tmpdir(), 'lumen-docs-pdf-'))
  const info = gitInfo()
  const jobs = []
  for (const p of wanted) {
    if (!p.parts.length && !p.withHub) {
      console.warn(`warning: ${p.edition.file}: no sections exist yet, skipped`)
      continue
    }
    const html = editionHtml(p.edition, p.parts, p.withHub, work, info)
    const htmlPath = join(work, `${p.edition.id}.html`)
    writeFileSync(htmlPath, html)
    jobs.push({ html: htmlPath, pdf: join(opt.out, p.edition.file), footer: p.withHub ? 'Lumen documentation' : `Lumen documentation · ${p.edition.title}` })
  }
  const jobsFile = join(work, 'jobs.json')
  writeFileSync(jobsFile, JSON.stringify(jobs))
  console.log(`Printing ${jobs.length} PDF(s)…`)

  // 3. print with Electron (private X display when xvfb-run exists)
  const electron = join(ROOT, 'node_modules/.bin/electron')
  if (!existsSync(electron)) die('Electron not found in node_modules: run npm install')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const hasXvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0
  const cmd = hasXvfb && !process.env.LUMEN_DOCS_USE_DISPLAY ? 'xvfb-run' : electron
  const cmdArgs = hasXvfb && !process.env.LUMEN_DOCS_USE_DISPLAY ? ['-a', electron, join(HERE, 'pdf-print.cjs'), jobsFile] : [join(HERE, 'pdf-print.cjs'), jobsFile]
  const r = spawnSync(cmd, cmdArgs, { env, stdio: 'inherit' })
  if (r.status !== 0) die(`printing failed (exit ${r.status})`)

  // 4. page counts
  console.log('')
  console.log(`${'PDF'.padEnd(46)} pages      size`)
  for (const j of jobs) {
    let pages = '?'
    try {
      pages = /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [j.pdf], { encoding: 'utf8' }))?.[1] ?? '?'
    } catch {
      /* pdfinfo missing */
    }
    const kb = Math.round(statSync(j.pdf).size / 1024)
    console.log(`${posix(relative(ROOT, j.pdf)).padEnd(46)} ${String(pages).padStart(5)} ${String(kb).padStart(7)} KB`)
  }
  if (opt.keep) console.log(`HTML kept in ${work}`)
  else rmSync(work, { recursive: true, force: true })
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s.`)
}

main()

#!/usr/bin/env node
/**
 * Fetches Microsoft's published DAX and Power Query M function lists (the tables of contents of the
 * DAX reference and the Power Query M reference on Microsoft Learn) and caches them, with their
 * retrieval date, under scripts/docs/data/. The reference generators (gen-dax-function-support,
 * gen-m-function-support) compare Lumen's function registries with these lists.
 *
 * Only function names and their category headings are kept; no documentation text is copied.
 *
 *   node scripts/docs/gen-dax-m-fetch-microsoft-lists.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data')
const SOURCES = [
  { file: 'ms-dax-functions.json', url: 'https://learn.microsoft.com/en-us/dax/toc.json', root: 'DAX functions' },
  { file: 'ms-m-functions.json', url: 'https://learn.microsoft.com/en-us/powerquery-m/toc.json', root: 'Functions' }
]

/** Leaves under `root`: { name, category } where category is the heading the leaf sits under. */
function collect(node, inRoot, category, out) {
  for (const c of node.children ?? node.items ?? []) {
    // "DISTINCT (column)" / "DISTINCT (table)": one function with two reference pages
    const title = (c.toc_title ?? '').trim().replace(/\s*\((column|table)\)$/i, '')
    const kids = c.children ?? []
    if (!inRoot) {
      collect(c, title === rootName, null, out)
      continue
    }
    if (kids.length) collect(c, true, title, out)
    else if (category && !/overview$/i.test(title) && /^[A-Za-z_][\w.]*$/.test(title)) out.push({ name: title, category: category.replace(/ functions$/i, '') })
  }
}
let rootName = ''

mkdirSync(OUT, { recursive: true })
for (const s of SOURCES) {
  const res = await fetch(s.url)
  if (!res.ok) throw new Error(`${s.url}: HTTP ${res.status}`)
  const toc = await res.json()
  rootName = s.root
  const out = []
  collect(toc, false, null, out)
  const seen = new Set()
  const functions = out.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)))
  if (functions.length < 100) throw new Error(`${s.url}: only ${functions.length} functions found; the page layout may have changed`)
  const doc = { source: s.url, retrievedAt: new Date().toISOString().slice(0, 10), count: functions.length, functions }
  writeFileSync(join(OUT, s.file), JSON.stringify(doc, null, 1) + '\n')
  console.log(`${s.file}: ${functions.length} functions`)
}

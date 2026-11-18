#!/usr/bin/env node
// List every environment variable Lumen's code, tests and scripts read, and check that
// docs/reference/command-line-and-environment.md documents each one.
// Usage: node scripts/docs/check-env-vars.mjs [--list]
//   --list  print "NAME<TAB>file:line, ..." for every variable found and exit 0
// Exit code 1 when a variable is missing from the article.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIRS = ['src', 'e2e', 'tests', 'scripts', 'datasets/src']
const EXT = /\.(ts|tsx|mjs|js|sh)$/
const ARTICLE = join(ROOT, 'docs/reference/command-line-and-environment.md')
// Variables that are not Lumen settings (set by tools, or only forwarded).
const IGNORE = new Set(['HOME', 'PATH', 'NVM_DIR', 'DISPLAY'])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (EXT.test(name)) yield p
  }
}

const found = new Map()
const add = (name, where) => {
  if (IGNORE.has(name)) return
  if (!found.has(name)) found.set(name, [])
  if (!found.get(name).includes(where)) found.get(name).push(where)
}
for (const d of DIRS) {
  for (const file of walk(join(ROOT, d))) {
    if (file.endsWith('check-env-vars.mjs')) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const where = `${relative(ROOT, file)}:${i + 1}`
      for (const m of line.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g)) add(m[1] ?? m[2], where)
      for (const m of line.matchAll(/\benv\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g)) add(m[1], where)
      // showOnPrivateDisplay(win, 'WBI_…') and similar indirect reads in src/main
      for (const m of line.matchAll(/showOnPrivateDisplay\([^,]+,\s*'([A-Z_][A-Z0-9_]*)'\)/g)) add(m[1], where)
      if (file.endsWith('.sh')) for (const m of line.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g)) add(m[1], where)
    })
  }
}

const names = [...found.keys()].sort()
if (process.argv.includes('--list')) {
  for (const n of names) console.log(`${n}\t${found.get(n).join(', ')}`)
  process.exit(0)
}
const doc = readFileSync(ARTICLE, 'utf8')
const missing = names.filter((n) => !doc.includes('`' + n + '`'))
if (missing.length) {
  console.error(`not documented in ${relative(ROOT, ARTICLE)}:`)
  for (const n of missing) console.error(`  ${n}  (${found.get(n).slice(0, 3).join(', ')})`)
  process.exit(1)
}
console.log(`${names.length} environment variables, all documented.`)

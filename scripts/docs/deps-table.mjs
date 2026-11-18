#!/usr/bin/env node
// Print the direct npm dependencies of Lumen as Markdown tables (runtime, then development), with the installed
// version and the licence declared in each package's own package.json. Used for
// docs/developer/dependencies-and-licences.md; run after `npm install` and paste the output there.
// Usage: node scripts/docs/deps-table.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function info(name) {
  const p = join(ROOT, 'node_modules', name, 'package.json')
  if (!existsSync(p)) return { version: '(not installed)', license: '?' }
  const j = JSON.parse(readFileSync(p, 'utf8'))
  const lic = typeof j.license === 'string' ? j.license : j.license?.type ?? (Array.isArray(j.licenses) ? j.licenses.map((l) => l.type ?? l).join(' OR ') : '?')
  return { version: j.version, license: lic }
}

function table(title, deps) {
  const rows = Object.keys(deps ?? {}).sort().map((n) => {
    const i = info(n)
    return `| \`${n}\` | ${deps[n]} | ${i.version} | ${i.license} |`
  })
  return [`### ${title}`, '', '| Package | Declared | Installed | Licence |', '|---|---|---|---|', ...rows, ''].join('\n')
}

console.log(table('Runtime dependencies', pkg.dependencies))
console.log(table('Development dependencies', pkg.devDependencies))

#!/usr/bin/env node
// Summarize a sweep output folder (scripts/sweep.sh): per report / page counts and every visual that is
// not 'ok', plus slow pages, console errors, engine probe errors / warnings and card values.
// Usage: node scripts/sweep-summary.mjs <outdir> [--all] [--cards] [--json]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [dir, ...flags] = process.argv.slice(2)
if (!dir) {
  console.error('usage: node scripts/sweep-summary.mjs <outdir> [--all] [--cards] [--json]')
  process.exit(2)
}
const ALL = flags.includes('--all')
const CARDS = flags.includes('--cards')
const JSON_OUT = flags.includes('--json')
const CARD_TYPES = new Set(['card', 'cardVisual', 'multiRowCard', 'kpi', 'gauge'])
const one = (s, n = 140) => String(s ?? '').replace(/\s*\n\s*/g, ' ⏎ ').slice(0, n)

// (symlinked report folders count too: existsSync follows links)
const reports = readdirSync(dir)
  .filter((n) => existsSync(join(dir, n, 'report.json')))
  .sort()
  .map((n) => ({ name: n, r: JSON.parse(readFileSync(join(dir, n, 'report.json'), 'utf8')) }))

if (JSON_OUT) {
  const out = reports.map(({ name, r }) => ({ name, error: r.error, totals: r.totals, pages: r.pages.map((p) => ({ page: p.displayName, counts: p.counts, renderMs: p.renderMs, readyTimedOut: p.readyTimedOut })) }))
  console.log(JSON.stringify(out, null, 1))
  process.exit(0)
}

for (const { name, r } of reports) {
  const t = r.totals ?? {}
  console.log(`\n## ${name}  open ${r.openMs ?? '?'} ms${r.synthetic ? `, synthetic ${r.synthetic.tables} tables` : ''}  ${JSON.stringify(t)}${r.error ? `  ERROR: ${r.error}` : ''}${r.engineError ? `  ENGINE: ${r.engineError}` : ''}`)
  if (r.cacheBlocked === false) console.log('   !! cache guard was OFF')
  const st = r.selectionTotals
  if (st) console.log(`   selections: ${st.selections} on ${st.slicers} slicer(s); ${st.emptiedSelections} emptied ${st.emptied} visual(s) that had data (${st.emptiedVisuals} distinct)${st.cappedPages ? `; ${st.cappedPages} page(s) capped` : ''}`)
  if (r.inProgress) console.log(`   !! did not finish: stuck rendering page ${r.inProgress} (renderer hang or timeout)`)
  for (const d of r.diagnostics ?? []) if (d.level !== 'info') console.log(`   diag ${d.level}: ${one(d.message, 200)}`)
  for (const p of r.pages) {
    const flagsTxt = [p.kind !== 'normal' ? p.kind : '', p.hidden ? 'hidden' : '', p.readyTimedOut ? 'READY-TIMEOUT' : '', p.renderMs > 5000 ? `slow ${p.renderMs} ms` : ''].filter(Boolean).join(', ')
    console.log(` - ${p.displayName}${flagsTxt ? ` (${flagsTxt})` : ''}  ${JSON.stringify(p.counts)}`)
    for (const c of p.consoleErrors ?? []) console.log(`     console: ${one(c, 220)}`)
    for (const t of p.selections?.trials ?? []) {
      const names = t.emptied.map((n) => p.visuals.find((v) => v.name === n)).map((v, i) => (v ? `${v.visualType}${v.title ? ` "${one(v.title, 40)}"` : ''}` : t.emptied[i]))
      console.log(`     selection ${one(t.item, 40)} (slicer ${t.slicer}) empties ${names.join(', ')}`)
    }
    for (const v of p.visuals) {
      const bad = v.state !== 'ok' && v.state !== 'hidden'
      const probeBad = v.probe?.error || v.probe?.warnings?.length || (v.probe?.ms ?? 0) > 300
      const card = CARDS && CARD_TYPES.has(v.visualType) && v.state !== 'hidden'
      if (!ALL && !bad && !probeBad && !card) continue
      const parts = [`${v.state.padEnd(13)} ${v.visualType}`, v.title ? `"${one(v.title, 60)}"` : v.name]
      if (v.message) parts.push(`msg: ${one(v.message, 160)}`)
      if (card || ALL) parts.push(`text: ${one(v.text, 120)}`)
      if (v.probe?.error) parts.push(`probe error: ${one(v.probe.error, 200)}`)
      if (v.probe?.warnings?.length) parts.push(`warnings: ${one(v.probe.warnings.join('; '), 200)}`)
      if ((v.probe?.ms ?? 0) > 300) parts.push(`query ${v.probe.ms} ms`)
      if (card && v.probe?.totals) parts.push(`engine: ${v.probe.totals.map((x) => `${x.field}=${x.formatted}`).join('; ')}`)
      console.log(`     ${parts.join(' | ')}`)
    }
  }
}

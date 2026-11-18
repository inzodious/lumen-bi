/**
 * Lumen dataset generator CLI (Node 24, runs TypeScript directly):
 *
 *   node datasets/src/node/cli.ts list
 *   node datasets/src/node/cli.ts generate <universe|all> [--scale tiny|small|large] [--seed 42]
 *        [--out datasets/out] [--today 2026-11-30] [--formats delta,csv]
 *   node datasets/src/node/cli.ts validate <universe|all> [--scale tiny] [--seed 42] [--today ...]
 *   node datasets/src/node/cli.ts docs [--seed 42] [--today ...]   (refresh datasets/docs/*.md at small scale)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectIssue } from '../core/chaos.ts'
import { parseIso } from '../core/calendar.ts'
import { collectUniverse, DEFAULT_TODAY } from '../core/runner.ts'
import type { ScaleName, Universe } from '../core/schema.ts'
import { SCALES } from '../core/schema.ts'
import { UNIVERSES } from '../core/universes/index.ts'
import { columnValues, validateCollected } from '../core/validate.ts'
import { generateUniverse, readmeForDocs } from './generate.ts'
import type { OutputFormat } from './generate.ts'

interface Args {
  cmd: string
  target?: string
  scale: ScaleName
  seed: number
  out: string
  today: Date
  formats: OutputFormat[]
  verbose: boolean
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? 'help', scale: 'small', seed: 42, out: 'datasets/out', today: DEFAULT_TODAY, formats: ['delta'], verbose: false }
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i]
    const v = () => {
      const x = argv[++i]
      if (x === undefined) throw new Error(`missing value for ${k}`)
      return x
    }
    if (k === '--scale') {
      const s = v()
      if (!(s in SCALES)) throw new Error(`unknown scale ${s} (tiny|small|large)`)
      a.scale = s as ScaleName
    } else if (k === '--seed') a.seed = Number(v())
    else if (k === '--out') a.out = v()
    else if (k === '--today') a.today = parseIso(v())
    else if (k === '--formats') a.formats = v().split(',').map((x) => x.trim()) as OutputFormat[]
    else if (k === '--verbose' || k === '-v') a.verbose = true
    else if (!k.startsWith('-') && !a.target) a.target = k
    else throw new Error(`unknown argument ${k}`)
  }
  for (const f of a.formats) if (f !== 'delta' && f !== 'csv') throw new Error(`unknown format ${f} (delta|csv)`)
  if (!Number.isFinite(a.seed)) throw new Error('--seed must be a number')
  return a
}

function pick(target: string | undefined): Universe[] {
  if (!target) throw new Error('which universe? (an id from `list`, or `all`)')
  if (target === 'all') return UNIVERSES
  const u = UNIVERSES.find((x) => x.id === target)
  if (!u) throw new Error(`unknown universe "${target}" — try: ${UNIVERSES.map((x) => x.id).join(', ')}`)
  return [u]
}

function mb(b: number): string {
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2))
  switch (a.cmd) {
    case 'list':
      for (const u of UNIVERSES) console.log(`${u.id.padEnd(14)} ${u.company} — ${u.tagline}`)
      return
    case 'generate': {
      for (const u of pick(a.target)) {
        const r = await generateUniverse(u, { seed: a.seed, scale: a.scale, today: a.today, outDir: a.out, formats: a.formats, log: a.verbose ? console.log : undefined })
        const gold = [...r.rows].filter(([n]) => n.startsWith('gold_')).reduce((s, [, n]) => s + n, 0)
        const facts = u.tables.filter((t) => t.layer === 'gold' && t.kind === 'fact').reduce((s, t) => s + (r.rows.get(t.name) ?? 0), 0)
        console.log(`${u.id.padEnd(14)} ${(r.ms / 1000).toFixed(1).padStart(6)} s  ${mb(r.totalBytes).padStart(9)}  ${String(r.fileCount).padStart(6)} files  gold rows ${gold.toLocaleString('en-US')} (facts ${facts.toLocaleString('en-US')})  → ${r.dir}`)
      }
      return
    }
    case 'validate': {
      let failed = 0
      for (const u of pick(a.target)) {
        const c = collectUniverse(u, { seed: a.seed, scale: a.scale, today: a.today })
        const rep = validateCollected(c)
        const refs = (table: string, column: string) => new Set(columnValues(c.tables.get(table)!, column).map((v) => String(v).trim().toUpperCase()))
        const missing = u.issues.map((i) => detectIssue(i, c.bronze, refs)).filter((d) => d.found === 0)
        const ok = rep.errors.length === 0 && missing.length === 0
        if (!ok) failed++
        console.log(`${u.id.padEnd(14)} ${ok ? 'OK ' : 'FAIL'} ${rep.checks} structural checks, ${u.issues.length} bronze issues`)
        for (const e of rep.errors.slice(0, 20)) console.log(`   ✗ ${e}`)
        for (const m of missing) console.log(`   ✗ bronze issue ${m.code} not found (${m.detail})`)
      }
      if (failed) process.exitCode = 1
      return
    }
    case 'docs': {
      const docsDir = join(import.meta.dirname, '..', '..', 'docs')
      mkdirSync(docsDir, { recursive: true })
      for (const u of UNIVERSES) {
        const opts = { seed: a.seed, scale: 'small' as const, today: a.today }
        const r = await generateUniverse(u, { ...opts, outDir: a.out, formats: ['delta'] })
        writeFileSync(join(docsDir, `${u.id}.md`), readmeForDocs(u, opts, r))
        console.log(`docs/${u.id}.md`)
      }
      return
    }
    default:
      console.log('usage: node datasets/src/node/cli.ts list | generate <universe|all> [--scale tiny|small|large] [--seed N] [--out DIR] [--today YYYY-MM-DD] [--formats delta,csv] | validate <universe|all> | docs')
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})

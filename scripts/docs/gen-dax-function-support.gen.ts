/**
 * Generates docs/reference/dax-function-support.md and docs/reference/dax-functions/*.md.
 *
 *   npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts gen-dax
 *
 * Sources of truth:
 *   - implemented: the production DAX engine's function registry (src/core/dax/tabular, FUNCTIONS). Every DAX
 *     function call is dispatched through this registry (Evaluator.call); a name that is not in it, and is not a
 *     user-defined function, raises "The function '…' is not supported by this engine".
 *   - comparison list: Microsoft's DAX function reference table of contents, cached with its retrieval date in
 *     scripts/docs/data/ms-dax-functions.json (refresh with scripts/docs/gen-dax-m-fetch-microsoft-lists.mjs).
 *   - the DAX editor's function catalog (src/renderer/src/editors/dax/functions.ts): autocomplete entries that the
 *     engine does not implement are listed so readers are not misled by autocomplete.
 *   - notes and "partial" statuses: the NOTES table below. Each entry names its evidence (code or a query run on the
 *     built-in sample); keep it that way.
 */
import { it } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FUNCTIONS } from '../../src/core/dax/tabular/index.ts'
import { DAX_FUNCTIONS } from '../../src/renderer/src/editors/dax/functions'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT_MAIN = join(ROOT, 'docs/reference/dax-function-support.md')
const OUT_DIR = join(ROOT, 'docs/reference/dax-functions')

type Status = 'Implemented' | 'Partial' | 'Not implemented'
interface Note {
  status?: Status
  note: string
}

/** Function notes. Evidence in the comment above each entry. */
const NOTES: Record<string, Note> = {
  // fn-aggregate.ts: shares the DISTINCTCOUNT implementation
  APPROXIMATEDISTINCTCOUNT: { note: 'Returns the exact distinct count (same as DISTINCTCOUNT).' },
  // fn-scalar.ts FORMAT: the third argument is never read; sample query FORMAT ( 1234.5, "#,0.00", "de-DE" ) = 1,234.50
  FORMAT: { status: 'Partial', note: 'The locale argument is accepted but ignored: values are always formatted for en-US.' },
  // fn-scalar.ts: () => 'en-US'
  USERCULTURE: { status: 'Partial', note: 'Always returns en-US.' },
  // fn-scalar.ts: placeholders when no user is configured; the app never configures one
  USERNAME: { status: 'Partial', note: 'There is no signed-in user: returns LOCAL\\user.' },
  USERPRINCIPALNAME: { status: 'Partial', note: 'There is no signed-in user: returns user@localhost. View as cannot simulate another user.' },
  USEROBJECTID: { status: 'Partial', note: 'There is no signed-in user: returns an all-zero GUID.' },
  CUSTOMDATA: { status: 'Partial', note: 'Always blank (there is no connection string).' },
  // fn-filter.ts: (ev, a, env) => ev.value(a[0], env)
  EVALUATEANDLOG: { status: 'Partial', note: 'Returns its value; nothing is logged.' },
  // sample query: CONVERT ( 1.23456, CURRENCY ) = 1.23456
  CONVERT: { status: 'Partial', note: 'Converting to CURRENCY does not round to four decimal places.' },
  // fn-time.ts yearEndArg: returns a month number only
  ...Object.fromEntries(
    ['TOTALYTD', 'DATESYTD', 'PREVIOUSYEAR', 'NEXTYEAR', 'STARTOFYEAR', 'ENDOFYEAR', 'OPENINGBALANCEYEAR', 'CLOSINGBALANCEYEAR'].map((n) => [
      n,
      { note: 'Year-end date: only its month is used (the fiscal year ends on the last day of that month).' }
    ])
  ),
  // fn-table.ts: always throws UNSUPPORTED
  KMEANSCLUSTERING: { status: 'Not implemented', note: 'Recognised, but always raises an error: Power BI computes clusters with its own algorithm.' },
  // fn-window.ts: throws unless used as an argument of a window function
  ORDERBY: { note: 'Only as an argument of OFFSET, INDEX, WINDOW, RANK or ROWNUMBER (as in Power BI).' },
  PARTITIONBY: { note: 'Only as an argument of OFFSET, INDEX, WINDOW, RANK or ROWNUMBER (as in Power BI).' },
  MATCHBY: { note: 'Only as an argument of OFFSET, INDEX, WINDOW, RANK or ROWNUMBER (as in Power BI).' },
  // fn-aggregate.ts "legacy names"
  STDEV: { note: 'Excel-style name; same as STDEV.S.' },
  STDEVA: { note: 'Excel-style name; same as STDEV.S.' },
  VAR: { note: 'Excel-style name; same as VAR.S. (As a keyword, VAR declares a variable.)' },
  VARA: { note: 'Excel-style name; same as VAR.S.' },
  // fn-table.ts: Power BI's internal paging function in generated visual queries
  TOPNSKIP: { note: 'Internal function that Power BI writes into generated visual queries.' },
  // visualcalc.ts: evaluated over the visual matrix only
  RUNNINGSUM: { note: 'Visual calculations only.' },
  MOVINGAVERAGE: { note: 'Visual calculations only.' },
  PREVIOUS: { note: 'Visual calculations only.' },
  NEXT: { note: 'Visual calculations only.' },
  FIRST: { note: 'Visual calculations only.' },
  LAST: { note: 'Visual calculations only.' },
  RANGE: { note: 'Visual calculations only.' },
  COLLAPSE: { note: 'Visual calculations only.' },
  COLLAPSEALL: { note: 'Visual calculations only.' },
  EXPAND: { note: 'Visual calculations only.' },
  EXPANDALL: { note: 'Visual calculations only.' },
  LOOKUP: { note: 'Visual calculations only.' },
  LOOKUPWITHTOTALS: { note: 'Visual calculations only.' },
  ISATLEVEL: { note: 'Visual calculations only.' }
}

const VISUAL_CALC = new Set(['RUNNINGSUM', 'MOVINGAVERAGE', 'PREVIOUS', 'NEXT', 'FIRST', 'LAST', 'RANGE', 'COLLAPSE', 'COLLAPSEALL', 'EXPAND', 'EXPANDALL', 'LOOKUP', 'LOOKUPWITHTOTALS', 'ISATLEVEL'])

/** Introductory notes per category page (facts about the whole category). */
const CATEGORY_INTRO: Record<string, string> = {
  'Time intelligence':
    "Classic (date-column based) time intelligence is implemented. The week-based functions (DATESWTD, TOTALWTD, STARTOFWEEK, …) work only with Power BI's calendar-based time intelligence, which Lumen does not implement. See [Time intelligence](../../dax/time-intelligence.md).",
  INFO: "The INFO functions query the metadata of Power BI's Analysis Services engine. Lumen has no such engine and implements none of them. To inspect a model, use Model view and the Properties pane.",
  Financial: 'No financial function is implemented.',
  Statistical: 'The probability distribution functions (NORM.DIST, T.DIST, …) and LINEST / LINESTX are not implemented.'
}

function slug(category: string): string {
  return category.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|')
}

it('generates the DAX function support reference', () => {
  const ms = JSON.parse(readFileSync(join(ROOT, 'scripts/docs/data/ms-dax-functions.json'), 'utf8')) as {
    source: string
    retrievedAt: string
    functions: Array<{ name: string; category: string }>
  }
  // internal helpers (user-defined function dispatch) start with "__"
  const implemented = new Set([...FUNCTIONS.keys()].filter((n) => !n.startsWith('__')))
  const msNames = new Set(ms.functions.map((f) => f.name.toUpperCase()))
  const catalog = new Map(DAX_FUNCTIONS.map((f) => [f.name.toUpperCase(), f]))

  const statusOf = (name: string): Status => NOTES[name]?.status ?? (implemented.has(name) ? 'Implemented' : 'Not implemented')

  // ---- per-category pages (Microsoft's categories) ----------------------------------------------------------------
  const byCat = new Map<string, string[]>()
  for (const f of ms.functions) {
    const list = byCat.get(f.category) ?? []
    list.push(f.name.toUpperCase())
    byCat.set(f.category, list)
  }
  const categories = [...byCat.keys()].sort()
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  const summary: Array<{ cat: string; total: number; impl: number; partial: number; missing: number }> = []
  const header = (title: string) => `<!-- Generated by scripts/docs/gen-dax-function-support.gen.ts. Do not edit by hand. -->\n\n# ${title}\n\n> **Applies to:** Analysts · Developers\n\n`
  for (const cat of categories) {
    const names = [...new Set(byCat.get(cat)!)].sort()
    let impl = 0
    let partial = 0
    let missing = 0
    const rows = names.map((n) => {
      const st = statusOf(n)
      if (st === 'Implemented') impl++
      else if (st === 'Partial') partial++
      else missing++
      return `| ${esc(n)} | ${st} | ${esc(NOTES[n]?.note ?? '')} |`
    })
    summary.push({ cat, total: names.length, impl, partial, missing })
    let md = header(`DAX ${cat === 'INFO' ? 'INFO' : cat.toLowerCase()} functions in Lumen`)
    md += `Support status, in Lumen's DAX engine, of every function that Microsoft's DAX reference lists under **${cat} functions**: `
    md += `${impl} implemented, ${partial} partial and ${missing} not implemented, out of ${names.length}.\n\n`
    if (CATEGORY_INTRO[cat]) md += `${CATEGORY_INTRO[cat]}\n\n`
    md += '| Function | Status | Notes |\n|---|---|---|\n' + rows.join('\n') + '\n\n'
    md += '## Related content\n\n- [DAX function support (all categories)](../dax-function-support.md)\n- [Known differences from the Power BI engine](../../dax/known-differences-from-the-power-bi-engine.md)\n- [DAX in Lumen](../../dax/dax-in-lumen-overview.md)\n'
    writeFileSync(join(OUT_DIR, `${slug(cat)}.md`), md)
  }

  // ---- functions Lumen implements that Microsoft's list does not contain ---------------------------------------------
  const extras = [...implemented].filter((n) => !msNames.has(n)).sort()
  const extraRows = extras.map((n) => {
    const kind = VISUAL_CALC.has(n) ? 'Visual calculation' : n === 'TOPNSKIP' ? 'Power BI internal' : 'Lumen extension'
    return `| ${esc(n)} | ${kind} | ${esc(NOTES[n]?.note ?? '')} |`
  })

  // editor catalog entries the engine does not implement (autocomplete offers them)
  const catalogOnly = [...catalog.keys()].filter((n) => !implemented.has(n)).sort()

  // ---- main page ----------------------------------------------------------------------------------------------------
  const tot = summary.reduce((a, s) => ({ total: a.total + s.total, impl: a.impl + s.impl, partial: a.partial + s.partial, missing: a.missing + s.missing }), { total: 0, impl: 0, partial: 0, missing: 0 })
  let md = header('DAX function support')
  md += "This reference lists which DAX functions Lumen's DAX engine implements. Use it to check whether a measure written for Power BI Desktop evaluates in Lumen, and where results can differ.\n\n"
  md += "> [!NOTE]\n> This page and its category pages are generated from the engine's function registry by `scripts/docs/gen-dax-function-support.gen.ts`. "
  md += `The comparison list is the table of contents of Microsoft's DAX function reference (<${ms.source}>), retrieved on ${ms.retrievedAt}; `
  md += 'a function Microsoft added after that date is missing from these tables. To refresh both, run `node scripts/docs/gen-dax-m-fetch-microsoft-lists.mjs`, then `npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts gen-dax`.\n\n'
  md += '## How to read the status\n\n'
  md += '- **Implemented**: the engine evaluates the function. Where a difference from Power BI is known, the Notes column says so.\n'
  md += '- **Partial**: the function evaluates, but part of its documented behaviour is missing or different. The Notes column says what.\n'
  md += "- **Not implemented**: a formula that calls the function fails with *The function 'NAME' is not supported by this engine (unknown DAX function).* A visual that uses such a measure shows an error instead of a value.\n\n"
  md += '"Implemented" means the function is in the engine\'s registry; it is not a guarantee that every argument combination matches Power BI. '
  md += 'See [Known differences from the Power BI engine](../dax/known-differences-from-the-power-bi-engine.md) for behaviour that differs across functions, such as numeric types and locale.\n\n'
  md += '## Summary by category\n\n| Category | Functions | Implemented | Partial | Not implemented |\n|---|---|---|---|---|\n'
  for (const s of summary) md += `| [${s.cat}](dax-functions/${slug(s.cat)}.md) | ${s.total} | ${s.impl} | ${s.partial} | ${s.missing} |\n`
  md += `| **All** | **${tot.total}** | **${tot.impl}** | **${tot.partial}** | **${tot.missing}** |\n\n`
  md += "Categories follow Microsoft's reference.\n\n"
  md += "## Functions not in Microsoft's list\n\n"
  md += `The engine also accepts ${extras.length} functions that the comparison list does not contain:\n\n`
  md += '- **Visual calculation**: functions Microsoft documents with visual calculations rather than in the DAX function list. They work only inside a visual calculation.\n'
  md += '- **Power BI internal**: functions that Power BI writes into its own generated queries; Lumen accepts them so that copied queries run.\n'
  md += "- **Lumen extension**: Excel-style functions the engine accepts but Microsoft's DAX reference does not document. Do not use them in a model you also open in Power BI Desktop: it is not expected to accept them.\n\n"
  md += '| Function | Kind | Notes |\n|---|---|---|\n' + extraRows.join('\n') + '\n\n'
  md += '## Statements and keywords\n\n'
  md += "These are part of the language rather than functions, and are supported: `VAR` / `RETURN`, `EVALUATE`, `DEFINE` with `MEASURE`, `VAR`, `TABLE`, `COLUMN` and `FUNCTION`, `ORDER BY`, `START AT`, the `IN` operator and table constructors `{ … }`. "
  md += 'A query-scoped `DEFINE TABLE` can be evaluated and used as a table expression, but its columns cannot be referenced as `Table[Column]`; see [Known differences](../dax/known-differences-from-the-power-bi-engine.md).\n\n'
  if (catalogOnly.length) {
    md += '## Autocomplete entries without an implementation\n\n'
    md += `The DAX editor's autocomplete offers ${catalogOnly.length} function${catalogOnly.length === 1 ? '' : 's'} that the engine does not implement: ${catalogOnly.map((n) => `\`${n}\``).join(', ')}. A formula that uses ${catalogOnly.length === 1 ? 'it' : 'them'} fails when it is evaluated.\n\n`
  }
  md += '## Related content\n\n- [DAX in Lumen](../dax/dax-in-lumen-overview.md)\n- [Known differences from the Power BI engine](../dax/known-differences-from-the-power-bi-engine.md)\n- [Troubleshoot a measure](../dax/troubleshoot-a-measure.md)\n- [M function support](m-function-support.md)\n- [DAX function reference on Microsoft Learn](https://learn.microsoft.com/dax/dax-function-reference)\n'
  writeFileSync(OUT_MAIN, md)

  console.log(`categories: ${categories.length}; implemented ${tot.impl}/${tot.total}; partial ${tot.partial}; extras ${extras.length}; catalog-only ${catalogOnly.join(',')}`)
  console.log(readdirSync(OUT_DIR).join(' '))
})

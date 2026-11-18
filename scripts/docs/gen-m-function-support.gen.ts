/**
 * Generates docs/reference/m-function-support.md and docs/reference/m-functions/*.md from the M engine's
 * standard library (src/core/m/lib: `createLibrary`, the names the interpreter really binds) compared with
 * Microsoft's published Power Query M function list (scripts/docs/data/ms-m-functions.json, refreshed by
 * scripts/docs/gen-dax-m-fetch-microsoft-lists.mjs).
 *
 *   npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts gen-m-function-support
 *
 * Status of a function:
 *  - Implemented: the library binds it to a working function.
 *  - Recognized, not available: the library binds it, but calling it raises an error that explains what to use
 *    instead (sources that need Windows drivers, a Microsoft service sign-in or a browser engine).
 *  - Not implemented: in Microsoft's list, not bound by Lumen (a query that calls it fails with
 *    "The name '…' wasn't recognized" or, for names Lumen knows about, "… is not supported in Lumen yet").
 */
import { it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createLibrary } from '../../src/core/m/lib/index.ts'
import { installConnectors } from '../../src/core/m/lib/connectors.ts'
import { Library } from '../../src/core/m/lib/util.ts'
import { MFunction, noHost } from '../../src/core/m/index.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'docs/reference')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

interface MsList {
  source: string
  retrievedAt: string
  functions: Array<{ name: string; category: string }>
}

/** Functions whose calls the data fetcher refuses (src/core/data/fetcher.ts), with the reason shown to the user. */
const HOST_REFUSED: Record<string, { request: string; note: string }> = {
  'Lakehouse.Contents': { request: "case 'lakehouse-contents'", note: 'Needs the Fabric workspace API, which Lumen does not call. Use the lakehouse SQL analytics endpoint with Sql.Database, or the Lakehouse folder (Delta) connector on a local copy.' },
  'Lakehouse.Tables': { request: "case 'lakehouse-contents'", note: 'Same as Lakehouse.Contents.' },
  'Fabric.Warehouse': { request: "case 'lakehouse-contents'", note: 'Same as Lakehouse.Contents: use the warehouse SQL endpoint with Sql.Database.' },
  'SharePoint.Files': { request: "case 'sharepoint-files'", note: 'Needs SharePoint sign-in. Sync or download the library and use Folder.Files on the local folder (same columns).' },
  'SharePoint.Contents': { request: "case 'sharepoint-files'", note: 'Same as SharePoint.Files.' }
}

/** Short notes on implemented functions that behave differently from Power Query (each checked in the code named). */
const NOTES: Record<string, string> = {
  'Value.NativeQuery': 'Only on a Sql.Database, PostgreSQL.Database, MySQL.Database, SQLite.Database or DuckDB.Database result; parameters are substituted as literals (src/core/m/lib/sources.ts).',
  'Sql.Database': 'SQL Server, Azure SQL, Fabric SQL endpoints (tedious). Navigation reads fold; Query option runs a native query. Windows authentication is not available.',
  'Web.Contents': 'Requests run in the main process with stored web credentials (API key, Basic, bearer, OAuth 2.0) applied by URL prefix.',
  'OData.Feed': 'OData v4 JSON only; follows @odata.nextLink; no query folding.',
  'Xml.Tables': 'Table inference approximates Power Query (src/core/m/lib/sources.ts).',
  'DeltaLake.Table': 'Replays _delta_log (checkpoints, partitions, column mapping). Tables with deletion vectors are refused; no time travel.',
  'Csv.Document': 'Encodings: UTF-8, Windows code pages, UTF-16 and other common code pages; UTF-7 is refused.',
  'Number.ToText': 'Standard formats G, D, F, N, P and simple custom patterns; other formats raise an error.',
  'Expression.Evaluate': 'Evaluates in the given environment record or the library scope.',
  'Table.SelectRows': 'Folds to the source for simple predicates (see Query folding).',
  'Table.Schema': 'Returns six columns (Name, Position, TypeName, IsNullable, Kind, Description) whose TypeName, Kind and Description values differ from Power Query (src/core/m/lib/extra.ts).',
  'Table.NestedJoin': 'Folds into one SQL join when both sides come from the same database and the joined column is expanded right away.'
}

const CATEGORY_ORDER = ['Accessing data', 'Binary', 'Combiner', 'Comparer', 'Date', 'DateTime', 'DateTimeZone', 'Duration', 'Error handling', 'Expression', 'Function values', 'Lines', 'List', 'Logical', 'Number', 'Record', 'Replacer', 'Splitter', 'Table', 'Text', 'Time', 'Type', 'Uri', 'Value']
const slug = (c: string) => c.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const esc = (s: string) => s.replace(/\|/g, '\\|')

it('generates the M function support reference', () => {
  const ms = JSON.parse(read('scripts/docs/data/ms-m-functions.json')) as MsList
  const { entries, unsupported } = createLibrary({ call: () => null, host: noHost(), localOffsetMinutes: 0 })
  const fns = new Set([...entries].filter(([, v]) => v instanceof MFunction).map(([k]) => k))
  const constants = [...entries].filter(([, v]) => !(v instanceof MFunction)).map(([k]) => k)

  // stubs: def("Name", "...", unsupportedSource("Name", "guidance"))
  const stubs = new Map<string, string>()
  const sources = read('src/core/m/lib/sources.ts')
  for (const m of sources.matchAll(/def\("([^"]+)",\s*"[^"]*",\s*unsupportedSource\("[^"]+",\s*(?:"((?:[^"\\]|\\.)*)"|(\w+))\)\)/g)) {
    let guidance = m[2]
    if (!guidance && m[3]) guidance = new RegExp(`const ${m[3]} =\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(sources)?.[1]
    stubs.set(m[1]!, (guidance ?? '').replace(/\\"/g, '"'))
  }
  const fetcher = read('src/core/data/fetcher.ts')
  for (const [name, h] of Object.entries(HOST_REFUSED)) {
    if (!fetcher.includes(h.request)) throw new Error(`fetcher.ts no longer has ${h.request}: review HOST_REFUSED for ${name}`)
    if (!fns.has(name)) throw new Error(`${name} is no longer bound: review HOST_REFUSED`)
  }

  type Row = { name: string; status: string; note: string }
  const status = (name: string): Row => {
    if (stubs.has(name)) return { name, status: 'Recognized, not available', note: stubs.get(name)!.replace(/^./, (c) => c.toUpperCase()) }
    if (HOST_REFUSED[name]) return { name, status: 'Recognized, not available', note: HOST_REFUSED[name]!.note }
    if (fns.has(name)) return { name, status: 'Implemented', note: NOTES[name] ?? '' }
    if (unsupported.has(name)) return { name, status: 'Not implemented', note: 'Lumen recognizes the name and reports that it is not supported yet.' }
    return { name, status: 'Not implemented', note: '' }
  }

  const msNames = new Set(ms.functions.map((f) => f.name))
  const byCat = new Map<string, Row[]>()
  for (const f of ms.functions) {
    const list = byCat.get(f.category) ?? []
    list.push(status(f.name))
    byCat.set(f.category, list)
  }
  const cats = [...byCat.keys()].sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
  const extras = [...fns].filter((n) => !msNames.has(n) && !n.startsWith('#')).sort()
  const literals = [...fns].filter((n) => n.startsWith('#')).sort()

  const header = (title: string) =>
    `<!-- Generated by scripts/docs/gen-m-function-support.gen.ts. Do not edit by hand. -->\n\n# ${title}\n\n> **Applies to:** Analysts · Developers\n\n`
  mkdirSync(join(OUT, 'm-functions'), { recursive: true })

  // index
  let md = header('Power Query M function support')
  md += `This reference lists, for every function in Microsoft's Power Query M function list, whether Lumen's M engine implements it. Use it before you paste a query from Power BI Desktop or write one in the Advanced editor.\n\n`
  md += `> [!NOTE]\n> This page is generated from Lumen's M standard library (\`src/core/m/lib\`) and compared with Microsoft's published function list, retrieved from ${ms.source.replace('/toc.json', '/')} on ${ms.retrievedAt}. Functions Microsoft adds after that date are not listed. Regenerate with \`npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts gen-m-function-support\`.\n\n`
  md += `## Status values\n\n| Status | Meaning |\n|---|---|\n| Implemented | The function works in Lumen. A note says where it differs from Power Query. |\n| Recognized, not available | Lumen knows the function, but calling it raises an error that says what to use instead (Windows drivers, Microsoft service sign-in or a browser engine are not available). |\n| Not implemented | Calling the function fails. |\n\n`
  md += `Functions that take a culture (for example \`Number.FromText\`, \`Date.ToText\`) support \`en-US\`, \`en-GB\`, \`de-DE\` and \`fr-FR\`; \`Culture.Current\` is \`en-US\`. Any other culture raises an error.\n\n`
  let ti = 0
  let tm = 0
  md += `## By category\n\n| Category | Implemented | Recognized, not available | Not implemented |\n|---|---|---|---|\n`
  for (const c of cats) {
    const rows = byCat.get(c)!
    const n = (s: string) => rows.filter((r) => r.status === s).length
    ti += n('Implemented')
    tm += rows.length
    md += `| [${c}](m-functions/${slug(c)}.md) | ${n('Implemented')} | ${n('Recognized, not available')} | ${n('Not implemented')} |\n`
  }
  md += `\nIn total Lumen implements ${ti} of the ${tm} functions in Microsoft's list.\n\n`
  const own = new Library({ call: () => null, host: noHost(), localOffsetMinutes: 0 })
  installConnectors(own)
  md += `## Functions not in Microsoft's list\n\nLumen also binds these names. Functions marked *Lumen connector* are Lumen's own (\`src/core/m/lib/connectors.ts\`): Power BI Desktop does not have them, so a query that uses them does not refresh there. The others are Power Query functions that Microsoft's function reference does not list.\n\n`
  md += `| Function | Origin | Status |\n|---|---|---|\n`
  for (const n of extras) md += `| \`${n}\` | ${own.entries.has(n) ? 'Lumen connector' : 'Power Query'} | ${status(n).status} |\n`
  md += '\n'
  if (literals.length) md += `Literal constructors such as ${literals.map((l) => `\`${l}\``).join(', ')} are also available.\n\n`
  md += `The library also defines ${constants.length} constants and enumeration values (for example \`Day.Monday\`, \`JoinKind.LeftOuter\`, \`Int64.Type\`).\n\n`
  md += `## Related content\n\n- [Write M in the Advanced editor](../connect-and-transform/write-m-in-the-advanced-editor.md)\n- [Query folding](../connect-and-transform/query-folding.md)\n- [Connector support](connector-support.md)\n- [Power Query editor](../connect-and-transform/power-query-editor.md)\n`
  writeFileSync(join(OUT, 'm-function-support.md'), md)

  for (const c of cats) {
    const rows = byCat.get(c)!.sort((a, b) => a.name.localeCompare(b.name))
    let p = header(`${c} functions (M)`)
    p += `Support for Power Query M ${c.toLowerCase()} functions in Lumen. Generated from the M standard library and Microsoft's function list (retrieved ${ms.retrievedAt}); see [M function support](../m-function-support.md) for the status values.\n\n`
    p += `| Function | Status | Notes |\n|---|---|---|\n`
    for (const r of rows) p += `| \`${r.name}\` | ${r.status} | ${esc(r.note)} |\n`
    p += `\n## Related content\n\n- [M function support](../m-function-support.md)\n- [Write M in the Advanced editor](../../connect-and-transform/write-m-in-the-advanced-editor.md)\n`
    writeFileSync(join(OUT, 'm-functions', `${slug(c)}.md`), p)
  }
})

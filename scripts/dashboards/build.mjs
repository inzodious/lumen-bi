#!/usr/bin/env node
/**
 * Generate the live dashboards: node scripts/dashboards/build.mjs [id…]
 *
 * Each design in scripts/dashboards/designs/<id>.mjs is a gallery template built out into a working report: a star
 * schema of mock data embedded in the model ("Enter data" tables, so it refreshes offline in Lumen and in Power BI
 * Desktop), measures in `_measures_kpi` / `_measures_format`, and pages whose visuals are bound to the model. The
 * output is a PBIP project under examples/dashboards/<Name>/ and is checked in; rerun this after changing a design.
 */
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setLiveQueries } from '../templates/lib.mjs'
import { json, write, writeReport } from '../templates/pbir.mjs'
import { modelFiles } from './model.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outRoot = join(here, '..', '..', 'examples', 'dashboards')

setLiveQueries(true)

function build(design) {
  const dir = join(outRoot, design.name)
  rmSync(dir, { recursive: true, force: true })
  const sm = join(dir, `${design.name}.SemanticModel`)
  const rp = join(dir, `${design.name}.Report`)
  write(
    join(dir, `${design.name}.pbip`),
    json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json', version: '1.0', artifacts: [{ report: { path: `${design.name}.Report` } }], settings: { enableAutoRecovery: true } })
  )
  write(join(sm, 'definition.pbism'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json', version: '4.2', settings: {} }))
  for (const [p, text] of Object.entries(modelFiles(design))) write(join(sm, 'definition', p), text)
  writeReport(design, rp)
}

const designDir = join(here, 'designs')
const only = process.argv.slice(2)
for (const f of readdirSync(designDir).filter((f) => f.endsWith('.mjs')).sort()) {
  const d = (await import(pathToFileURL(join(designDir, f)).href)).default
  if (only.length && !only.includes(d.id)) continue
  build(d)
  console.log(`built ${d.id}`)
}

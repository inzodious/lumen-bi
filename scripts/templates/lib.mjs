/**
 * Building blocks for the gallery report templates (scripts/templates/build.mjs).
 *
 * Each design (scripts/templates/designs/*.mjs) describes a PBIP project in plain JS: sample tables and
 * measures, a custom theme, SVG artwork as registered resources and pages of visuals bound to the sample
 * fields. The build turns the tables into the report's sample dataset and each visual's fields into its
 * `Lumen_SampleData` annotation, so the template ships with empty visuals and no data tables. The helpers here turn
 * that into the PBIR / TMDL files Power BI Desktop writes. Everything is deterministic: ids and
 * lineage tags are hashes of the template id and the object's name, so a rebuild changes nothing.
 */
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------------------------

export function hex(seed, n = 20) {
  return createHash('sha1').update(seed).digest('hex').slice(0, n)
}

export function uuid(seed) {
  const h = createHash('sha1').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Small deterministic PRNG (mulberry32) for sample data. */
export function rng(seed) {
  let a = parseInt(hex(String(seed), 8), 16) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------------------------
// PBIR literal expressions
// ---------------------------------------------------------------------------------------------

const COLOR = Symbol('color')

/** A solid color property value. */
export const c = (hexColor) => ({ [COLOR]: hexColor })

/** Raw property value (already in PBIR shape). */
const RAW = Symbol('raw')
export const raw = (v) => ({ [RAW]: v })

export function literal(v) {
  if (typeof v === 'boolean') return { expr: { Literal: { Value: v ? 'true' : 'false' } } }
  if (typeof v === 'number') return { expr: { Literal: { Value: Number.isInteger(v) && Math.abs(v) > 1e6 ? `${v}L` : `${v}D` } } }
  if (typeof v === 'string') return { expr: { Literal: { Value: `'${v.replace(/'/g, "''")}'` } } }
  throw new Error(`literal: ${v}`)
}

export function propValue(v) {
  if (v && typeof v === 'object' && COLOR in v) return { solid: { color: literal(v[COLOR]) } }
  if (v && typeof v === 'object' && RAW in v) return v[RAW]
  return literal(v)
}

/** `{ show: true, color: c('#fff') }` → PBIR `properties`. */
export function props(o) {
  const out = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = propValue(v)
  return out
}

/**
 * Objects bag: `{ title: { show: false }, dataPoint: [{ fill: c('#f00') }, { selector: …, fill: … }] }`.
 * An entry may carry `$selector`.
 */
export function objects(o) {
  if (!o) return undefined
  const out = {}
  for (const [name, val] of Object.entries(o)) {
    if (val === undefined) continue
    const list = Array.isArray(val) ? val : [val]
    out[name] = list.map((entry) => {
      const { $selector, ...rest } = entry
      const e = { properties: props(rest) }
      if ($selector) e.selector = $selector
      return e
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------------------------------

/** `m('Sales', 'Revenue')` — a measure; `col('Sales', 'Region')` — a column. */
export const m = (entity, prop) => ({ kind: 'Measure', entity, prop })
export const col = (entity, prop) => ({ kind: 'Column', entity, prop })

function fieldExpr(f) {
  return { [f.kind]: { Expression: { SourceRef: { Entity: f.entity } }, Property: f.prop } }
}

function projection(f) {
  const p = { field: fieldExpr(f), queryRef: `${f.entity}.${f.prop}`, nativeQueryRef: f.prop }
  if (f.displayName) p.displayName = f.displayName
  return p
}

/** Rename a field in one visual (PBI "Rename for this visual"). */
export const as = (f, displayName) => ({ ...f, displayName })

// ---------------------------------------------------------------------------------------------
// visuals
// ---------------------------------------------------------------------------------------------

const VC_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.8.0/schema.json'

/**
 * Templates keep each visual's fields in its `Lumen_SampleData` annotation (empty visuals drawing a sample). The
 * live dashboards (scripts/dashboards) bind the same fields for real: the visual's own `query`.
 */
let liveQueries = false
export function setLiveQueries(on) {
  liveQueries = !!on
}

/** Container defaults for a template visual: no background, no header, title off unless given. */
function containerObjects(o = {}) {
  const { title, subTitle, background, border, shadow, padding, header, divider, spacing, ...rest } = o
  const vco = {
    background: background === undefined ? { show: false } : background === false ? { show: false } : { show: true, ...background },
    border: border ? { show: true, ...border } : { show: false },
    visualHeader: { show: header === true },
    title: title ? (typeof title === 'string' ? { show: true, text: title } : { show: true, ...title }) : { show: false }
  }
  if (subTitle) vco.subTitle = typeof subTitle === 'string' ? { show: true, text: subTitle } : { show: true, ...subTitle }
  if (divider) vco.divider = { show: true, ...divider }
  if (spacing) vco.spacing = spacing
  if (shadow) vco.dropShadow = { show: true, ...shadow }
  if (padding !== undefined) vco.padding = typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding } : padding
  Object.assign(vco, rest)
  return objects(vco)
}

/**
 * One visual container.
 * spec: { type, x, y, w, h, z?, roles?: { Category: [field], Y: [...] }, sort?: { field, dir }, objects?, box?, style?, motion?, hidden?, name? }
 *  - box: container formatting (title, background, border, shadow, padding…)
 *  - style: Lumen-only container effects, saved as the `Lumen_Style` annotation (see report/lumenStyle.ts)
 */
export function visual(seed, spec) {
  const name = hex(`${seed}/${spec.name ?? JSON.stringify([spec.type, spec.x, spec.y, spec.w, spec.h])}`)
  const v = { visualType: spec.type }
  let sample
  if (spec.roles) {
    const queryState = {}
    for (const [role, fields] of Object.entries(spec.roles)) queryState[role] = { projections: fields.map(projection) }
    sample = { query: { queryState } }
    if (spec.sort) sample.query.sortDefinition = { sort: [{ field: fieldExpr(spec.sort.field), direction: spec.sort.dir ?? 'Descending' }], isDefaultSort: true }
  }
  if (sample && liveQueries) {
    v.query = sample.query
    sample = undefined
  }
  if (spec.objects) v.objects = objects(spec.objects)
  if (spec.rawObjects) v.objects = { ...(v.objects ?? {}), ...spec.rawObjects }
  if (spec.syncGroup) v.syncGroup = { groupName: spec.syncGroup, fieldChanges: true, filterChanges: true }
  if (sample && v.objects) {
    const { plain, fieldBound } = splitFieldObjects(v.objects)
    if (plain) v.objects = plain
    else delete v.objects
    if (fieldBound) sample.objects = fieldBound
  }
  v.visualContainerObjects = containerObjects(spec.box)
  if (spec.vcoExtra) Object.assign(v.visualContainerObjects, spec.vcoExtra)
  v.drillFilterOtherVisuals = true
  const out = {
    $schema: VC_SCHEMA,
    name,
    position: { x: spec.x, y: spec.y, z: spec.z ?? 1000, height: spec.h, width: spec.w, tabOrder: spec.z ?? 1000 },
    visual: v
  }
  if (spec.filters) out.filterConfig = { filters: spec.filters }
  if (spec.hidden) out.isHidden = true
  const annotations = []
  if (spec.style) annotations.push({ name: 'Lumen_Style', value: JSON.stringify(spec.style) })
  // Lumen-only entrance / delay (src/core/report/motion.ts), e.g. { entrance: 'rise', delay: 120 }
  if (spec.motion) annotations.push({ name: 'Lumen_Motion', value: JSON.stringify(spec.motion) })
  if (sample) annotations.push({ name: 'Lumen_SampleData', value: JSON.stringify(sample) })
  if (annotations.length) out.annotations = annotations
  return out
}

/**
 * A group (PBIR visualGroup) around visuals placed in page coordinates: the children move inside it (positions relative
 * to the group, stacked in the order given). spec: { name, displayName?, z?, motion? } (motion: Lumen_Motion, e.g. a
 * hover effect that moves the whole group).
 */
export function group(seed, spec, children) {
  const kids = children.filter(Boolean)
  const x = Math.min(...kids.map((k) => k.position.x))
  const y = Math.min(...kids.map((k) => k.position.y))
  const w = Math.max(...kids.map((k) => k.position.x + k.position.width)) - x
  const h = Math.max(...kids.map((k) => k.position.y + k.position.height)) - y
  const z = spec.z ?? Math.max(...kids.map((k) => k.position.z))
  const name = hex(`${seed}/group/${spec.name}`)
  kids.forEach((k, i) => {
    k.parentGroupName = name
    k.position = { ...k.position, x: k.position.x - x, y: k.position.y - y, z: i * 1000, tabOrder: i * 1000 }
  })
  const out = { $schema: VC_SCHEMA, name, position: { x, y, z, height: h, width: w, tabOrder: z }, visualGroup: { displayName: spec.displayName ?? spec.name, groupMode: 'ScaleMode' } }
  if (spec.motion) out.annotations = [{ name: 'Lumen_Motion', value: JSON.stringify(spec.motion) }]
  return [out, ...kids]
}

/** The objects entries that name fields (data / metadata selectors, field expressions): kept with the sample query. */
function splitFieldObjects(o) {
  const plain = {}
  const fieldBound = {}
  for (const [key, entries] of Object.entries(o)) {
    for (const e of entries) {
      const bound = !!e.selector?.data || !!e.selector?.metadata || JSON.stringify(e.properties ?? {}).includes('"SourceRef"')
      ;(bound ? (fieldBound[key] ??= []) : (plain[key] ??= [])).push(e)
    }
  }
  return { plain: Object.keys(plain).length ? plain : undefined, fieldBound: Object.keys(fieldBound).length ? fieldBound : undefined }
}

/**
 * Text box. runs: [{ text, font, size, color, bold, italic, underline }], or paragraphs [[runs], …] with
 * `align` per paragraph via { align, runs }.
 */
export function textbox(seed, spec) {
  const paras = (spec.paragraphs ?? [{ runs: spec.runs, align: spec.align }]).map((p) => {
    const runs = Array.isArray(p) ? p : p.runs
    const align = Array.isArray(p) ? spec.align : p.align ?? spec.align
    const out = {
      textRuns: runs.map((r) => {
        const ts = {}
        if (r.font) ts.fontFamily = r.font
        if (r.size) ts.fontSize = `${r.size}pt`
        if (r.bold) ts.fontWeight = 'bold'
        if (r.italic) ts.fontStyle = 'italic'
        if (r.underline) ts.textDecoration = 'underline'
        if (r.color) ts.color = r.color
        const run = { value: r.text }
        if (Object.keys(ts).length) run.textStyle = ts
        return run
      })
    }
    if (align) out.horizontalTextAlignment = align
    return out
  })
  return visual(seed, {
    ...spec,
    type: 'textbox',
    rawObjects: { general: [{ properties: { paragraphs: paras } }] },
    box: { padding: 0, ...(spec.box ?? {}) }
  })
}

/** Image visual showing a registered resource. */
export function image(seed, spec) {
  return visual(seed, {
    ...spec,
    type: 'image',
    rawObjects: {
      general: [{ properties: { imageUrl: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: spec.src } } } } }],
      imageScaling: [{ properties: { imageScalingType: literal(spec.scaling ?? 'Fit') } }]
    },
    box: { padding: 0, ...(spec.box ?? {}) }
  })
}

/** Shape visual (rectangle, rounded rectangle, ellipse, line…). */
export function shape(seed, spec) {
  const o = {
    shape: { tileShape: spec.shape ?? 'rectangle', ...(spec.radius !== undefined ? { roundEdge: spec.radius } : {}) },
    fill: spec.fill ? { show: true, fillColor: c(spec.fill), transparency: spec.fillTransparency ?? 0, $selector: { id: 'default' } } : { show: false, $selector: { id: 'default' } },
    outline: spec.line ? { show: true, lineColor: c(spec.line), weight: spec.lineWeight ?? 1, $selector: { id: 'default' } } : { show: false, $selector: { id: 'default' } }
  }
  if (spec.rotation) o.rotation = { shapeAngle: spec.rotation }
  return visual(seed, { ...spec, type: 'shape', objects: { ...o, ...(spec.objects ?? {}) }, box: { padding: 0, ...(spec.box ?? {}) } })
}

// ---------------------------------------------------------------------------------------------
// semantic model (TMDL)
// ---------------------------------------------------------------------------------------------

/**
 * A default measure table (`_measures_kpi`, `_measures_format`): a placeholder measure and the hidden Column1 of a
 * Power BI "Enter data" table, in the Measures query group.
 */
export function measureTable(seed, name, placeholder) {
  return [
    `table ${name}`,
    `\tlineageTag: ${uuid(`${seed}/table/${name}`)}`,
    '',
    `\tmeasure ${placeholder} = BLANK()`,
    '\t\tformatString: 0',
    `\t\tlineageTag: ${uuid(`${seed}/measure/${name}/${placeholder}`)}`,
    '',
    '\tcolumn Column1',
    '\t\tisHidden',
    '\t\tdataType: string',
    `\t\tlineageTag: ${uuid(`${seed}/column/${name}/Column1`)}`,
    '\t\tsummarizeBy: none',
    '\t\tsourceColumn: Column1',
    '',
    '\t\tannotation SummarizationSetBy = Automatic',
    '',
    `\tpartition ${name} = m`,
    '\t\tmode: import',
    '\t\tqueryGroup: Measures',
    '\t\tsource =',
    '\t\t\t\tlet',
    '\t\t\t\t    Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("i44FAA==", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [Column1 = _t]),',
    '\t\t\t\t    #"Changed Type" = Table.TransformColumnTypes(Source,{{"Column1", type text}})',
    '\t\t\t\tin',
    '\t\t\t\t    #"Changed Type"',
    '',
    '\tannotation PBI_NavigationStepName = Navigation',
    '',
    '\tannotation PBI_ResultType = Table',
    ''
  ].join('\n')
}

/**
 * The design's tables and measures as the report's sample dataset (`sampleData.lumen.json`, see
 * src/core/sample/dataset.ts): the rows the empty visuals draw, never part of the model.
 */
export function sampleDataset(design) {
  const cell = (v, type) => (v === null || v === undefined ? null : type === 'double' ? Math.round(v * 100) / 100 : type === 'int64' ? Math.round(v) : v)
  return {
    $lumen: 'sampleData',
    version: 1,
    tables: design.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => {
        const out = { name: c.name, type: c.type }
        if (c.sortBy) out.sortBy = c.sortBy
        if (c.format) out.format = c.format
        if (c.hidden) out.hidden = true
        if (c.category) out.category = c.category
        return out
      }),
      rows: t.rows.map((r) => r.map((v, i) => cell(v, t.columns[i].type)))
    })),
    measures: [
      ...(design.measures?.list ?? []).map((ms) => ({ table: design.measures.table, name: ms.name, expression: ms.dax, ...(ms.format ? { format: ms.format } : {}) })),
      ...design.tables.flatMap((t) => (t.measures ?? []).map((ms) => ({ table: t.name, name: ms.name, expression: ms.dax, ...(ms.format ? { format: ms.format } : {}) })))
    ],
    ...(design.relationships?.length ? { relationships: design.relationships.map((r) => ({ from: r.from, to: r.to })) } : {})
  }
}

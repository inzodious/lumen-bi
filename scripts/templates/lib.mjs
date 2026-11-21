/**
 * Building blocks for the gallery report templates (scripts/templates/build.mjs).
 *
 * Each design (scripts/templates/designs/*.mjs) describes a PBIP project in plain JS: an M-computed
 * sample-data model (literal `#table` rows, so the report refreshes offline and in Power BI Desktop),
 * a custom theme, SVG artwork as registered resources and pages of visuals. The helpers here turn
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
 * spec: { type, x, y, w, h, z?, roles?: { Category: [field], Y: [...] }, sort?: { field, dir }, objects?, box?, style?, name? }
 *  - box: container formatting (title, background, border, shadow, padding…)
 *  - style: Lumen-only container effects, saved as the `Lumen_Style` annotation (see report/lumenStyle.ts)
 */
export function visual(seed, spec) {
  const name = hex(`${seed}/${spec.name ?? JSON.stringify([spec.type, spec.x, spec.y, spec.w, spec.h])}`)
  const v = { visualType: spec.type }
  if (spec.roles) {
    const queryState = {}
    for (const [role, fields] of Object.entries(spec.roles)) queryState[role] = { projections: fields.map(projection) }
    v.query = { queryState }
    if (spec.sort) v.query.sortDefinition = { sort: [{ field: fieldExpr(spec.sort.field), direction: spec.sort.dir ?? 'Descending' }], isDefaultSort: true }
  }
  if (spec.objects) v.objects = objects(spec.objects)
  if (spec.rawObjects) v.objects = { ...(v.objects ?? {}), ...spec.rawObjects }
  v.visualContainerObjects = containerObjects(spec.box)
  v.drillFilterOtherVisuals = true
  const out = {
    $schema: VC_SCHEMA,
    name,
    position: { x: spec.x, y: spec.y, z: spec.z ?? 1000, height: spec.h, width: spec.w, tabOrder: spec.z ?? 1000 },
    visual: v
  }
  if (spec.style) out.annotations = [{ name: 'Lumen_Style', value: JSON.stringify(spec.style) }]
  return out
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

const M_TYPES = { string: 'text', int64: 'Int64.Type', double: 'number', dateTime: 'date', boolean: 'logical' }

function mValue(v, type) {
  if (v === null || v === undefined) return 'null'
  if (type === 'string') return `"${String(v).replace(/"/g, '""')}"`
  if (type === 'dateTime') {
    const [y, mo, d] = String(v).split('-').map(Number)
    return `#date(${y}, ${mo}, ${d})`
  }
  if (type === 'boolean') return v ? 'true' : 'false'
  if (type === 'double') return String(Math.round(v * 100) / 100)
  return String(Math.round(v))
}

function tmdlName(n) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`
}

/**
 * A table whose rows are literal M (`#table`).
 * spec: { name, columns: [{ name, type, format?, sortBy?, hidden?, summarize?, category? }], rows: [[…]], measures?: [{ name, dax, format, folder? }], hidden? }
 */
export function tableTmdl(seed, spec) {
  const L = []
  L.push(`table ${tmdlName(spec.name)}`)
  if (spec.hidden) L.push('\tisHidden')
  L.push(`\tlineageTag: ${uuid(`${seed}/table/${spec.name}`)}`)
  L.push('')
  for (const ms of spec.measures ?? []) {
    L.push(`\tmeasure ${tmdlName(ms.name)} = ${ms.dax}`)
    if (ms.format) L.push(`\t\tformatString: ${ms.format}`)
    if (ms.folder) L.push(`\t\tdisplayFolder: ${ms.folder}`)
    L.push(`\t\tlineageTag: ${uuid(`${seed}/measure/${spec.name}/${ms.name}`)}`)
    L.push('')
  }
  for (const cdef of spec.columns) {
    L.push(`\tcolumn ${tmdlName(cdef.name)}`)
    L.push(`\t\tdataType: ${cdef.type}`)
    if (cdef.hidden) L.push('\t\tisHidden')
    const fmt = cdef.format ?? (cdef.type === 'dateTime' ? 'Short Date' : cdef.type === 'int64' ? '0' : cdef.type === 'double' ? '#,0.00' : undefined)
    if (fmt) L.push(`\t\tformatString: ${fmt}`)
    L.push(`\t\tlineageTag: ${uuid(`${seed}/column/${spec.name}/${cdef.name}`)}`)
    if (cdef.category) L.push(`\t\tdataCategory: ${cdef.category}`)
    L.push(`\t\tsummarizeBy: ${cdef.summarize ?? (cdef.type === 'int64' || cdef.type === 'double' ? 'sum' : 'none')}`)
    L.push(`\t\tsourceColumn: ${cdef.name}`)
    if (cdef.sortBy) L.push(`\t\tsortByColumn: ${tmdlName(cdef.sortBy)}`)
    L.push('')
    if (cdef.sortBy) {
      L.push('\t\tchangedProperty = SortByColumn')
      L.push('')
    }
    L.push('\t\tannotation SummarizationSetBy = Automatic')
    if (cdef.type === 'dateTime') {
      L.push('')
      L.push('\t\tannotation UnderlyingDateTimeDataType = Date')
    }
    L.push('')
  }
  const typeRow = spec.columns.map((cdef) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(cdef.name) ? cdef.name : `#"${cdef.name}"`} = ${M_TYPES[cdef.type]}`).join(', ')
  L.push(`\tpartition ${tmdlName(spec.name)} = m`)
  L.push('\t\tmode: import')
  L.push('\t\tsource =')
  L.push('\t\t\t\tlet')
  L.push(`\t\t\t\t    // sample data for the template: replace this query with your own source`)
  L.push(`\t\t\t\t    Source = #table(type table [${typeRow}], {`)
  spec.rows.forEach((r, i) => {
    L.push(`\t\t\t\t        {${r.map((v, j) => mValue(v, spec.columns[j].type)).join(', ')}}${i < spec.rows.length - 1 ? ',' : ''}`)
  })
  L.push('\t\t\t\t    })')
  L.push('\t\t\t\tin')
  L.push('\t\t\t\t    Source')
  L.push('')
  L.push('\tannotation PBI_ResultType = Table')
  L.push('')
  return L.join('\n')
}

/** A measures-only table (one hidden placeholder column, like Power BI's "Enter data" measure tables). */
export function measureTable(seed, name, measures) {
  return tableTmdl(seed, { name, columns: [{ name: 'Column1', type: 'string', hidden: true }], rows: [[null]], measures })
}

export function relationshipsTmdl(seed, rels) {
  return rels
    .map((r) => [`relationship ${uuid(`${seed}/rel/${r.from}/${r.to}`)}`, `\tfromColumn: ${r.from}`, `\ttoColumn: ${r.to}`, ''].join('\n'))
    .join('\n')
}

/**
 * Sample data on empty visuals (mockups).
 *
 * A visual with no fields can draw sample data so a report looks populated while it is being designed.
 * Nothing about it is real: the model has no table for it, no field well shows it, and Power BI Desktop
 * sees an empty visual. Two Lumen-only annotations drive it:
 *
 *   report.json `annotations`  Lumen_SampleData = "on" | "off"   whether empty visuals draw sample data
 *   visual.json `annotations`  Lumen_SampleData = JSON            the visual's own sample (optional)
 *
 * The visual value is `{ "query": <PBIR query>, "objects": <PBIR objects>, "off": true }`, every key optional:
 *  - `query` is the query the visual draws its sample with, against the report's sample dataset
 *    (sample/dataset.ts); templates store their designed bindings here. Without it the visual gets a generic
 *    sample chosen from its type and title (sample/generic.ts).
 *  - `objects` are formatting entries that only make sense with that query (data-point colors whose selectors
 *    name sample values), merged into the visual's own objects while the sample draws.
 *  - `off` turns the sample off for this visual only ("Clear sample data").
 *
 * The sample draws only while the visual has no fields of its own: dropping a real field in replaces it, and
 * removing the fields again brings it back.
 */

export const SAMPLE_DATA_ANNOTATION = 'Lumen_SampleData'

export interface VisualSampleSpec {
  query?: any
  objects?: Record<string, any[]>
  off?: boolean
}

function annotationList(json: any): Array<{ name: string; value: string }> | undefined {
  return Array.isArray(json?.annotations) ? json.annotations : undefined
}

function annotationValue(json: any): string | undefined {
  const a = annotationList(json)?.find((x) => x && x.name === SAMPLE_DATA_ANNOTATION)
  return typeof a?.value === 'string' ? a.value : undefined
}

function setAnnotation(json: any, value: string | undefined): void {
  const list = annotationList(json) ?? []
  const i = list.findIndex((x) => x && x.name === SAMPLE_DATA_ANNOTATION)
  if (value === undefined) {
    if (i >= 0) list.splice(i, 1)
  } else if (i >= 0) list[i] = { ...list[i], value }
  else list.push({ name: SAMPLE_DATA_ANNOTATION, value })
  if (list.length) json.annotations = list
  else delete json.annotations
}

/** Does the report draw sample data on its empty visuals? (`Lumen_SampleData` on report.json; absent = off) */
export function reportSampleDataOn(reportJson: any): boolean {
  return annotationValue(reportJson) === 'on'
}

/** Turn sample data on empty visuals on or off for the whole report. */
export function setReportSampleData(reportJson: any, on: boolean): void {
  setAnnotation(reportJson, on ? 'on' : 'off')
}

/** The visual's own sample (`Lumen_SampleData` on visual.json), if any. */
export function visualSampleSpec(visualJson: any): VisualSampleSpec | undefined {
  const raw = annotationValue(visualJson)
  if (raw === undefined) return undefined
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined
    const out: VisualSampleSpec = {}
    if (o.query && typeof o.query === 'object' && o.query.queryState && typeof o.query.queryState === 'object') out.query = o.query
    if (o.objects && typeof o.objects === 'object' && !Array.isArray(o.objects)) out.objects = o.objects
    if (o.off === true) out.off = true
    return out
  } catch {
    return undefined
  }
}

export function setVisualSampleSpec(visualJson: any, spec: VisualSampleSpec | undefined): void {
  const clean: VisualSampleSpec = {}
  if (spec?.query) clean.query = spec.query
  if (spec?.objects && Object.keys(spec.objects).length) clean.objects = spec.objects
  if (spec?.off) clean.off = true
  setAnnotation(visualJson, Object.keys(clean).length ? JSON.stringify(clean) : undefined)
}

/** "Clear sample data" (off) / "Show sample data" (on) for one visual; the stored query is kept either way. */
export function setVisualSampleOff(visualJson: any, off: boolean): void {
  const spec = visualSampleSpec(visualJson) ?? {}
  setVisualSampleSpec(visualJson, { ...spec, off })
}

/** True when the visual has at least one field of its own in any role. */
export function visualHasFields(visualJson: any): boolean {
  const qs = visualJson?.visual?.query?.queryState
  if (!qs || typeof qs !== 'object') return false
  return Object.values<any>(qs).some((role) => Array.isArray(role?.projections) && role.projections.length > 0)
}

/**
 * The visual as it draws with a sample query: the query replaces the (empty) one and the sample's formatting
 * entries are added after the visual's own entries of the same object. The visual's own formatting wins where
 * both set the same property without a selector.
 */
export function withSampleQuery(visualJson: any, query: any, objects?: Record<string, any[]>): any {
  const visual = { ...(visualJson?.visual ?? {}), query }
  if (objects && Object.keys(objects).length) {
    const own = visual.objects ?? {}
    const merged: Record<string, any[]> = { ...own }
    for (const [name, entries] of Object.entries(objects)) {
      if (!Array.isArray(entries)) continue
      merged[name] = [...(Array.isArray(own[name]) ? own[name] : []), ...entries]
    }
    visual.objects = merged
  }
  return { ...visualJson, visual }
}

/** Entities (table names) a query or objects bag refers to. */
export function referencedEntities(value: unknown): Set<string> {
  const out = new Set<string>()
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const x of v) walk(x)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'SourceRef' && x && typeof x === 'object' && typeof (x as any).Entity === 'string') out.add((x as any).Entity)
      else walk(x)
    }
  }
  walk(value)
  return out
}

/**
 * Split a visual's objects into the entries that name fields (data selectors comparing a column to a value,
 * `metadata` selectors naming a query reference, field expressions) and the rest. Templates keep the first part in
 * the sample spec, so the visual.json Power BI opens names no field the model lacks.
 */
export function splitFieldObjects(objects: Record<string, any[]> | undefined): { plain?: Record<string, any[]>; fieldBound?: Record<string, any[]> } {
  if (!objects) return {}
  const plain: Record<string, any[]> = {}
  const fieldBound: Record<string, any[]> = {}
  for (const [name, entries] of Object.entries(objects)) {
    if (!Array.isArray(entries)) {
      plain[name] = entries
      continue
    }
    for (const e of entries) {
      const bound = !!e?.selector?.metadata || !!e?.selector?.data || referencedEntities(e?.properties).size > 0
      ;(bound ? (fieldBound[name] ??= []) : (plain[name] ??= [])).push(e)
    }
  }
  return { plain: Object.keys(plain).length ? plain : undefined, fieldBound: Object.keys(fieldBound).length ? fieldBound : undefined }
}

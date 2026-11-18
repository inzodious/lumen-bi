/**
 * Q&A schema: the model's visible tables / columns / measures with the phrases that refer to them.
 *
 * Terms come from (highest weight first):
 *  - "<table> <column>" for every column (e.g. "product name"), the column / measure name itself,
 *  - synonyms from the model's linguistic schema (TMDL `cultureInfo … linguisticMetadata` JSON:
 *    `Entities[*].Binding.{ConceptualEntity, ConceptualProperty}` + `Terms[{ term: { State } }]`;
 *    "Suggested"/"Deleted" terms are ignored like Power BI does until they are approved),
 *  - synonyms from a `Synonyms` annotation (comma separated; a Lumen convention),
 *  - measure names without aggregation prefixes ("Total Sales" → "sales", "# Orders" → "orders").
 */
import type { Scalar } from '@core/model/data'
import type { SemanticModel } from '@core/model/types'
import { phraseKey, splitName, tokenize } from './text'

export interface QnaTerm {
  key: string
  weight: number
}

export interface QnaField {
  kind: 'column' | 'measure'
  table: string
  name: string
  dataType: string
  dataCategory?: string
  summarizeBy?: string
  terms: QnaTerm[]
}

export interface QnaTable {
  name: string
  terms: QnaTerm[]
  /** first visible text column (label column used when a question names the table as a category) */
  labelColumn?: string
  /** first visible column (used to count rows: "count of <table>") */
  firstColumn?: string
}

export interface QnaSchema {
  fields: QnaField[]
  tables: QnaTable[]
}

const NUMERIC = new Set(['int64', 'double', 'decimal', 'currency', 'number'])

export function isNumericType(t: string | undefined): boolean {
  return !!t && NUMERIC.has(t)
}

/** Columns that are numbers but behave like categories (years, months, keys...). */
export function isCategoricalNumber(f: QnaField): boolean {
  if (f.summarizeBy === 'none') return true
  return /(^|[^a-z])(year|yr|month|quarter|qtr|week|day|period|fiscal|id|key|code|no|number|zip|postal|sku)([^a-z]|$)/i.test(f.name.replace(/([a-z])([A-Z])/g, '$1 $2'))
}

export function isTimeField(f: QnaField): boolean {
  if (f.dataType === 'dateTime' || f.dataType === 'date') return true
  return /(^|[^a-z])(date|year|month|quarter|qtr|week|day|period|time)([^a-z]|$)/i.test(f.name.replace(/([a-z])([A-Z])/g, '$1 $2'))
}

/** Does this field aggregate when used as a value (measure or summarizable numeric column)? */
export function isValueField(f: QnaField): boolean {
  return f.kind === 'measure' || (isNumericType(f.dataType) && !isCategoricalNumber(f))
}

const AGG_PREFIX = /^(total|sum of|sum|count of|count|number of|no of|num|avg|average|average of|mean|# of|#|max|min|maximum|minimum|distinct count of|distinct count)\s+/

function linguisticSynonyms(model: SemanticModel): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const c of model.cultures ?? []) {
    const raw = c.raw
    if (!raw) continue
    const at = raw.indexOf('linguisticMetadata')
    const open = at >= 0 ? raw.indexOf('{', at) : -1
    if (open < 0) continue
    let depth = 0
    let end = -1
    let inStr = false
    for (let i = open; i < raw.length; i++) {
      const ch = raw[i]
      if (inStr) {
        if (ch === '\\') i++
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        end = i
        break
      }
    }
    if (end < 0) continue
    let json: any
    try {
      json = JSON.parse(raw.slice(open, end + 1))
    } catch {
      continue
    }
    for (const ent of Object.values<any>(json?.Entities ?? {})) {
      const b = ent?.Binding
      if (!b?.ConceptualEntity) continue
      const key = `${b.ConceptualEntity}\u0001${b.ConceptualProperty ?? ''}`
      const terms: string[] = []
      for (const t of ent.Terms ?? []) {
        for (const [term, meta] of Object.entries<any>(t ?? {})) {
          const state = String(meta?.State ?? '')
          if (state === 'Suggested' || state === 'Deleted') continue
          terms.push(term)
        }
      }
      if (terms.length) out.set(key, [...(out.get(key) ?? []), ...terms])
    }
  }
  return out
}

function annotationSynonyms(ann: Record<string, string> | undefined): string[] {
  const v = ann?.Synonyms ?? ann?.synonyms
  return v ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : []
}

export function buildSchema(model: SemanticModel | undefined): QnaSchema {
  const fields: QnaField[] = []
  const tables: QnaTable[] = []
  if (!model?.tables?.length) return { fields, tables }
  const ling = linguisticSynonyms(model)
  const syn = (table: string, prop: string, ann?: Record<string, string>) => [...(ling.get(`${table}\u0001${prop}`) ?? []), ...annotationSynonyms(ann)]
  for (const t of model.tables) {
    if (t.isHidden || t.isPrivate || t.calculationGroup) continue
    const tWords = splitName(t.name)
    const tTerms: QnaTerm[] = [{ key: phraseKey(tWords), weight: 1 }]
    for (const s of syn(t.name, '', t.annotations)) tTerms.push({ key: phraseKey(splitName(s)), weight: 1 })
    const table: QnaTable = { name: t.name, terms: tTerms }
    for (const c of t.columns) {
      if (c.isHidden || c.kind === 'rowNumber' || c.dataType === 'binary') continue
      table.firstColumn ??= c.name
      if (c.dataType === 'string') table.labelColumn ??= c.name
      const words = splitName(c.name)
      const terms: QnaTerm[] = [{ key: phraseKey(words), weight: 3 }]
      const qualified = phraseKey([...tWords, ...words])
      if (qualified !== terms[0].key) terms.push({ key: qualified, weight: 3.5 })
      for (const s of syn(t.name, c.name, c.annotations)) terms.push({ key: phraseKey(splitName(s)), weight: 2.5 })
      fields.push({ kind: 'column', table: t.name, name: c.name, dataType: c.dataType, dataCategory: c.dataCategory, summarizeBy: c.summarizeBy, terms })
    }
    for (const m of t.measures) {
      if (m.isHidden) continue
      const words = splitName(m.name)
      const terms: QnaTerm[] = [{ key: phraseKey(words), weight: 3.2 }]
      const joined = words.join(' ')
      const stripped = joined.replace(AGG_PREFIX, '')
      if (stripped !== joined && stripped) terms.push({ key: phraseKey(stripped.split(' ')), weight: 2 })
      // "Margin %" is also "margin percent"
      if (words.includes('%')) {
        terms.push({ key: phraseKey(words.map((w) => (w === '%' ? 'percent' : w))), weight: 3 })
        terms.push({ key: phraseKey(words.filter((w) => w !== '%')), weight: 2.2 })
      }
      for (const s of syn(t.name, m.name, m.annotations)) terms.push({ key: phraseKey(splitName(s)), weight: 2.5 })
      fields.push({ kind: 'measure', table: t.name, name: m.name, dataType: m.dataType ?? 'double', terms })
    }
    tables.push(table)
  }
  return { fields, tables }
}

export interface ValueEntry {
  field: QnaField
  value: Scalar
  text: string
}

/** phrase key → column values with that text (text columns and year-like integer columns). */
export type ValueIndex = Map<string, ValueEntry[]>

/** Which columns contribute values to the index. */
export function indexableColumn(f: QnaField): boolean {
  if (f.kind !== 'column') return false
  if (f.dataType === 'string') return true
  return f.dataType === 'int64' && /year|yr/i.test(f.name)
}

/**
 * Build the value index. `distinct(field)` returns the column's distinct values (or undefined to skip);
 * values longer than 6 words are skipped (free text isn't a filter value people type).
 */
export function buildValueIndex(schema: QnaSchema, distinct: (f: QnaField) => Scalar[] | undefined): ValueIndex {
  const idx: ValueIndex = new Map()
  for (const f of schema.fields) {
    if (!indexableColumn(f)) continue
    const vals = distinct(f)
    if (!vals) continue
    for (const v of vals) {
      if (v === null || v === undefined || v === '') continue
      const text = String(v)
      const words = tokenize(text).map((t) => t.norm)
      if (!words.length || words.length > 6) continue
      const key = phraseKey(words)
      const arr = idx.get(key) ?? []
      arr.push({ field: f, value: v, text })
      idx.set(key, arr)
    }
  }
  return idx
}

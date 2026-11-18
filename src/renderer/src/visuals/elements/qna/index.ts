/** Q&A engine facade: schema + value index + lexicon for a model, question → visual spec, suggestions. */
import type { QueryEngine } from '@core/engine/api'
import type { Scalar } from '@core/model/data'
import { columnExpr } from '@core/report/sq'
import { buildVisual, type QnaVisualSpec } from './build'
import { buildLexicon, interpret, type QnaInterpretation, type QnaLexicon } from './parse'
import { buildSchema, buildValueIndex, isCategoricalNumber, isTimeField, isValueField, type QnaField, type QnaSchema } from './schema'
import { splitName, tokenize } from './text'

export interface QnaEngine {
  schema: QnaSchema
  lexicon: QnaLexicon
  ask(question: string): { interp: QnaInterpretation; spec?: QnaVisualSpec }
  suggestions(max?: number): string[]
  /** completions for the word being typed (field names and values) */
  complete(question: string, max?: number): string[]
}

/** Columns with more distinct values than this aren't indexed for value matching. */
const VALUE_LIMIT = 2000
const MAX_INDEXED_COLUMNS = 300

export function createQnaEngine(engine: QueryEngine | undefined, distinctOverride?: (f: QnaField) => Scalar[] | undefined): QnaEngine {
  const schema = buildSchema(engine?.model)
  let indexed = 0
  const distinct =
    distinctOverride ??
    ((f: QnaField): Scalar[] | undefined => {
      if (!engine || indexed++ >= MAX_INDEXED_COLUMNS) return undefined
      try {
        const r = engine.distinctValues({ column: { kind: 'sq', expr: columnExpr(f.table, f.name) }, limit: VALUE_LIMIT + 1 })
        return r.values.length > VALUE_LIMIT ? undefined : r.values
      } catch {
        return undefined
      }
    })
  const values = buildValueIndex(schema, distinct)
  const lexicon = buildLexicon(schema, values)
  return {
    schema,
    lexicon,
    ask(question) {
      const interp = interpret(question, lexicon)
      return { interp, spec: buildVisual(interp) }
    },
    suggestions: (max = 6) => suggestQuestions(schema, max),
    complete(question, max = 6) {
      const toks = tokenize(question)
      const last = toks[toks.length - 1]
      if (!last || last.end !== question.length || last.norm.length < 2) return []
      const prefix = last.norm
      const out = new Set<string>()
      const consider = (label: string) => {
        const words = splitName(label)
        if (words.some((w) => w.startsWith(prefix)) && label.toLowerCase() !== prefix) out.add(label)
      }
      for (const f of schema.fields) consider(f.name)
      for (const [, entries] of values) for (const e of entries) if (out.size < max * 3) consider(e.text)
      return [...out].sort((a, b) => a.length - b.length).slice(0, max)
    }
  }
}

/** Starter questions built from the model (like Power BI's "Try one of these to get started"). */
export function suggestQuestions(schema: QnaSchema, max = 6): string[] {
  const measures = schema.fields.filter((f) => f.kind === 'measure')
  const numeric = schema.fields.filter((f) => f.kind === 'column' && isValueField(f))
  const values = measures.length ? measures : numeric
  const cats = schema.fields
    .filter((f) => f.kind === 'column' && !isValueField(f) && (f.dataType === 'string' || isCategoricalNumber(f)) && !/^(id|key|code|url|link|guid|sku|no|number)$/.test(splitName(f.name).pop() ?? ''))
    .sort((a, b) => (a.dataType === 'string' ? 0 : 1) - (b.dataType === 'string' ? 0 : 1))
  const time = cats.find((c) => isTimeField(c) && /year|month|quarter/i.test(c.name)) ?? schema.fields.find((f) => f.kind === 'column' && f.dataType === 'dateTime')
  const plain = cats.filter((c) => !isTimeField(c))
  const name = (f: QnaField) => (f.kind === 'measure' ? f.name : `total ${f.name}`).toLowerCase()
  const out: string[] = []
  const v0 = values[0]
  const v1 = values[1] ?? v0
  if (v0 && plain[0]) out.push(`${name(v0)} by ${plain[0].name.toLowerCase()}`)
  if (v1 && plain[1]) out.push(`top 5 ${plain[1].name.toLowerCase()} by ${name(v1)}`)
  if (v0 && time) out.push(`${name(v0)} by ${time.name.toLowerCase()} as line chart`)
  if (v0) out.push(name(v0))
  if (values[2] && plain[2]) out.push(`${name(values[2])} by ${plain[2].name.toLowerCase()} as column chart`)
  if (v0 && plain[0] && plain[1]) out.push(`${name(v0)} by ${plain[0].name.toLowerCase()} and ${plain[1].name.toLowerCase()}`)
  return [...new Set(out)].slice(0, max)
}

export type { QnaInterpretation, QnaVisualSpec }

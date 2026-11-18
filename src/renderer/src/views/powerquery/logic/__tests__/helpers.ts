/** Test helpers: a small base query, step insertion and evaluation through the M engine. */
import { expect } from 'vitest'
import { createSession, evaluateQuery, parseExpression, type Preview } from '@core/m/index.ts'
import { addStep } from '../steps'
import { referencedNames } from '../steps'
import type { StepSpec } from '../transforms'

export const BASE = `let
    Source = #table(type table [Region = text, Product = text, Amount = number, Qty = Int64.Type, #"Order Date" = date], {
        {"East", "a", 10.5, 2, #date(2024, 1, 5)},
        {"West", "b", 20, 3, #date(2024, 2, 10)},
        {"East", "c", null, 1, #date(2024, 3, 15)},
        {"North", " d ", 7.25, 4, #date(2023, 12, 31)}
    }),
    #"Changed Type" = Source
in
    #"Changed Type"`

let globals: Set<string> | null = null
export function stdlib(): Set<string> {
  if (!globals) globals = new Set(createSession().interp.globals.vars.keys())
  return globals
}

/** Library names a formula uses that the engine doesn't implement yet. */
export function missingFunctions(formula: string): string[] {
  const names = referencedNames(formula)
  return [...names].filter((n) => /^[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*$/.test(n) && !stdlib().has(n))
}

/** Engine gaps hit by the generated M, collected for the workstream report. */
export const engineGaps = new Set<string>()

/** Applies a step to BASE, checks the formula text, parses it and (when supported) evaluates it. */
export function check(spec: StepSpec, expectedFormula: string, opts: { source?: string; evaluate?: boolean; queries?: Record<string, string> } = {}): Preview | null {
  const src = opts.source ?? BASE
  const r = addStep(src, null, spec.name, spec.formula)
  expect(r).not.toBeNull()
  const formula = spec.formula('#"Changed Type"')
  expect(formula).toBe(expectedFormula)
  expect(() => parseExpression(r!.source)).not.toThrow()
  const missing = missingFunctions(formula)
  if (missing.length) {
    for (const m of missing) engineGaps.add(m)
    return null
  }
  if (opts.evaluate === false) return null
  const ev = evaluateQuery(r!.source, { previewSteps: false, queries: opts.queries })
  if (!ev.result.ok) throw new Error(`${spec.name}: ${ev.result.error.reason}: ${ev.result.error.message}\n${r!.source}`)
  return ev.result.preview
}

export function tableOf(p: Preview | null): { columns: string[]; rows: unknown[][] } | null {
  if (!p || p.kind !== 'table') return null
  return { columns: p.columns.map((c) => c.name), rows: p.rows }
}

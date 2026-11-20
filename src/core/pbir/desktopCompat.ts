/**
 * Power BI Desktop compatibility pass, applied to every visual.json when a report is serialized.
 *
 * Lumen reads PBIR leniently, so a report written by hand or by another tool can contain shapes that
 * render here but that Power BI Desktop rejects. Each rule below was reproduced in Power BI Desktop
 * (2.159, PBIR visualContainer 2.14.0) and rewrites the value to the shape Desktop itself writes:
 *
 *  - Gradient fill rules: `linearGradient2|3` stops are `{ color: {Literal}, value?: {Literal} }` and
 *    `nullColoringStrategy` is `{ strategy: {Literal}, color? }`, without an `expr` wrapper. A wrapped
 *    stop (`{ color: { expr: {Literal} } }`) renders in Desktop, but its serializer then fails silently:
 *    Save, Save as .pbix and Save as .pbit write nothing and show no error.
 *  - New card (`cardVisual`) accent bar: `accentBar.position` is case-sensitive (`'Left'`, `'Right'`,
 *    `'Top'`, `'Bottom'`). A lowercase value makes Desktop drop the whole card, which renders blank.
 *
 * The pass is pure and idempotent: a value already in Desktop's shape is returned unchanged (same object).
 */

const GRADIENTS = ['linearGradient2', 'linearGradient3']
const STOPS = ['min', 'mid', 'max']
const SIDES: Record<string, string> = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' }

/** `{ expr: X }` with nothing else → X. */
function unwrapExpr(v: any): any {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && v.expr && typeof v.expr === 'object' ? v.expr : v
}

function unwrapKeys(o: any, keys: string[]): any {
  if (!o || typeof o !== 'object') return o
  let out = o
  for (const k of keys) {
    const u = unwrapExpr(o[k])
    if (u !== o[k]) {
      if (out === o) out = { ...o }
      out[k] = u
    }
  }
  return out
}

/** The `FillRule.FillRule` body of a gradient with Desktop's stop shapes. */
function fixGradientBody(body: any): any {
  if (!body || typeof body !== 'object') return body
  let out = body
  for (const g of GRADIENTS) {
    const grad = body[g]
    if (!grad || typeof grad !== 'object') continue
    let next = grad
    for (const s of STOPS) {
      const fixed = unwrapKeys(grad[s], ['color', 'value'])
      if (fixed !== grad[s]) {
        if (next === grad) next = { ...grad }
        next[s] = fixed
      }
    }
    const ncs = unwrapKeys(grad.nullColoringStrategy, ['strategy', 'color'])
    if (ncs !== grad.nullColoringStrategy) {
      if (next === grad) next = { ...grad }
      next.nullColoringStrategy = ncs
    }
    if (next !== grad) {
      if (out === body) out = { ...body }
      out[g] = next
    }
  }
  return out
}

/** Rewrite every gradient FillRule in a JSON tree (copy-on-write). */
function fixFillRules(node: any): any {
  if (Array.isArray(node)) {
    let out: any[] | undefined
    node.forEach((x, i) => {
      const y = fixFillRules(x)
      if (y !== x) (out ??= node.slice())[i] = y
    })
    return out ?? node
  }
  if (!node || typeof node !== 'object') return node
  let out = node
  for (const [k, v] of Object.entries(node)) {
    let y = fixFillRules(v)
    if (k === 'FillRule' && y && typeof y === 'object' && 'Input' in y) {
      const body = fixGradientBody(y.FillRule)
      if (body !== y.FillRule) y = { ...y, FillRule: body }
    }
    if (y !== v) {
      if (out === node) out = { ...node }
      out[k] = y
    }
  }
  return out
}

function fixCardAccentBar(visual: any): any {
  const entries = visual?.objects?.accentBar
  if (visual?.visualType !== 'cardVisual' || !Array.isArray(entries)) return visual
  let changed = false
  const next = entries.map((e: any) => {
    const lit = e?.properties?.position?.expr?.Literal
    const m = typeof lit?.Value === 'string' ? /^'(\w+)'$/.exec(lit.Value) : null
    const side = m ? SIDES[m[1].toLowerCase()] : undefined
    if (!side || m![1] === side) return e
    changed = true
    return { ...e, properties: { ...e.properties, position: { ...e.properties.position, expr: { Literal: { ...lit, Value: `'${side}'` } } } } }
  })
  return changed ? { ...visual, objects: { ...visual.objects, accentBar: next } } : visual
}

/** A visual.json in the shapes Power BI Desktop accepts (see the module comment). */
export function desktopCompatVisual(json: any): any {
  if (!json || typeof json !== 'object') return json
  let out = fixFillRules(json)
  if (out.visual) {
    const v = fixCardAccentBar(out.visual)
    if (v !== out.visual) out = { ...out, visual: v }
  }
  return out
}

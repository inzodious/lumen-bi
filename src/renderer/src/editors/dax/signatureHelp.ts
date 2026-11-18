/**
 * Parameter hints: while the cursor is inside a function call, show the PBI-style signature
 * tooltip with the current parameter in bold and its description.
 */
import { StateField, type EditorState } from '@codemirror/state'
import { showTooltip, type Tooltip } from '@codemirror/view'
import { findDaxFunction, type DaxFunctionInfo } from './functions'
import { callAt } from './tokenizer'

/** Index into f.params for argument `argIndex`, accounting for repeating parameter groups. */
export function paramIndexFor(f: DaxFunctionInfo, argIndex: number): number {
  const rep = f.params.findIndex((p) => p.repeating)
  if (rep < 0) return argIndex < f.params.length ? argIndex : -1
  if (argIndex <= rep) return argIndex
  // Repeating groups: a single param (Filter1, Value2…) or a pair (Value/Result, Name/Expression,
  // Search_ColumnName/Search_Value, OrderBy_Expression/Order). Heuristic: names ending in a digit repeat alone.
  const pair = rep >= 2 && !/\d$/.test(f.params[rep].name) && !f.params[rep - 1].repeating
  const groupStart = pair ? rep - 1 : rep
  const groupLen = rep - groupStart + 1
  return groupStart + ((argIndex - groupStart) % groupLen)
}

function render(f: DaxFunctionInfo, argIndex: number): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'wbi-dax-sighelp'
  const sig = document.createElement('div')
  sig.className = 'wbi-dax-sighelp__sig'
  const active = paramIndexFor(f, argIndex)
  sig.append(document.createTextNode(`${f.name}(`))
  f.params.forEach((p, i) => {
    if (i > 0) sig.append(document.createTextNode(', '))
    const span = document.createElement('span')
    span.textContent = p.optional ? `[${p.name}]` : p.name
    if (i === active) span.className = 'is-active'
    sig.append(span)
    if (p.repeating) sig.append(document.createTextNode(', ...'))
  })
  sig.append(document.createTextNode(')'))
  dom.append(sig)
  const desc = document.createElement('div')
  desc.className = 'wbi-dax-sighelp__desc'
  const param = f.params[active]
  desc.textContent = param?.description ? `${param.name}: ${param.description}` : f.description
  dom.append(desc)
  return dom
}

function tooltipFor(state: EditorState): Tooltip | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const call = callAt(state.doc.toString(), sel.head)
  if (!call) return null
  const f = findDaxFunction(call.name)
  if (!f || f.params.length === 0) return null
  return { pos: call.openPos, above: true, strictSide: false, arrow: false, create: () => ({ dom: render(f, call.argIndex) }) }
}

export const daxSignatureHelp = StateField.define<Tooltip | null>({
  create: tooltipFor,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value
    return tooltipFor(tr.state)
  },
  provide: (f) => showTooltip.from(f)
})

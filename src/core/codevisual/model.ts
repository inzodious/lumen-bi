/**
 * Code visual: where its code, parameters and drill state live in the visual's PBIR JSON (pure, no DOM).
 *
 * In memory (and in `.wbi` bundles' JSON before externalisation) everything is in `visual.objects`:
 *   lumenCode[0].properties:   version (1L), html, css, jsx (text literals), params (JSON text: ParamDef[]),
 *                              drill (JSON text: the saved drill state, see drill.ts)
 *   lumenParams[0].properties: one property per parameter (its value; colours as `solid.color` like any colour)
 *   lumenCodeFormat[0].properties: overflow ('hidden' | 'visible' | 'auto'), rowLimit, rowTooltips
 * On disk (PBIP / PBIR folders) html, css and jsx are written as files beside visual.json (storage.ts).
 */
import { decodeLiteral, encodeLiteral } from '../report/literal'
import type { ParamDef } from './types'

/** PBIR visualType: Lumen-specific, in the shape of a custom visual id (name + 32 hex digits). */
export const CODE_VISUAL_TYPE = 'lumenCodeVisualC0DE5A1E7B3F4E2A9D6C8B1F0E4A7D3C'
export const CODE_VISUAL_VERSION = 1
export const CODE_OBJECT = 'lumenCode'
export const PARAMS_OBJECT = 'lumenParams'
export const FORMAT_OBJECT = 'lumenCodeFormat'

export interface CodeSource {
  html: string
  css: string
  jsx: string
}

export function isCodeVisual(visualJson: any): boolean {
  return visualJson?.visual?.visualType === CODE_VISUAL_TYPE
}

function codeProps(visualJson: any): Record<string, any> | undefined {
  return visualJson?.visual?.objects?.[CODE_OBJECT]?.[0]?.properties
}

function textProp(props: Record<string, any> | undefined, name: string): string {
  const raw = props?.[name]?.expr?.Literal?.Value
  if (raw === undefined) return ''
  const v = decodeLiteral(raw)
  return typeof v === 'string' ? v : ''
}

export function readCodeSource(visualJson: any): CodeSource {
  const p = codeProps(visualJson)
  return { html: textProp(p, 'html'), css: textProp(p, 'css'), jsx: textProp(p, 'jsx') }
}

export function codeVersion(visualJson: any): number {
  const raw = codeProps(visualJson)?.version?.expr?.Literal?.Value
  const v = raw === undefined ? CODE_VISUAL_VERSION : decodeLiteral(raw)
  return typeof v === 'number' ? v : CODE_VISUAL_VERSION
}

const lit = (v: string | number | boolean) => ({ expr: { Literal: { Value: encodeLiteral(v) } } })

function ensureCodeEntry(visualJson: any): Record<string, any> {
  const visual = (visualJson.visual ??= {})
  const objects = (visual.objects ??= {})
  const list = (objects[CODE_OBJECT] ??= [])
  if (!list.length) list.push({ properties: {} })
  const props = (list[0].properties ??= {})
  if (!props.version) props.version = lit(CODE_VISUAL_VERSION)
  return props
}

/** Write code (works on an immer draft). Empty layers are removed. */
export function writeCodeSource(visualJson: any, src: Partial<CodeSource>): void {
  const props = ensureCodeEntry(visualJson)
  for (const k of ['html', 'css', 'jsx'] as const) {
    if (src[k] === undefined) continue
    if (src[k]) props[k] = lit(src[k]!)
    else delete props[k]
  }
}

const PARAM_TYPES = new Set(['color', 'number', 'text', 'toggle'])
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

/** Parameter definitions (invalid entries dropped). */
export function readParamDefs(visualJson: any): ParamDef[] {
  const text = textProp(codeProps(visualJson), 'params')
  if (!text) return []
  try {
    const arr = JSON.parse(text)
    if (!Array.isArray(arr)) return []
    const out: ParamDef[] = []
    for (const p of arr.slice(0, 24)) {
      if (!p || typeof p !== 'object' || !PARAM_NAME.test(p.name) || !PARAM_TYPES.has(p.type)) continue
      if (out.some((x) => x.name === p.name)) continue
      out.push({ name: p.name, label: typeof p.label === 'string' && p.label ? p.label.slice(0, 60) : p.name, type: p.type, default: normaliseParam(p.type, p.default) })
    }
    return out
  } catch {
    return []
  }
}

export function normaliseParam(type: ParamDef['type'], v: unknown): string | number | boolean {
  switch (type) {
    case 'toggle':
      return v === true || v === 'true' || v === 1
    case 'number': {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    case 'color':
      // '' = automatic (the code falls back to a theme colour)
      return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : ''
    default:
      return typeof v === 'string' ? v.slice(0, 500) : ''
  }
}

export function writeParamDefs(visualJson: any, defs: ParamDef[]): void {
  const props = ensureCodeEntry(visualJson)
  if (defs.length) props.params = lit(JSON.stringify(defs))
  else delete props.params
}

/** Persisted drill state (JSON text), see drillState.ts. */
export function readDrillText(visualJson: any): string {
  return textProp(codeProps(visualJson), 'drill')
}

export function writeDrillText(visualJson: any, text: string | undefined): void {
  const props = ensureCodeEntry(visualJson)
  if (text) props.drill = lit(text)
  else delete props.drill
}

/** A new code visual's JSON (position set by the caller). */
export function newCodeVisualJson(name: string, src: CodeSource, params: ParamDef[] = []): any {
  const json: any = {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json',
    name,
    position: { x: 0, y: 0, z: 0, width: 400, height: 240, tabOrder: 0 },
    visual: { visualType: CODE_VISUAL_TYPE, query: { queryState: {} }, objects: {}, drillFilterOtherVisuals: true }
  }
  writeCodeSource(json, src)
  if (params.length) writeParamDefs(json, params)
  return json
}

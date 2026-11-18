/**
 * Visual registry. Visual modules call registerVisual() at import time; ./index.ts imports them all.
 */
import type { VisualDefinition } from './contract'

const byType = new Map<string, VisualDefinition>()

export function registerVisual(def: VisualDefinition): void {
  byType.set(def.type, def)
  for (const a of def.aliases ?? []) byType.set(a, def)
}

/** Custom visuals carry a GUID suffix (e.g. htmlContent443BE3AD55E043BF878BED274D3A6865) — match by prefix too. */
export function getVisual(visualType: string): VisualDefinition | undefined {
  const hit = byType.get(visualType)
  if (hit) return hit
  for (const [type, def] of byType) {
    if (visualType.toLowerCase().startsWith(type.toLowerCase()) && /[0-9A-F]{32}$/i.test(visualType)) return def
  }
  return undefined
}

export function allVisuals(): VisualDefinition[] {
  return [...new Set(byType.values())]
}

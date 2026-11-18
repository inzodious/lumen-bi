/**
 * Standalone SVG strings from normalised set data: colour roles substituted, stroke weight scaled,
 * padding applied, element ids namespaced (several icons inline in one page must not share gradient ids).
 * Used for the picker / canvas glyphs (inline markup) and for baking icons into reports (bake.ts).
 */
import type { ResolvedTheme } from '../report/theme'
import { refVariant, resolveIconColors } from './ref'
import type { IconRef, IconSetData, PackedIcon } from './types'

export interface IconSvgOptions {
  /** width / height attributes: px, or a CSS length such as '100%' (omit for a viewBox-only SVG) */
  size?: number | string
  /** SVG preserveAspectRatio (default: the SVG default, xMidYMid meet) */
  preserveAspectRatio?: string
  /** prefix for element ids inside the icon (default: none, ids kept as drawn) */
  idPrefix?: string
  /** accessible title (role="img" + <title>) */
  title?: string
}

export function iconEntry(data: IconSetData, name: string): PackedIcon | undefined {
  return Object.prototype.hasOwnProperty.call(data.icons, name) ? data.icons[name] : undefined
}

/** Variants an icon is drawn in. */
export function iconVariants(data: IconSetData, name: string, all: string[]): string[] {
  const e = iconEntry(data, name)
  if (!e) return []
  return e.b['*'] !== undefined ? all : all.filter((v) => e.b[v] !== undefined)
}

export function iconBody(data: IconSetData, name: string, variant: string): string | undefined {
  const e = iconEntry(data, name)
  return e ? (e.b[variant] ?? e.b['*']) : undefined
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/**
 * Substitute colour role tokens and stroke widths in a normalised body.
 * `slotHex`: resolved colour per slot of the variant; roles map tokens to slots or literal colours.
 */
export function fillBody(body: string, roles: Array<number | string>, slotHex: string[], strokeScale = 1): string {
  return body
    .replace(/\{\{(\d)\}\}/g, (m, n) => {
      const role = roles[Number(n)]
      if (role === undefined) return '#000000'
      return typeof role === 'number' ? (slotHex[role] ?? '#000000') : role
    })
    .replace(/\{\{w:([\d.]+)\}\}/g, (_m, w) => fmt(Number(w) * strokeScale))
}

/** Prefix every id (and its url(#…) / href="#…" uses) so inline copies of icons cannot collide. */
export function namespaceIds(svg: string, prefix: string): string {
  if (!/\sid="/.test(svg)) return svg
  return svg
    .replace(/\sid="([^"]+)"/g, (_m, id) => ` id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id) => `url(#${prefix}${id})`)
    .replace(/href="#([^"]+)"/g, (_m, id) => `href="#${prefix}${id}"`)
}

/**
 * SVG markup of an icon with explicit hex colours per slot (`slotHex`), or undefined when the set has no such icon.
 */
export function buildIconSvgHex(data: IconSetData, ref: IconRef, slotHex: string[], opts: IconSvgOptions = {}): string | undefined {
  const variant = refVariant(ref)
  const body = iconBody(data, ref.name, variant.id)
  if (body === undefined) return undefined
  const grid = data.icons[ref.name]?.s ?? data.size
  const scale = variant.stroke && ref.strokeWidth ? ref.strokeWidth / variant.stroke.default : 1
  let inner = fillBody(body, variant.roles, slotHex, scale)
  if (opts.idPrefix) inner = namespaceIds(inner, opts.idPrefix)
  const pad = Math.max(0, Math.min(40, ref.padding ?? 0))
  const m = (grid * pad) / 100
  const box = `${fmt(-m)} ${fmt(-m)} ${fmt(grid + 2 * m)} ${fmt(grid + 2 * m)}`
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : ''
  const par = opts.preserveAspectRatio ? ` preserveAspectRatio="${escapeXml(opts.preserveAspectRatio)}"` : ''
  const a11y = opts.title ? ` role="img" aria-label="${escapeXml(opts.title)}"` : ''
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"${size}${par}${a11y}>${title}${inner}</svg>`
}

/** SVG markup of an icon with its colours resolved through the report theme. */
export function buildIconSvg(data: IconSetData, ref: IconRef, theme: ResolvedTheme, opts: IconSvgOptions = {}): string | undefined {
  return buildIconSvgHex(data, ref, resolveIconColors(ref, theme), opts)
}

/** UTF-8 bytes of a string (pure, no TextEncoder dependency issues in workers). */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** `data:image/svg+xml;base64,…` for an SVG string. */
export function svgDataUri(svg: string): string {
  const bytes = utf8(svg)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return `data:image/svg+xml;base64,${btoa(bin)}`
}

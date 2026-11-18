/**
 * Iconify JSON → IconSetData (types.ts). Runs at build time in the Vite plugin
 * (scripts/icons/icon-data-plugin.ts) and in tests; pure TS (the caller reads the JSON files).
 *
 * Sources (npm, Iconify's packaging of each library's own SVGs, same artwork and licence):
 *   fluent    @iconify-json/fluent (Regular / Filled) + @iconify-json/fluent-color (Color)
 *   phosphor  @iconify-json/ph      (thin / light / regular / bold / fill / duotone)
 *   tabler    @iconify-json/tabler  (outline / filled)
 *   iconpark  @iconify-json/icon-park (one multi-colour body per icon + categories)
 *
 * Imports are relative (no path aliases): the Vite config bundles this file.
 */
import type { IconSetData, IconSetId, PackedIcon } from './types'

export interface IconifyIcon {
  body: string
  width?: number
  height?: number
  left?: number
  top?: number
}

export interface IconifyJson {
  prefix: string
  icons: Record<string, IconifyIcon>
  aliases?: Record<string, { parent: string }>
  width?: number
  height?: number
}

export interface IconifySource {
  icons: IconifyJson
  metadata?: { categories?: Record<string, string[]> }
  info?: { version?: string }
}

/** Reads an Iconify package (`fluent`, `fluent-color`, `ph`, `tabler`, `icon-park`). */
export type IconifyReader = (prefix: string) => IconifySource

export const ICONIFY_PACKAGES: Record<IconSetId, string[]> = {
  fluent: ['fluent', 'fluent-color'],
  phosphor: ['ph'],
  tabler: ['tabler'],
  iconpark: ['icon-park']
}

const r2 = (n: number) => Math.round(n * 1e4) / 1e4

/** The icon's body placed on a `grid`-sized square (scaled / offset when Iconify says it is drawn on another box). */
function onGrid(src: IconifyJson, icon: IconifyIcon, grid: number): string {
  const w = icon.width ?? src.width ?? 16
  const h = icon.height ?? src.height ?? 16
  const left = icon.left ?? 0
  const top = icon.top ?? 0
  const k = grid / Math.max(w, h)
  const dx = (Math.max(w, h) - w) / 2 - left
  const dy = (Math.max(w, h) - h) / 2 - top
  if (Math.abs(k - 1) < 1e-9 && !dx && !dy) return icon.body
  const t = [Math.abs(k - 1) < 1e-9 ? '' : `scale(${r2(k)})`, dx || dy ? `translate(${r2(dx)} ${r2(dy)})` : ''].filter(Boolean).join(' ')
  return `<g transform="${t}">${icon.body}</g>`
}

function gridOf(src: IconifyJson, icon: IconifyIcon): number {
  return Math.max(icon.width ?? src.width ?? 16, icon.height ?? src.height ?? 16)
}

const currentColorToken = (body: string) => body.replace(/="currentColor"/g, '="{{0}}"')
const strokeToken = (body: string) => body.replace(/stroke-width="([\d.]+)"/g, (_m, w) => `stroke-width="{{w:${w}}}"`)

// ---------------------------------------------------------------------------------------------
// Fluent: <base>-<size>-<regular|filled|light>, colour icons <base>-<size>
// ---------------------------------------------------------------------------------------------

const FLUENT_SIZES = [24, 20, 28, 32, 16, 48, 12, 10]

function bestSize(sizes: Map<number, string>): number | undefined {
  return FLUENT_SIZES.find((s) => sizes.has(s)) ?? [...sizes.keys()][0]
}

function normalizeFluent(read: IconifyReader): IconSetData {
  const mono = read('fluent')
  const color = read('fluent-color')
  // base → variant → size → iconify name
  const groups = new Map<string, Map<string, Map<number, string>>>()
  const add = (base: string, variant: string, size: number, name: string) => {
    let g = groups.get(base)
    if (!g) groups.set(base, (g = new Map()))
    let v = g.get(variant)
    if (!v) g.set(variant, (v = new Map()))
    v.set(size, name)
  }
  for (const name of Object.keys(mono.icons.icons)) {
    const m = /^(.+)-(\d+)-(regular|filled)$/.exec(name)
    if (m) add(m[1], m[3], Number(m[2]), name)
  }
  for (const name of Object.keys(color.icons.icons)) {
    const m = /^(.+)-(\d+)$/.exec(name)
    if (m) add(m[1], 'color', Number(m[2]), name)
  }
  const icons: Record<string, PackedIcon> = {}
  const GRID = 24
  for (const [base, variants] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const b: Record<string, string> = {}
    // regular and filled from the same size when both exist there (they are drawn as a pair)
    const common = FLUENT_SIZES.find((s) => variants.get('regular')?.has(s) && variants.get('filled')?.has(s))
    for (const [variant, sizes] of variants) {
      const size = common !== undefined && sizes.has(common) ? common : bestSize(sizes)
      if (size === undefined) continue
      const src = variant === 'color' ? color.icons : mono.icons
      const icon = src.icons[sizes.get(size)!]
      if (!icon) continue
      const body = onGrid(src, icon, GRID)
      b[variant] = variant === 'color' ? body : currentColorToken(body)
    }
    if (Object.keys(b).length) icons[base] = { b }
  }
  return { set: 'fluent', size: GRID, version: mono.info?.version, icons }
}

// ---------------------------------------------------------------------------------------------
// Phosphor: <base> (regular) and <base>-<weight>
// ---------------------------------------------------------------------------------------------

const PH_WEIGHTS = ['thin', 'light', 'bold', 'fill', 'duotone']

/** Duotone: the back layer (`opacity=".2"`, filled with currentColor) gets its own colour role instead. */
export function phosphorDuotone(body: string): string {
  return body.replace(/<(\w+)([^>]*?)\sopacity="\.2"([^>]*?)(\/?)>/g, (_m, tag: string, a: string, b: string, close: string) => {
    const attrs = `${a}${b}`.replace(/\sfill="[^"]*"/g, '')
    return `<${tag}${attrs} fill="{{1}}"${close}>`
  })
}

function normalizePhosphor(read: IconifyReader): IconSetData {
  const src = read('ph')
  const names = Object.keys(src.icons.icons)
  const all = new Set(names)
  const icons: Record<string, PackedIcon> = {}
  const grid = src.icons.width ?? 256
  const put = (base: string, variant: string, name: string) => {
    const icon = src.icons.icons[name]
    let body = currentColorToken(onGrid(src.icons, icon, grid))
    if (variant === 'duotone') body = phosphorDuotone(body)
    ;(icons[base] ??= { b: {} }).b[variant] = body
  }
  for (const name of names) {
    const m = new RegExp(`^(.+)-(${PH_WEIGHTS.join('|')})$`).exec(name)
    // a weight suffix only when the base has the other weights too (a name like "x-light" may be a regular icon)
    const isWeight = !!m && PH_WEIGHTS.filter((w) => all.has(`${m[1]}-${w}`)).length >= 3
    if (m && isWeight) put(m[1], m[2], name)
    else put(name, 'regular', name)
  }
  return { set: 'phosphor', size: grid, version: src.info?.version, icons: sortKeys(icons) }
}

// ---------------------------------------------------------------------------------------------
// Tabler: <name> (outline), <name>-filled
// ---------------------------------------------------------------------------------------------

function normalizeTabler(read: IconifyReader): IconSetData {
  const src = read('tabler')
  const names = Object.keys(src.icons.icons)
  const all = new Set(names)
  const grid = src.icons.width ?? 24
  const icons: Record<string, PackedIcon> = {}
  for (const name of names) {
    const icon = src.icons.icons[name]
    const filled = name.endsWith('-filled') && all.has(name.slice(0, -'-filled'.length))
    const base = filled ? name.slice(0, -'-filled'.length) : name.endsWith('-filled') ? name.slice(0, -'-filled'.length) : name
    const variant = name.endsWith('-filled') ? 'filled' : 'outline'
    let body = currentColorToken(onGrid(src.icons, icon, grid))
    if (variant === 'outline') body = strokeToken(body)
    ;(icons[base] ??= { b: {} }).b[variant] = body
  }
  return { set: 'tabler', size: grid, version: src.info?.version, icons: sortKeys(icons) }
}

// ---------------------------------------------------------------------------------------------
// IconPark: one body per icon in its default multi-colour palette
// ---------------------------------------------------------------------------------------------

/** IconPark's default theme colours as Iconify ships them → role tokens (sets.ts). */
const ICONPARK_PALETTE: Record<string, string> = { '#000': '{{0}}', '#2f88ff': '{{1}}', '#fff': '{{2}}', '#43ccf8': '{{3}}' }

export function iconParkTokens(body: string): string {
  return strokeToken(body.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,8})"/g, (m, attr: string, c: string) => {
    const t = ICONPARK_PALETTE[c.toLowerCase()]
    return t ? `${attr}="${t}"` : m
  }))
}

function normalizeIconPark(read: IconifyReader): IconSetData {
  const src = read('icon-park')
  const grid = src.icons.width ?? 48
  const cats = new Map<string, string[]>()
  for (const [cat, list] of Object.entries(src.metadata?.categories ?? {})) for (const n of list) cats.set(n, [...(cats.get(n) ?? []), cat])
  const icons: Record<string, PackedIcon> = {}
  for (const [name, icon] of Object.entries(src.icons.icons)) {
    const entry: PackedIcon = { b: { '*': iconParkTokens(onGrid(src.icons, icon, grid)) } }
    const c = cats.get(name)
    if (c?.length) entry.c = c
    icons[name] = entry
  }
  return { set: 'iconpark', size: grid, version: src.info?.version, icons: sortKeys(icons) }
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0])))
}

export function normalizeIconSet(set: IconSetId, read: IconifyReader): IconSetData {
  switch (set) {
    case 'fluent':
      return normalizeFluent(read)
    case 'phosphor':
      return normalizePhosphor(read)
    case 'tabler':
      return normalizeTabler(read)
    case 'iconpark':
      return normalizeIconPark(read)
  }
}

/**
 * Report themes: built-in gallery, apply / import / save current theme.
 *
 * PBIR stores a custom theme as a RegisteredResources item: report.json
 *   themeCollection.customTheme = { name: '<file>.json', reportVersionAtImport: {...}, type: 'RegisteredResources' }
 *   resourcePackages[RegisteredResources].items += { name, path, type: 'CustomTheme' }
 * and the JSON file itself under StaticResources/RegisteredResources/. "Default" removes it so the
 * base theme (CY24SU10) applies.
 */
import type { ReportDocument } from '@core/report/types'
import { useApp } from '../../state/store'
import { registerResource } from '../commands'
import { toast } from '../ui/Notify'
import { BUILTIN_THEME_JSON, type ThemeJson } from './builtin'
import { cloneDeep } from '@core/clone'

export type { ThemeJson } from './builtin'

export interface BuiltinTheme {
  name: string
  /** null = Default (no custom theme) */
  json: any
  preview: string[]
  previewBackground?: string
  previewForeground?: string
}

export const BUILTIN_THEMES: BuiltinTheme[] = BUILTIN_THEME_JSON

const RESOURCE_DIR = 'StaticResources/RegisteredResources/'
/** reportVersionAtImport written with a newly applied theme (PBIR report 3.0 / visual 2.4 / page 2.3 era). */
const VERSION_AT_IMPORT = { visual: '2.4.0', report: '3.0.0', page: '2.3.0' }

/** Validate a theme JSON object. Returns an error message or undefined. */
export function validateThemeJson(json: unknown): string | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 'The theme file must contain a JSON object.'
  const t = json as Record<string, unknown>
  if (t.name !== undefined && typeof t.name !== 'string') return '"name" must be a string.'
  if (t.dataColors !== undefined) {
    if (!Array.isArray(t.dataColors)) return '"dataColors" must be an array of colors.'
    const bad = t.dataColors.find((c) => typeof c !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c))
    if (bad !== undefined) return `"dataColors" contains an invalid color: ${JSON.stringify(bad)}`
  }
  for (const k of ['background', 'foreground', 'tableAccent', 'good', 'neutral', 'bad', 'maximum', 'center', 'minimum']) {
    const v = t[k]
    if (v !== undefined && (typeof v !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(v))) return `"${k}" must be a hex color.`
  }
  if (t.visualStyles !== undefined && (typeof t.visualStyles !== 'object' || Array.isArray(t.visualStyles))) return '"visualStyles" must be an object.'
  if (t.textClasses !== undefined && (typeof t.textClasses !== 'object' || Array.isArray(t.textClasses))) return '"textClasses" must be an object.'
  if (t.name === undefined && t.dataColors === undefined && t.visualStyles === undefined && t.textClasses === undefined && t.background === undefined)
    return 'This does not look like a Power BI theme (no name, dataColors, textClasses or visualStyles).'
  return undefined
}

/** File name PBI-style: theme name without spaces + a numeric suffix, '.json'. */
export function themeFileName(name: string): string {
  const base = (name || 'Theme').replace(/[^A-Za-z0-9_-]/g, '') || 'Theme'
  const digits = String(Date.now() % 1e8).padStart(8, '0')
  return `${base}${digits}.json`
}

function removeCustomTheme(r: ReportDocument): void {
  const old = r.report?.themeCollection?.customTheme?.name
  if (old) delete r.resources[RESOURCE_DIR + old]
  const pkg = (r.report?.resourcePackages ?? []).find((p: any) => p.name === 'RegisteredResources')
  if (pkg?.items) pkg.items = pkg.items.filter((i: any) => i.type !== 'CustomTheme')
  if (pkg && !pkg.items?.length) r.report.resourcePackages = r.report.resourcePackages.filter((p: any) => p !== pkg)
  if (r.report?.themeCollection) delete r.report.themeCollection.customTheme
  r.theme.custom = undefined
}

/** Pure: write a custom theme (or remove it with json = null) into a report draft. */
export function setReportTheme(r: ReportDocument, json: ThemeJson | null, fileName?: string): void {
  removeCustomTheme(r)
  if (!json) return
  const name = fileName ?? themeFileName(json.name)
  r.theme.custom = json
  r.report.themeCollection ??= {}
  r.report.themeCollection.customTheme = { name, reportVersionAtImport: { ...VERSION_AT_IMPORT }, type: 'RegisteredResources' }
  const path = RESOURCE_DIR + name
  r.resources[path] = { path, bytes: new TextEncoder().encode(JSON.stringify(json, null, 2)), mime: 'application/json' }
  registerResource(r, name, 'CustomTheme')
}

export function applyThemeJson(json: ThemeJson, fileName?: string): void {
  const app = useApp.getState()
  if (!app.project?.report) {
    toast({ kind: 'warning', message: 'Open or create a report before applying a theme.' })
    return
  }
  app.mutateReport('Change theme', (r) => setReportTheme(r, json, fileName))
}

export function applyTheme(theme: BuiltinTheme | null): void {
  const app = useApp.getState()
  if (!app.project?.report) {
    toast({ kind: 'warning', message: 'Open or create a report before applying a theme.' })
    return
  }
  const json = theme?.json ? (cloneDeep(theme.json) as ThemeJson) : null
  app.mutateReport('Change theme', (r) => setReportTheme(r, json))
}

/** Name of the active custom theme, or 'Default'. */
export function currentThemeName(): string {
  const custom = useApp.getState().project?.report?.theme.custom
  return custom?.name ?? 'Default'
}

export async function importThemeFile(): Promise<void> {
  const paths = await window.wbi.dialog.openFile({ title: 'Browse for themes', filters: [{ name: 'Theme files', extensions: ['json'] }] })
  if (!paths?.[0]) return
  let json: unknown
  try {
    json = JSON.parse((await window.wbi.fs.readText(paths[0])).replace(/^﻿/, ''))
  } catch (e) {
    toast({ kind: 'error', title: "Couldn't import the theme", message: `The file isn't valid JSON: ${e instanceof Error ? e.message : String(e)}` })
    return
  }
  const err = validateThemeJson(json)
  if (err) {
    toast({ kind: 'error', title: "Couldn't import the theme", message: err })
    return
  }
  const t = json as ThemeJson
  if (!t.name) t.name = (paths[0].split('/').pop() ?? 'Theme').replace(/\.json$/i, '')
  applyThemeJson(t)
  toast({ kind: 'success', message: `Theme "${t.name}" imported.`, duration: 3000 })
}

/** The theme JSON to save: the custom theme if any, otherwise the essential keys of the resolved theme. */
export function currentThemeJson(): ThemeJson {
  const { project, theme } = useApp.getState()
  const custom = project?.report?.theme.custom
  if (custom) return cloneDeep(custom)
  return {
    name: theme.name,
    dataColors: theme.dataColors,
    foreground: theme.foreground,
    foregroundNeutralSecondary: theme.foregroundNeutralSecondary,
    foregroundNeutralTertiary: theme.foregroundNeutralTertiary,
    background: theme.background,
    backgroundLight: theme.backgroundLight,
    backgroundNeutral: theme.backgroundNeutral,
    tableAccent: theme.tableAccent,
    good: theme.good,
    neutral: theme.neutral,
    bad: theme.bad,
    maximum: theme.maximum,
    center: theme.center,
    minimum: theme.minimum,
    null: theme.null,
    hyperlink: theme.hyperlink,
    textClasses: theme.textClasses
  }
}

export async function saveCurrentTheme(): Promise<void> {
  const json = currentThemeJson()
  const docs = await window.wbi.app.getPath('documents').catch(() => '')
  const path = await window.wbi.dialog.saveFile({ title: 'Save current theme', defaultPath: `${docs}/${(json.name || 'Theme').replace(/[\\/:*?"<>|]/g, '_')}.json`, filters: [{ name: 'Theme files', extensions: ['json'] }] })
  if (!path) return
  try {
    await window.wbi.fs.writeFile(path, JSON.stringify(json, null, 2))
    toast({ kind: 'success', message: `Theme saved to ${path}`, duration: 3000 })
  } catch (e) {
    toast({ kind: 'error', title: "Couldn't save the theme", message: e instanceof Error ? e.message : String(e) })
  }
}

export { ThemeSwatch } from './ThemeSwatch'

/** Built-in theme by gallery name (Options ▸ default report theme). null = Default / unknown (no custom theme). */
export function defaultThemeFor(name: string | undefined): BuiltinTheme | null {
  if (!name) return null
  const t = builtinThemeByName(name)
  return t?.json ? t : null
}

/** Built-in theme by name, tolerant of case / spacing / hyphens ("Color-blind safe" = "Colorblind safe"). */
export function builtinThemeByName(name: string): BuiltinTheme | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const n = norm(name)
  return BUILTIN_THEMES.find((x) => norm(x.name) === n)
}

/**
 * Metadata of custom (AppSource / organizational / private) visuals referenced by a report.
 *
 * PBIX and PBIP store an imported visual's package under `Report/CustomVisuals/<guid>/`:
 *   package.json                      → { visual: { guid, name, displayName, version, … }, author, … }
 *   resources/<guid>.pbiviz.json      → { visual: { displayName, … }, capabilities, content, … }
 * Our ReportDocument keeps them verbatim in `extraFiles` (paths relative to the `.Report` folder).
 * Public AppSource visuals that the file doesn't embed (only `report.publicCustomVisuals` lists
 * them) have no package; the name is then derived from the visualType.
 */
import type { ReportDocument } from '@core/report/types'

const GUID_SUFFIX = /(?:[0-9A-F]{32}|_[0-9A-F]{8}(?:_[0-9A-F]{4}){3}_[0-9A-F]{12})$/i

/** visualType without its GUID suffix: `FlowVisual_C29F…` → `FlowVisual`, `htmlContent443B…` → `htmlContent`. */
export function stripVisualGuid(visualType: string): string {
  return visualType.replace(GUID_SUFFIX, '')
}

function textOf(v: Uint8Array | string | undefined): string | undefined {
  if (v === undefined) return undefined
  if (typeof v === 'string') return v
  try {
    return new TextDecoder('utf-8').decode(v).replace(/^﻿/, '')
  } catch {
    return undefined
  }
}

function fileOf(report: ReportDocument, rel: string): string | undefined {
  const want = rel.toLowerCase()
  for (const [k, v] of Object.entries(report.extraFiles ?? {})) {
    const key = k.replace(/\\/g, '/').replace(/^\/?(Report\/)?/i, '').toLowerCase()
    if (key === want) return textOf(v)
  }
  for (const r of Object.values(report.resources ?? {})) {
    const key = r.path.replace(/\\/g, '/').replace(/^\/?(Report\/)?/i, '').toLowerCase()
    if (key === want) return textOf(r.bytes)
  }
  return undefined
}

function displayNameIn(json: string | undefined): string | undefined {
  if (!json) return undefined
  try {
    const d = JSON.parse(json)
    const n = d?.visual?.displayName ?? d?.displayName
    return typeof n === 'string' && n.trim() ? n.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Display name of a custom visual as Power BI shows it ("Power Automate for Power BI"), read from the
 * embedded package (`CustomVisuals/<guid>/package.json`, else the `.pbiviz.json` resource).
 * Undefined when the report doesn't embed the package.
 */
export function customVisualDisplayName(report: ReportDocument, visualType: string): string | undefined {
  if (!visualType) return undefined
  const dir = `customvisuals/${visualType.toLowerCase()}`
  const fromPackage = displayNameIn(fileOf(report, `${dir}/package.json`))
  if (fromPackage) return fromPackage
  return displayNameIn(fileOf(report, `${dir}/resources/${visualType.toLowerCase()}.pbiviz.json`))
}

/** Best label for an unsupported visual: the package display name, else a humanized visualType ("Chiclet Slicer"). */
export function customVisualLabel(report: ReportDocument | undefined, visualType: string): string {
  const fromPkg = report ? customVisualDisplayName(report, visualType) : undefined
  if (fromPkg) return fromPkg
  const base = stripVisualGuid(visualType).replace(/[_-]+$/, '') || visualType
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

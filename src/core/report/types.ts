/**
 * In-memory report document.
 *
 * The canonical form is PBIR JSON (Fabric "report definition" format, schema
 * https://developer.microsoft.com/json-schemas/fabric/item/report/definition/...).
 * We deliberately keep the PBIR JSON objects as-is (typed loosely) instead of inventing a
 * parallel model: editing then means mutating PBIR JSON, and saving is a straight write-back.
 * Legacy PBIX `Report/Layout` files are CONVERTED into this shape on load.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

/** A file inside the report folder we carry along (images, themes, custom visuals). */
export interface ResourceFile {
  /** path relative to the `.Report` folder, '/'-separated, e.g. `StaticResources/RegisteredResources/logo.png` */
  path: string
  bytes: Uint8Array
  /** best-effort MIME type */
  mime?: string
}

export interface VisualDocument {
  /** folder name / `name` property */
  name: string
  /** visual.json content (visualContainer schema). Either has `visual` or `visualGroup`. */
  json: any
  /** mobile.json if present */
  mobile?: any
}

export interface PageDocument {
  name: string
  /** page.json content */
  json: any
  visuals: VisualDocument[]
}

export interface BookmarkDocument {
  name: string
  /** <name>.bookmark.json content */
  json: any
}

export interface ReportDocument {
  /** where it came from — affects how we save */
  origin: 'pbir' | 'pbix-legacy' | 'pbix-pbir' | 'new'
  /** definition.pbir content (dataset reference) */
  pbir?: any
  /** definition/report.json */
  report: any
  /** definition/version.json */
  version?: any
  /** definition/pages/pages.json */
  pagesMeta: { pageOrder: string[]; activePageName?: string; [k: string]: any }
  pages: PageDocument[]
  /** definition/bookmarks/bookmarks.json (+ each bookmark file) */
  bookmarksMeta?: any
  bookmarks: BookmarkDocument[]
  /** definition/reportExtensions.json (report-level measures) */
  reportExtensions?: any
  /** resolved theme JSONs (base + custom), already parsed */
  theme: { base?: any; custom?: any }
  resources: Record<string, ResourceFile>
  /** any other files we read and don't model, preserved verbatim for round-trip (relative path -> content) */
  extraFiles: Record<string, Uint8Array | string>
  /** Problems found while reading (unsupported visuals, conversion losses...) */
  diagnostics: string[]
}

export function emptyReport(): ReportDocument {
  const pageName = 'ReportSection'
  return {
    origin: 'new',
    report: {
      $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.0.0/schema.json',
      themeCollection: { baseTheme: { name: 'CY24SU10', reportVersionAtImport: { visual: '1.8.97', report: '2.0.97', page: '1.3.97' }, type: 'SharedResources' } },
      settings: { useStylableVisualContainerHeader: true, defaultDrillFilterOtherVisuals: true }
    },
    pagesMeta: { pageOrder: [pageName], activePageName: pageName },
    pages: [
      {
        name: pageName,
        json: { name: pageName, displayName: 'Page 1', displayOption: 'FitToPage', height: 720, width: 1280 },
        visuals: []
      }
    ],
    bookmarks: [],
    theme: {},
    resources: {},
    extraFiles: {},
    diagnostics: []
  }
}

/**
 * Report resources (StaticResources/*): MIME types, ResourcePackageItem -> file, URLs for rendering.
 */
import type { ReportDocument, ResourceFile } from '../report/types'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  json: 'application/json',
  js: 'text/javascript',
  css: 'text/css',
  txt: 'text/plain',
  pbiviz: 'application/zip',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2'
}

export function mimeFromPath(path: string): string {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

export function makeResource(path: string, bytes: Uint8Array): ResourceFile {
  return { path, bytes, mime: mimeFromPath(path) }
}

/** SQ `ResourcePackageItem` expression payload. */
export interface ResourcePackageItemRef {
  PackageName: string
  /** 1 = RegisteredResources, 2 = SharedResources (numbers) or the type names */
  PackageType: number | string
  ItemName: string
}

function packageKind(ref: ResourcePackageItemRef): 'RegisteredResources' | 'SharedResources' | 'CustomVisual' {
  const t = ref.PackageType
  if (t === 2 || t === 'SharedResources' || ref.PackageName === 'SharedResources') return 'SharedResources'
  if (t === 0 || t === 'CustomVisual') return 'CustomVisual'
  return 'RegisteredResources'
}

/** Resolve a `ResourcePackageItem` (image / theme reference) to a path relative to the `.Report` folder. */
export function resourcePathForItem(report: ReportDocument, ref: ResourcePackageItemRef): string {
  const kind = packageKind(ref)
  const pkgs: any[] = Array.isArray(report.report?.resourcePackages) ? report.report.resourcePackages : []
  const pkg = pkgs.find((p) => p.name === ref.PackageName) ?? pkgs.find((p) => p.type === kind)
  const item = pkg?.items?.find((i: any) => i.name === ref.ItemName) ?? pkg?.items?.find((i: any) => i.path === ref.ItemName)
  const rel: string = item?.path ?? ref.ItemName
  if (kind === 'SharedResources') return `StaticResources/SharedResources/${rel}`
  if (kind === 'CustomVisual') return `CustomVisuals/${ref.PackageName}/resources/${rel}`
  return `StaticResources/RegisteredResources/${rel}`
}

export function findResource(report: ReportDocument, ref: ResourcePackageItemRef): ResourceFile | undefined {
  const path = resourcePathForItem(report, ref)
  return report.resources[path] ?? Object.values(report.resources).find((r) => r.path.endsWith('/' + ref.ItemName))
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}

/** `data:` URL for a resource (works anywhere, including workers and exports). */
export function resourceDataUrl(file: ResourceFile): string {
  return `data:${file.mime ?? mimeFromPath(file.path)};base64,${bytesToBase64(file.bytes)}`
}

/**
 * `blob:` URL for a resource (renderer only; falls back to a data URL where `URL.createObjectURL`
 * is unavailable). Callers own the URL and should `URL.revokeObjectURL` it when done.
 */
export function resourceBlobUrl(file: ResourceFile): string {
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mime ?? mimeFromPath(file.path) }))
  }
  return resourceDataUrl(file)
}

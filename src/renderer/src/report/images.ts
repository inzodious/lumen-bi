/**
 * Report image resolution: PBIR `ResourcePackageItem` references (or plain item names / URLs) → blob URLs
 * created from `report.resources`. Object URLs are cached per resource file object.
 */
import type { ReportDocument, ResourceFile } from '@core/report/types'

const urlCache = new WeakMap<ResourceFile, string>()

function mimeOf(path: string, given?: string): string {
  if (given) return given
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

export function findResource(report: ReportDocument | undefined, ref: { resource: string; package?: string } | string): ResourceFile | undefined {
  if (!report) return undefined
  const item = typeof ref === 'string' ? ref : ref.resource
  if (!item) return undefined
  const res = report.resources ?? {}
  if (res[item]) return res[item]
  const pkg = typeof ref === 'string' ? undefined : ref.package
  const candidates = Object.values(res).filter((r) => r.path === item || r.path.endsWith('/' + item))
  if (candidates.length <= 1) return candidates[0]
  return candidates.find((r) => (pkg ? r.path.includes('/' + pkg + '/') : true)) ?? candidates[0]
}

export function resolveImageUrl(report: ReportDocument | undefined, ref: { resource: string; package?: string; packageType?: number } | string): string | undefined {
  if (typeof ref === 'string' && /^(https?:|data:|blob:)/i.test(ref)) return ref
  const file = findResource(report, ref)
  if (!file) return undefined
  const cached = urlCache.get(file)
  if (cached) return cached
  if (typeof URL === 'undefined' || typeof Blob === 'undefined') return undefined
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: mimeOf(file.path, file.mime) }))
  urlCache.set(file, url)
  return url
}

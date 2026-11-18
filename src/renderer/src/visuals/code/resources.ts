/**
 * Code visual: registered report images by name. The sandboxed frame cannot load the app's blob: URLs, so images the
 * code references (`{{resource "logo.png"}}`, `resource('logo.png')`, `resource("…")` in CSS comments are ignored)
 * are converted to data: URIs in the host and sent with the render.
 */
import type { ReportInfo } from '../contract'

const RE = /\bresource\s*\(?\s*(["'])([^"'\n]{1,200})\1/g

export function resourceNames(code: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  RE.lastIndex = 0
  while ((m = RE.exec(code))) out.add(m[2])
  return [...out].sort()
}

const cache = new Map<string, Promise<string | undefined>>()
const MAX_BYTES = 4 * 1024 * 1024

function toDataUri(url: string): Promise<string | undefined> {
  let p = cache.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string | undefined>((resolve) => {
            if (b.size > MAX_BYTES) return resolve(undefined)
            const fr = new FileReader()
            fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : undefined)
            fr.onerror = () => resolve(undefined)
            fr.readAsDataURL(b)
          })
      )
      .catch(() => undefined)
    cache.set(url, p)
  }
  return p
}

export async function loadResources(names: string[], report: ReportInfo): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const n of names) {
    const url = report.resolveImage(n)
    if (!url) continue
    if (/^data:image\//i.test(url)) out[n] = url
    else if (/^blob:/i.test(url)) {
      const d = await toDataUri(url)
      if (d) out[n] = d
    }
    // http(s) URLs stay unresolved: the frame has no network access
  }
  return out
}

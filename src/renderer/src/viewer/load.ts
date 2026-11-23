/**
 * Loading a published dashboard: `lumen-publish.json` next to the page names the bundle; the bundle is a `.wbi`.
 * `?src=<folder or manifest URL>` points the viewer at another dashboard (Lumen Server's shared viewer).
 */
import { openWbi } from '@core/io/open'
import { PUBLISH_MANIFEST, type PublishManifest } from '@core/publish/bundle'
import type { ProjectDocument } from '@core/project'

export interface LoadedDashboard {
  manifest: PublishManifest
  bytes: Uint8Array
  project: ProjectDocument
}

/** A fresh project from the bundle bytes (the published state: saved slicer selections, first page). */
export async function openDashboard(manifest: PublishManifest, bytes: Uint8Array): Promise<ProjectDocument> {
  const project = await openWbi(bytes, undefined)
  project.name = manifest.title || project.name
  return project
}

export function manifestUrl(location: { href: string; search: string }): string {
  const src = new URLSearchParams(location.search).get('src')
  if (!src) return new URL(PUBLISH_MANIFEST, location.href).href
  const base = new URL(src, location.href)
  return /\.json$/i.test(base.pathname) ? base.href : new URL(PUBLISH_MANIFEST, base.href.endsWith('/') ? base.href : `${base.href}/`).href
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'You do not have access to this dashboard.' : `Could not load ${url.split('/').pop()} (HTTP ${res.status}).`)
  return res
}

/** Read the response body, reporting progress against the manifest's byte count. */
async function readBytes(res: Response, total: number, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.byteLength
    if (total > 0) onProgress(Math.min(1, got / total))
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

export async function loadDashboard(url: string, onProgress?: (fraction: number) => void): Promise<LoadedDashboard> {
  const manifest = (await (await fetchOk(url)).json()) as PublishManifest
  if (manifest?.format !== 'lumen-publish') throw new Error('This folder does not hold a published Lumen dashboard.')
  const bytes = await readBytes(await fetchOk(new URL(manifest.bundle, url).href), manifest.bytes, onProgress)
  return { manifest, bytes, project: await openDashboard(manifest, bytes) }
}

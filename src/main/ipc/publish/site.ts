/**
 * A published site on disk: the built viewer (out/viewer) plus the publish files (lumen-publish.json, report.wbi).
 * Node only, no Electron imports, so the publish targets and their tests share it.
 */
import { promises as fsp } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { zipSync } from 'fflate'

export type SiteFiles = Record<string, Uint8Array>

export const SITE_MANIFEST = 'lumen-publish.json'

async function walk(dir: string, root = dir, out: string[] = []): Promise<string[]> {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, root, out)
    else if (e.isFile()) out.push(relative(root, p).split(sep).join('/'))
  }
  return out
}

/** The viewer files with the publish files added (publish files win on a name clash). */
export async function assembleSite(viewerDir: string, publishFiles: Record<string, Uint8Array | string>): Promise<SiteFiles> {
  const files: SiteFiles = {}
  for (const rel of await walk(viewerDir)) files[rel] = new Uint8Array(await fsp.readFile(join(viewerDir, rel)))
  if (!files['index.html']) throw new Error('The dashboard viewer is incomplete (index.html missing). Rebuild Lumen.')
  for (const [rel, c] of Object.entries(publishFiles)) {
    if (!isSafeRelative(rel)) throw new Error(`Invalid file name in publish set: ${rel}`)
    files[rel] = typeof c === 'string' ? new TextEncoder().encode(c) : c
  }
  return files
}

export function isSafeRelative(rel: string): boolean {
  return !!rel && !rel.startsWith('/') && !/^[a-z]:/i.test(rel) && !rel.split(/[\\/]/).some((s) => s === '..' || s === '')
}

export function siteBytes(files: SiteFiles): number {
  return Object.values(files).reduce((n, b) => n + b.byteLength, 0)
}

export type FolderCheck = 'empty' | 'published' | 'other'

/** What is in a target folder: nothing, an earlier published dashboard (safe to replace), or other files. */
export async function checkFolder(dir: string): Promise<FolderCheck> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return 'empty'
  }
  if (!names.length) return 'empty'
  return names.includes(SITE_MANIFEST) ? 'published' : 'other'
}

/**
 * Write the site into `dir`. An earlier published dashboard there is replaced (its `assets` folder removed first, so
 * stale hashed files don't pile up); a folder holding other files is refused unless `replace` is set, and then only
 * the site's own files are written.
 */
export async function writeSiteFolder(dir: string, files: SiteFiles, opts: { replace?: boolean } = {}): Promise<void> {
  const state = await checkFolder(dir)
  if (state === 'other' && !opts.replace) throw Object.assign(new Error('The folder already holds other files.'), { code: 'not-empty' })
  if (state === 'published') await fsp.rm(join(dir, 'assets'), { recursive: true, force: true })
  await fsp.mkdir(dir, { recursive: true })
  for (const [rel, bytes] of Object.entries(files)) {
    const p = join(dir, ...rel.split('/'))
    await fsp.mkdir(join(p, '..'), { recursive: true })
    await fsp.writeFile(p, bytes)
  }
}

/** The site as a zip (files at the root of the archive, ready for drag-and-drop hosting). */
export function zipSite(files: SiteFiles): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [rel, b] of Object.entries(files)) entries[rel] = b
  return zipSync(entries, { level: 6 })
}

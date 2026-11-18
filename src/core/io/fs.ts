/**
 * Async filesystem abstraction used by all core loaders/savers. In the app it is backed by the
 * Electron preload bridge (window.wbi.fs); in tests by Node's fs (see ./nodefs.ts).
 * Paths are absolute POSIX paths.
 */
export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  /** ms since epoch */
  mtime: number
}

export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  list(dir: string): Promise<DirEntry[]>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<DirEntry | null>
  mkdirp(dir: string): Promise<void>
  remove(path: string): Promise<void>
}

export function joinPath(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/').replace(/\/+/g, '/')
  const segs: string[] = []
  for (const s of joined.split('/')) {
    if (s === '..') segs.pop()
    else if (s !== '.') segs.push(s)
  }
  return segs.join('/') || '/'
}

export function dirname(p: string): string {
  const i = p.replace(/\/+$/, '').lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

export function basename(p: string): string {
  const s = p.replace(/\/+$/, '')
  return s.slice(s.lastIndexOf('/') + 1)
}

/** Recursively list all files below dir (relative paths with '/'). */
export async function walk(fs: FileSystem, dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.list(dir)) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory) out.push(...(await walk(fs, e.path, rel)))
    else out.push(rel)
  }
  return out
}

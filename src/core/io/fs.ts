/**
 * Async filesystem abstraction used by all core loaders/savers. In the app it is backed by the
 * Electron preload bridge (window.wbi.fs); in tests by Node's fs (see ./nodefs.ts).
 * Paths are absolute and use '/' separators: POSIX paths on Linux, `C:/Users/…` and `//server/share/…` on Windows
 * (Node accepts forward slashes there). The main process converts native Windows paths with `portablePath`.
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

/** Native path → the '/'-separated form used everywhere in the app (`C:\\Users\\x` → `C:/Users/x`, UNC → `//host/share`). */
export function portablePath(p: string): string {
  return /^[a-z]:[\\/]|^\\\\|\\/i.test(p) && !p.startsWith('/') ? p.replace(/\\/g, '/') : p
}

/** Root prefix kept as-is by the helpers below: `C:/`, `//host/share/`, or `/`. */
function rootOf(p: string): string {
  const drive = /^[a-z]:\//i.exec(p)
  if (drive) return drive[0]
  const unc = /^\/\/[^/]+\/[^/]+\/?/.exec(p)
  if (unc) return unc[0].endsWith('/') ? unc[0] : `${unc[0]}/`
  return p.startsWith('/') ? '/' : ''
}

export function joinPath(...parts: string[]): string {
  const raw = portablePath(parts.filter(Boolean).join('/'))
  const root = rootOf(raw)
  const segs: string[] = []
  for (const s of raw.slice(root.length).split('/')) {
    if (!s || s === '.') continue
    if (s === '..') segs.pop()
    else segs.push(s)
  }
  return root + segs.join('/') || '/'
}

export function dirname(path: string): string {
  const p = portablePath(path)
  const root = rootOf(p)
  const s = p.replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  if (root) return i < root.length ? root : s.slice(0, i)
  return i <= 0 ? '/' : s.slice(0, i)
}

export function basename(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1)
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

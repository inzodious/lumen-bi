/** Node implementation of FileSystem (tests, Electron main process). */
import { promises as fsp } from 'node:fs'
import { basename, type DirEntry, type FileSystem } from './fs'

export const nodeFs: FileSystem = {
  async readFile(path) {
    return new Uint8Array(await fsp.readFile(path))
  },
  async readText(path) {
    const buf = await fsp.readFile(path)
    // strip UTF-8 BOM; detect UTF-16LE BOM
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
    const s = buf.toString('utf8')
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
  },
  async writeFile(path, data) {
    await fsp.writeFile(path, data)
  },
  async list(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const out: DirEntry[] = []
    for (const e of entries) {
      const p = `${dir.replace(process.platform === 'win32' ? /[\\/]+$/ : /\/+$/, '')}/${e.name}`
      const st = await fsp.stat(p).catch(() => null)
      out.push({ name: e.name, path: p, isDirectory: e.isDirectory(), size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
  async exists(path) {
    return fsp.access(path).then(
      () => true,
      () => false
    )
  },
  async stat(path) {
    const st = await fsp.stat(path).catch(() => null)
    if (!st) return null
    return { name: basename(path) || path, path, isDirectory: st.isDirectory(), size: st.size, mtime: st.mtimeMs }
  },
  async mkdirp(dir) {
    await fsp.mkdir(dir, { recursive: true })
  },
  async remove(path) {
    await fsp.rm(path, { recursive: true, force: true })
  }
}

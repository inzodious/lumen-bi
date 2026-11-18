/**
 * Network shares for Get data ▸ Network share and for `Folder.Files("smb://host/share/dir")` /
 * `Folder.Files("\\host\share\dir")`: discovery of GVFS mounts (/run/user/$UID/gvfs), kernel NFS / CIFS /
 * SSHFS mounts (/proc/mounts, plus fstab entries not mounted yet), removable and manual mounts (/media,
 * /mnt); mounting SMB shares with `gio mount` (credentials answered on stdin); resolving share URLs to the
 * mounted local path so the file readers work on them transparently (TrueNAS / NAS datasets).
 */
import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MountRequest, ShareInfo } from '../../../shared/host'
import { ConnectorError } from './common'

// ---------------------------------------------------------------------------------------------
// Parsing (pure)

/** GVFS mount directory name → share info (`smb-share:server=nas,share=data`, `sftp:host=h,user=u`, …). */
export function parseGvfsName(dir: string, name: string): ShareInfo | null {
  const i = name.indexOf(':')
  if (i < 0) return null
  const scheme = name.slice(0, i)
  const params = new Map<string, string>()
  for (const kv of name.slice(i + 1).split(',')) {
    const j = kv.indexOf('=')
    if (j > 0) params.set(kv.slice(0, j), decodeURIComponent(kv.slice(j + 1).replace(/%(?![0-9a-f]{2})/gi, '%25')))
  }
  const path = join(dir, name)
  const host = params.get('server') ?? params.get('host')
  switch (scheme) {
    case 'smb-share': {
      const share = params.get('share')
      if (!host || !share) return null
      return { path, url: `smb://${host}/${share}`, kind: 'smb', host, share, via: 'gvfs', label: `${share} on ${host}` }
    }
    case 'sftp':
      if (!host) return null
      return { path, url: `sftp://${params.get('user') ? `${params.get('user')}@` : ''}${host}${params.get('port') ? `:${params.get('port')}` : ''}`, kind: 'sftp', host, via: 'gvfs', label: `${host} (SFTP)` }
    case 'nfs': {
      const volume = params.get('volume') ?? params.get('path') ?? ''
      if (!host) return null
      return { path, url: `nfs://${host}${volume.startsWith('/') ? '' : '/'}${volume}`, kind: 'nfs', host, share: volume, via: 'gvfs', label: `${volume || '/'} on ${host} (NFS)` }
    }
    case 'dav':
    case 'davs':
      if (!host) return null
      return { path, url: `${params.get('ssl') === 'true' || scheme === 'davs' ? 'davs' : 'dav'}://${host}${params.get('prefix') ?? ''}`, kind: 'webdav', host, via: 'gvfs', label: `${host} (WebDAV)` }
    default:
      return host ? { path, kind: 'other', host, via: 'gvfs', label: `${host} (${scheme})` } : null
  }
}

const NETWORK_FS = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'smbfs', 'fuse.sshfs', 'fuse.rclone', 'davfs', 'fuse.davfs2'])

/** /proc/mounts and fstab use octal escapes for spaces etc. */
function unescapeMount(s: string): string {
  return s.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)))
}

function shareOfDevice(device: string, fstype: string, mountpoint: string, via: ShareInfo['via']): ShareInfo | null {
  if (fstype === 'cifs' || fstype === 'smb3' || fstype === 'smbfs') {
    const m = /^\/\/([^/]+)\/(.+)$/.exec(device.replace(/\\/g, '/'))
    if (!m) return null
    return { path: mountpoint, url: `smb://${m[1]}/${m[2]}`, kind: 'smb', host: m[1], share: m[2], via, label: `${m[2]} on ${m[1]}` }
  }
  if (fstype === 'nfs' || fstype === 'nfs4') {
    const m = /^\[?([^\]]+?)\]?:(\/.*)?$/.exec(device)
    if (!m) return null
    const exp = m[2] ?? '/'
    return { path: mountpoint, url: `nfs://${m[1]}${exp}`, kind: 'nfs', host: m[1], share: exp, via, label: `${exp} on ${m[1]} (NFS)` }
  }
  if (fstype === 'fuse.sshfs') {
    const m = /^(?:([^@]+)@)?([^:]+):(.*)$/.exec(device)
    return { path: mountpoint, url: m ? `sftp://${m[1] ? `${m[1]}@` : ''}${m[2]}${m[3] ? `/${m[3].replace(/^\//, '')}` : ''}` : undefined, kind: 'sftp', host: m?.[2], via, label: `${device} (SSHFS)` }
  }
  return { path: mountpoint, kind: fstype.includes('dav') ? 'webdav' : 'other', via, label: `${device} (${fstype})` }
}

/** Network file systems in /proc/mounts (or /etc/fstab) text. */
export function parseMounts(text: string, via: ShareInfo['via'] = 'mount'): ShareInfo[] {
  const out: ShareInfo[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const [device, mountpoint, fstype] = t.split(/\s+/)
    if (!device || !mountpoint || !fstype || !NETWORK_FS.has(fstype)) continue
    const s = shareOfDevice(unescapeMount(device), fstype, unescapeMount(mountpoint), via)
    if (s) out.push(s)
  }
  return out
}

/** `\\host\share\dir`, `smb://host/share/dir`, `nfs://host/export/dir` → parts; null for local paths. */
export function parseShareUrl(path: string): { scheme: 'smb' | 'nfs'; host: string; share: string; rest: string } | null {
  const unc = /^\\\\([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/.exec(path)
  if (unc) return { scheme: 'smb', host: unc[1]!, share: unc[2]!, rest: (unc[3] ?? '').replace(/\\/g, '/').replace(/\/+$/, '') }
  const smb = /^smb:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)(?:\/(.*))?$/i.exec(path)
  if (smb) return { scheme: 'smb', host: smb[1]!, share: decodeURIComponent(smb[2]!), rest: decodeURIComponent((smb[3] ?? '').replace(/\/+$/, '')) }
  const nfs = /^nfs:\/\/([^/]+)(\/.*)$/i.exec(path)
  if (nfs) return { scheme: 'nfs', host: nfs[1]!, share: nfs[2]!.replace(/\/+$/, ''), rest: '' }
  return null
}

/** The mounted local path of a share URL among the known shares (longest NFS export prefix wins). */
export function resolveAgainst(path: string, shares: ShareInfo[]): string | null {
  const p = parseShareUrl(path)
  if (!p) return null
  const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  if (p.scheme === 'smb') {
    const s = shares.find((x) => x.kind === 'smb' && eq(x.host, p.host) && eq(x.share, p.share))
    return s ? (p.rest ? `${s.path}/${p.rest}` : s.path) : null
  }
  let best: ShareInfo | null = null
  for (const s of shares) {
    if (s.kind !== 'nfs' || !eq(s.host, p.host) || !s.share) continue
    const exp = s.share.replace(/\/+$/, '') || '/'
    if ((p.share === exp || p.share.startsWith(`${exp}/`) || exp === '/') && (!best || exp.length > (best.share ?? '').length)) best = s
  }
  if (!best) return null
  const exp = best.share!.replace(/\/+$/, '')
  const rest = p.share.slice(exp.length).replace(/^\//, '')
  return rest ? `${best.path}/${rest}` : best.path
}

/** smb://host/share or \\host\share → the URL gio understands. */
export function normalizeShareUrl(url: string): string {
  const p = parseShareUrl(url.trim())
  if (p?.scheme === 'smb') return `smb://${p.host}/${encodeURIComponent(p.share)}`
  if (/^[a-z]+:\/\//i.test(url.trim())) return url.trim()
  throw new ConnectorError(`'${url}' isn't a share address (use smb://server/share or \\\\server\\share).`)
}

// ---------------------------------------------------------------------------------------------
// System access

export interface ShareEnv {
  uid: number
  user: string
  /** for tests */
  root?: string
}

function sysEnv(): ShareEnv {
  return { uid: process.getuid?.() ?? 1000, user: process.env['USER'] ?? '' }
}

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

export async function listShares(env: ShareEnv = sysEnv()): Promise<ShareInfo[]> {
  const root = env.root ?? ''
  const out: ShareInfo[] = []
  const gvfs = `${root}/run/user/${env.uid}/gvfs`
  for (const name of await dirs(gvfs)) {
    const s = parseGvfsName(gvfs, name)
    if (s) out.push(s)
  }
  const mounted = parseMounts(await readFile(`${root}/proc/mounts`, 'utf8').catch(() => ''))
  out.push(...mounted)
  // fstab network entries that aren't mounted (a `user` option lets `mount <dir>` work without root)
  for (const s of parseMounts(await readFile(`${root}/etc/fstab`, 'utf8').catch(() => ''), 'mount')) {
    if (!mounted.some((m) => m.path === s.path)) out.push({ ...s, mounted: false, label: `${s.label} — not mounted` })
  }
  const seen = new Set(out.map((s) => s.path))
  for (const base of [`${root}/media/${env.user}`, `${root}/mnt`, `${root}/media`]) {
    for (const name of await dirs(base)) {
      const path = `${base}/${name}`
      if (seen.has(path) || (base === `${root}/media` && name === env.user)) continue
      seen.add(path)
      out.push({ path, kind: 'local', via: 'media', label: name })
    }
  }
  return out.map((s) => (s.mounted === undefined ? { ...s, mounted: true } : s))
}

export async function resolveSharePath(path: string, env?: ShareEnv): Promise<string | null> {
  if (!parseShareUrl(path)) return null
  return resolveAgainst(path, (await listShares(env)).filter((s) => s.mounted !== false))
}

function run(cmd: string, args: string[], input: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LANG: 'C' } })
    let out = ''
    p.stdout.on('data', (d) => (out += String(d)))
    p.stderr.on('data', (d) => (out += String(d)))
    const timer = setTimeout(() => {
      p.kill()
      reject(new ConnectorError(`${cmd} didn't finish within ${Math.round(timeoutMs / 1000)} s.`))
    }, timeoutMs)
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(new ConnectorError(/ENOENT/.test(String(e)) ? `'${cmd}' isn't installed (it comes with GLib/GVfs: install the gvfs-backends / gvfs-smb package).` : String(e)))
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out })
    })
    p.stdin.end(input)
  })
}

/** `gio mount smb://host/share` with the credentials answered on stdin; returns the mounted path. */
export async function mountShare(req: MountRequest, env?: ShareEnv): Promise<string> {
  const url = normalizeShareUrl(req.url)
  const already = await resolveSharePath(url, env)
  if (already) return already
  const args = req.anonymous ? ['mount', '-a', url] : ['mount', url]
  // gio asks: User [x]:, Domain [WORKGROUP]:, Password:
  const answers = req.anonymous ? '' : `${req.user ?? ''}\n${req.domain ?? ''}\n${req.password ?? ''}\n`
  const r = await run('gio', args, answers, 60_000)
  if (r.code !== 0 && !/already mounted/i.test(r.out)) {
    const msg = r.out.replace(/^(User|Domain|Password)[^\n]*:\s*/gim, '').trim() || `gio mount exited with ${r.code}`
    throw new ConnectorError(`Mounting ${url} failed: ${msg}`, /denied|password|logon|authenticat/i.test(msg) ? 'credentials' : 'error')
  }
  const path = await resolveSharePath(url, env)
  if (!path) throw new ConnectorError(`${url} was mounted, but its local path wasn't found under /run/user/<uid>/gvfs.`)
  return path
}

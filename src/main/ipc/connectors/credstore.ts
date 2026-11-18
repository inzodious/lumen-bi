/**
 * Persistent credential store (Data source settings), one entry per data source key
 * (src/core/data/queries.ts `dataSourceKey`): how to authenticate, the secrets, and the privacy level.
 *
 * Secrets are encrypted at rest with the OS keyring through Electron `safeStorage` (injected as a
 * `Cipher` so this module stays testable without Electron). When no keyring is available, secrets are
 * kept in memory for the session only and the file holds just the non-secret settings — they are never
 * written in clear text. The file is written atomically with mode 0600.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SECRET_FIELDS, type CredentialAuth, type CredentialInfo, type CredentialInput, type CredentialStoreStatus, type PrivacyLevel } from '../../../shared/host'

export interface Cipher {
  available(): boolean
  backend?(): string | undefined
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface CredentialEntry {
  key: string
  label: string
  auth: CredentialAuth
  privacy: PrivacyLevel
  updatedAt: number
}

interface StoredEntry {
  key: string
  label: string
  auth: Omit<CredentialAuth, (typeof SECRET_FIELDS)[number]>
  privacy: PrivacyLevel
  updatedAt: number
  /** base64 of cipher.encrypt(JSON of the secret fields) */
  secrets?: string
}

interface StoreFile {
  version: 1
  entries: StoredEntry[]
}

type Secrets = Partial<Pick<CredentialAuth, (typeof SECRET_FIELDS)[number]>>

function splitSecrets(auth: CredentialAuth): { plain: StoredEntry['auth']; secrets: Secrets } {
  const plain: Record<string, unknown> = {}
  const secrets: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(auth)) {
    if (v === undefined) continue
    if ((SECRET_FIELDS as readonly string[]).includes(k)) secrets[k] = v
    else plain[k] = v
  }
  return { plain: plain as StoredEntry['auth'], secrets: secrets as Secrets }
}

/** URL prefix match on path segment boundaries (https://api.x.com/v1 covers https://api.x.com/v1/items). */
export function urlCovers(prefix: string, url: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase()
  const p = norm(prefix)
  const u = norm(url.split('#')[0]!)
  return u === p || u.startsWith(`${p}/`) || u.startsWith(`${p}?`)
}

export class CredentialStore {
  private entries: Map<string, CredentialEntry> | null = null
  /** secrets that could not be persisted (no keyring) */
  private readonly volatile = new Map<string, Secrets>()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher
  ) {}

  status(): CredentialStoreStatus {
    return { encrypted: this.cipher.available(), backend: this.cipher.backend?.() }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private load(): Map<string, CredentialEntry> {
    if (this.entries) return this.entries
    const map = new Map<string, CredentialEntry>()
    let data: StoreFile | null = null
    try {
      data = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile
    } catch {
      data = null
    }
    for (const e of data?.entries ?? []) {
      let secrets: Secrets = {}
      if (e.secrets && this.cipher.available()) {
        try {
          secrets = JSON.parse(this.cipher.decrypt(Buffer.from(e.secrets, 'base64'))) as Secrets
        } catch {
          // the keyring changed (other user / reinstalled OS): the secret has to be entered again
          secrets = {}
        }
      }
      map.set(e.key, { key: e.key, label: e.label, auth: { ...e.auth, ...secrets } as CredentialAuth, privacy: e.privacy ?? 'None', updatedAt: e.updatedAt ?? 0 })
    }
    this.entries = map
    return map
  }

  private save(): void {
    const map = this.load()
    const out: StoreFile = { version: 1, entries: [] }
    const encrypt = this.cipher.available()
    for (const e of map.values()) {
      const { plain, secrets } = splitSecrets(e.auth)
      const stored: StoredEntry = { key: e.key, label: e.label, auth: plain, privacy: e.privacy, updatedAt: e.updatedAt }
      if (Object.keys(secrets).length) {
        if (encrypt) stored.secrets = this.cipher.encrypt(JSON.stringify(secrets)).toString('base64')
        else this.volatile.set(e.key, secrets)
      }
      out.entries.push(stored)
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(out, null, 1), { mode: 0o600 })
    renameSync(tmp, this.file)
    for (const l of this.listeners) l()
  }

  /** The full entry (secrets included) — main process only. */
  get(key: string): CredentialEntry | undefined {
    const e = this.load().get(key)
    if (!e) return undefined
    const v = this.volatile.get(key)
    return v ? { ...e, auth: { ...e.auth, ...v } } : e
  }

  /** First entry among `keys` (most specific first). */
  find(keys: string[]): CredentialEntry | undefined {
    for (const k of keys) {
      const e = this.get(k)
      if (e) return e
    }
    return undefined
  }

  /** The web credential whose URL is the longest prefix of `url`. */
  findWeb(url: string): CredentialEntry | undefined {
    let best: CredentialEntry | undefined
    for (const e of this.load().values()) {
      if (!e.key.startsWith('web:')) continue
      const prefix = e.key.slice(4)
      if (urlCovers(prefix, url) && (!best || prefix.length > best.key.length - 4)) best = e
    }
    return best ? this.get(best.key) : undefined
  }

  info(e: CredentialEntry): CredentialInfo {
    const { plain, secrets } = splitSecrets(e.auth)
    return { key: e.key, label: e.label, auth: plain, secrets: Object.keys(secrets).filter((k) => secrets[k as keyof Secrets]), privacy: e.privacy, updatedAt: e.updatedAt }
  }

  list(): CredentialInfo[] {
    return [...this.load().values()].map((e) => this.info(this.get(e.key)!)).sort((a, b) => a.label.localeCompare(b.label))
  }

  /** Creates or updates an entry. Secrets left undefined keep their stored value; '' clears them. */
  set(input: CredentialInput): CredentialInfo {
    const map = this.load()
    const prev = this.get(input.key)
    let auth: CredentialAuth = prev?.auth ?? { kind: 'anonymous' }
    if (input.auth) {
      const keep: Secrets = {}
      // keep the stored secrets the caller didn't send (the renderer never sees them) — same auth kind only
      if (prev && prev.auth.kind === input.auth.kind) for (const f of SECRET_FIELDS) if (input.auth[f] === undefined && prev.auth[f] !== undefined) (keep as Record<string, unknown>)[f] = prev.auth[f]
      auth = { ...input.auth, ...keep }
      for (const f of SECRET_FIELDS) if (auth[f] === '') delete auth[f]
    }
    const entry: CredentialEntry = { key: input.key, label: input.label || prev?.label || input.key, auth, privacy: input.privacy ?? prev?.privacy ?? 'None', updatedAt: Date.now() }
    map.set(input.key, entry)
    this.volatile.delete(input.key)
    this.save()
    return this.info(this.get(input.key)!)
  }

  /** Merges refreshed values (e.g. OAuth tokens) into an entry without touching the rest. */
  update(key: string, patch: Partial<CredentialAuth>): void {
    const e = this.get(key)
    if (!e) return
    this.load().set(key, { ...e, auth: { ...e.auth, ...patch }, updatedAt: Date.now() })
    this.volatile.delete(key)
    this.save()
  }

  clear(key?: string): void {
    const map = this.load()
    if (key === undefined) {
      map.clear()
      this.volatile.clear()
    } else {
      map.delete(key)
      this.volatile.delete(key)
    }
    this.save()
  }
}

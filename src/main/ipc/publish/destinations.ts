/**
 * Saved publish destinations: settings in clear, secrets (tokens, keys) encrypted with the OS keyring through the
 * same Cipher as the credential store. Without a keyring, secrets live in memory for the session only. The file is
 * written atomically with mode 0600. Electron-free so it is testable.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PublishDestination, PublishDestinationInput, PublishDestinationKind } from '../../../shared/host'
import type { Cipher } from '../connectors/credstore'

export interface DestinationEntry {
  id: string
  kind: PublishDestinationKind
  name: string
  settings: Record<string, string>
  secrets: Record<string, string>
  updatedAt: number
}

interface Stored {
  id: string
  kind: PublishDestinationKind
  name: string
  settings: Record<string, string>
  /** base64 of cipher.encrypt(JSON of the secrets) */
  secrets?: string
  updatedAt: number
}

export const DESTINATION_KINDS: PublishDestinationKind[] = ['github-pages', 'netlify', 'cloudflare-pages', 's3', 'lumen-server']

export class DestinationStore {
  private entries: Map<string, DestinationEntry> | null = null
  private readonly volatile = new Map<string, Record<string, string>>()

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
    private readonly now: () => number = Date.now
  ) {}

  private load(): Map<string, DestinationEntry> {
    if (this.entries) return this.entries
    const map = new Map<string, DestinationEntry>()
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { version: number; entries: Stored[] }
      for (const e of raw.entries ?? []) {
        if (!DESTINATION_KINDS.includes(e.kind)) continue
        let secrets: Record<string, string> = {}
        if (e.secrets && this.cipher.available()) {
          try {
            secrets = JSON.parse(this.cipher.decrypt(Buffer.from(e.secrets, 'base64'))) as Record<string, string>
          } catch {
            secrets = {}
          }
        }
        map.set(e.id, { id: e.id, kind: e.kind, name: e.name, settings: e.settings ?? {}, secrets, updatedAt: e.updatedAt ?? 0 })
      }
    } catch {
      /* no file yet */
    }
    this.entries = map
    return map
  }

  private save(): void {
    const encrypt = this.cipher.available()
    const entries: Stored[] = [...this.load().values()].map((e) => {
      const out: Stored = { id: e.id, kind: e.kind, name: e.name, settings: e.settings, updatedAt: e.updatedAt }
      if (Object.keys(e.secrets).length) {
        if (encrypt) out.secrets = this.cipher.encrypt(JSON.stringify(e.secrets)).toString('base64')
        else this.volatile.set(e.id, e.secrets)
      }
      return out
    })
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  /** What the renderer sees: secret names only. */
  info(e: DestinationEntry): PublishDestination {
    return { id: e.id, kind: e.kind, name: e.name, settings: { ...e.settings }, secrets: Object.keys(e.secrets).filter((k) => e.secrets[k]), updatedAt: e.updatedAt }
  }

  list(): PublishDestination[] {
    return [...this.load().values()].sort((a, b) => a.name.localeCompare(b.name)).map((e) => this.info(e))
  }

  get(id: string): DestinationEntry | undefined {
    const e = this.load().get(id)
    if (!e) return undefined
    const v = this.volatile.get(id)
    return v ? { ...e, secrets: { ...v, ...e.secrets } } : e
  }

  set(input: PublishDestinationInput): PublishDestination {
    if (!DESTINATION_KINDS.includes(input.kind)) throw new Error(`Unknown destination type: ${input.kind}`)
    const name = input.name.trim()
    if (!name) throw new Error('Give the destination a name.')
    const map = this.load()
    const prev = input.id ? map.get(input.id) : undefined
    const secrets: Record<string, string> = { ...(prev?.secrets ?? {}), ...(input.id ? (this.volatile.get(input.id) ?? {}) : {}) }
    for (const [k, v] of Object.entries(input.secrets ?? {})) {
      if (v === undefined) continue
      if (v === '') delete secrets[k]
      else secrets[k] = v
    }
    const settings: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.settings ?? {})) if (typeof v === 'string' && v.trim()) settings[k] = v.trim()
    const entry: DestinationEntry = { id: prev?.id ?? randomUUID(), kind: input.kind, name, settings, secrets, updatedAt: this.now() }
    map.set(entry.id, entry)
    this.save()
    return this.info(entry)
  }

  remove(id: string): void {
    this.load().delete(id)
    this.volatile.delete(id)
    this.save()
  }
}

/** Shared pieces of the publish targets: HTTP with readable errors, progress, content types, paths. */
import type { PublishProgress } from '../../../../shared/host'
import type { DestinationEntry } from '../destinations'
import type { SiteFiles } from '../site'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface DeployContext {
  fetch: Fetch
  progress(p: PublishProgress): void
  /** waits between status polls (tests pass a no-op) */
  sleep(ms: number): Promise<void>
}

export interface DeployOutcome {
  url: string
}

export interface PublishTarget {
  /** upload `files` as the dashboard `site` of the destination */
  deploy(dest: DestinationEntry, site: string, files: SiteFiles, title: string, ctx: DeployContext): Promise<DeployOutcome>
  /** check the sign-in and settings; resolves to a short confirmation, throws a PublishError */
  test(dest: DestinationEntry, site: string | undefined, ctx: DeployContext): Promise<string>
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'PublishError'
  }
}

export function requireSetting(dest: DestinationEntry, key: string, label: string): string {
  const v = dest.settings[key]?.trim()
  if (!v) throw new PublishError(`${label} is not set for "${dest.name}". Edit the destination and fill it in.`)
  return v
}

export function requireSecret(dest: DestinationEntry, key: string, label: string): string {
  const v = dest.secrets[key]
  if (!v) throw new PublishError(`The ${label} for "${dest.name}" is missing. Edit the destination and enter it again.`)
  return v
}

/** JSON request; non-2xx responses throw a PublishError with the service's own message when it gives one. */
export async function requestJson<T>(ctx: DeployContext, service: string, url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await ctx.fetch(url, init)
  } catch (e) {
    throw new PublishError(`${service} could not be reached (${e instanceof Error ? e.message : String(e)}).`)
  }
  const text = await res.text()
  let body: unknown = undefined
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }
  if (!res.ok) throw new PublishError(`${service}: ${explainStatus(res.status)}${serviceMessage(body, text) ? ` (${serviceMessage(body, text)})` : ''}`, res.status)
  return body as T
}

function explainStatus(status: number): string {
  if (status === 401) return 'the token was not accepted'
  if (status === 403) return 'the token does not have the permission this needs'
  if (status === 404) return 'not found'
  if (status === 409) return 'conflict'
  if (status === 413) return 'the upload is too large'
  if (status === 422) return 'the request was refused'
  if (status === 429) return 'too many requests, try again in a minute'
  return `HTTP ${status}`
}

function serviceMessage(body: unknown, text: string): string {
  const b = body as { message?: unknown; errors?: Array<{ message?: unknown }>; error?: unknown; error_description?: unknown } | undefined
  const parts: string[] = []
  if (typeof b?.message === 'string') parts.push(b.message)
  if (Array.isArray(b?.errors)) for (const e of b.errors) if (typeof e?.message === 'string') parts.push(e.message)
  if (typeof b?.error === 'string') parts.push(b.error)
  if (typeof b?.error_description === 'string') parts.push(b.error_description)
  if (!parts.length && text && text.length < 200 && !text.trimStart().startsWith('<')) parts.push(text.trim())
  return [...new Set(parts)].join('; ')
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  wasm: 'application/wasm',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8'
}

export function contentType(path: string): string {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  return TYPES[ext] ?? 'application/octet-stream'
}

/** `a/b/` + `c` → `a/b/c`; empty parts dropped, no leading or trailing slash. */
export function joinKey(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .filter((s) => s && s !== '.')
    .join('/')
}

/** A site / project name the hosts accept: lower-case letters, digits and hyphens. */
export function slugify(s: string, max = 58): string {
  const slug = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'dashboard'
}

export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

export function fileCount(files: SiteFiles): number {
  return Object.keys(files).length
}

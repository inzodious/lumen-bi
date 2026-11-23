/**
 * Cloudflare Pages through the Direct Upload API (the protocol `wrangler pages deploy` uses): one Pages project per
 * dashboard (`<project>.pages.dev`), created on first publish. Files are keyed by a BLAKE3 hash of their base64
 * content and extension; only files Cloudflare does not hold yet are uploaded.
 * Settings: account ID. Secret: an API token with Account ▸ Cloudflare Pages ▸ Edit.
 */
import { blake3Hex } from '../blake3'
import { PublishError, b64, contentType, requestJson, requireSecret, requireSetting, type DeployContext, type PublishTarget } from './common'

const API = 'https://api.cloudflare.com/client/v4'
const MAX_FILE = 25 * 1024 * 1024
const MAX_BUCKET_BYTES = 40 * 1024 * 1024
const MAX_BUCKET_FILES = 1000

interface Envelope<T> {
  success: boolean
  result: T
  errors?: Array<{ code?: number; message?: string }>
}

/** Cloudflare's asset key: BLAKE3 of the base64 content followed by the extension, first 32 hex characters. */
export function pagesHash(path: string, bytes: Uint8Array): string {
  const ext = /\.([^./]+)$/.exec(path)?.[1] ?? ''
  return blake3Hex(new TextEncoder().encode(b64(bytes) + ext)).slice(0, 32)
}

async function cf<T>(ctx: DeployContext, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const body = await requestJson<Envelope<T>>(ctx, 'Cloudflare', url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(init.headers ?? {}) } })
  if (body && body.success === false) throw new PublishError(`Cloudflare: ${(body.errors ?? []).map((e) => e.message).filter(Boolean).join('; ') || 'the request failed'}`)
  return body?.result as T
}

async function project(ctx: DeployContext, account: string, token: string, name: string): Promise<{ subdomain?: string } | null> {
  try {
    return await cf<{ subdomain?: string }>(ctx, `${API}/accounts/${account}/pages/projects/${encodeURIComponent(name)}`, token)
  } catch (e) {
    if (e instanceof PublishError && (e.status === 404 || /not found/i.test(e.message))) return null
    throw e
  }
}

export const cloudflarePages: PublishTarget = {
  async test(dest, site, ctx) {
    const account = requireSetting(dest, 'accountId', 'The Cloudflare account ID')
    const token = requireSecret(dest, 'token', 'Cloudflare API token')
    await cf(ctx, `${API}/accounts/${account}/pages/projects?per_page=1`, token)
    if (!site) return 'Signed in. The token can manage Pages projects in this account.'
    const p = await project(ctx, account, token, site)
    return p ? `Signed in. Publishing replaces the Pages project ${site}.` : `Signed in. The Pages project ${site} will be created on first publish.`
  },

  async deploy(dest, site, files, title, ctx) {
    const account = requireSetting(dest, 'accountId', 'The Cloudflare account ID')
    const token = requireSecret(dest, 'token', 'Cloudflare API token')
    for (const [p, b] of Object.entries(files)) if (b.byteLength > MAX_FILE) throw new PublishError(`${p} is larger than the 25 MB Cloudflare Pages allows per file.`)
    ctx.progress({ message: 'Finding the Pages project' })
    let proj = await project(ctx, account, token, site)
    if (!proj) {
      ctx.progress({ message: `Creating the Pages project ${site}` })
      proj = await cf<{ subdomain?: string }>(ctx, `${API}/accounts/${account}/pages/projects`, token, { method: 'POST', body: JSON.stringify({ name: site, production_branch: 'main' }) })
    }
    const jwt = (await cf<{ jwt: string }>(ctx, `${API}/accounts/${account}/pages/projects/${encodeURIComponent(site)}/upload-token`, token)).jwt
    const items = Object.entries(files).map(([path, bytes]) => ({ path, bytes, hash: pagesHash(path, bytes) }))
    const missing = new Set(await cf<string[]>(ctx, `${API}/pages/assets/check-missing`, jwt, { method: 'POST', body: JSON.stringify({ hashes: items.map((i) => i.hash) }) }))
    const todo = items.filter((i) => missing.has(i.hash)).sort((a, b) => b.bytes.byteLength - a.bytes.byteLength)
    const buckets: Array<typeof todo> = []
    const sizes: number[] = []
    for (const it of todo) {
      const size = Math.ceil(it.bytes.byteLength / 3) * 4
      let i = buckets.findIndex((b, k) => sizes[k] + size <= MAX_BUCKET_BYTES && b.length < MAX_BUCKET_FILES)
      if (i < 0) {
        buckets.push([])
        sizes.push(0)
        i = buckets.length - 1
      }
      buckets[i].push(it)
      sizes[i] += size
    }
    for (let k = 0; k < buckets.length; k++) {
      ctx.progress({ message: `Uploading ${todo.length} files`, fraction: k / Math.max(1, buckets.length) })
      await cf(ctx, `${API}/pages/assets/upload`, jwt, {
        method: 'POST',
        body: JSON.stringify(buckets[k].map((i) => ({ key: i.hash, value: b64(i.bytes), metadata: { contentType: contentType(i.path) }, base64: true })))
      })
    }
    await cf(ctx, `${API}/pages/assets/upsert-hashes`, jwt, { method: 'POST', body: JSON.stringify({ hashes: items.map((i) => i.hash) }) }).catch(() => undefined)
    ctx.progress({ message: 'Creating the deployment', fraction: 0.95 })
    const form = new FormData()
    form.set('manifest', JSON.stringify(Object.fromEntries(items.map((i) => [`/${i.path}`, i.hash]))))
    form.set('branch', 'main')
    form.set('commit_message', `Publish ${title}`.slice(0, 380))
    const deployment = await cf<{ url?: string; aliases?: string[] }>(ctx, `${API}/accounts/${account}/pages/projects/${encodeURIComponent(site)}/deployments`, token, { method: 'POST', body: form })
    const url = proj.subdomain ? `https://${proj.subdomain}/` : (deployment.aliases?.find((a) => a.endsWith('.pages.dev')) ?? deployment.url ?? `https://${site}.pages.dev`)
    return { url: url.replace(/\/?$/, '/') }
  }
}

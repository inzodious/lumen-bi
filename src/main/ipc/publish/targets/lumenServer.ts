/**
 * Lumen Server (server/ in this repository): a self-hosted server for published dashboards. Each publish uploads
 * the site as a zip to `PUT /api/dashboards/<slug>`, with the dashboard's access (anyone with the link, or a password).
 * Settings: server URL. Secret: a key from "Sign in with Google" (../lumenConnect.ts), or the server's LUMEN_SERVER_TOKEN.
 */
import { zipSite } from '../site'
import { PublishError, requestJson, requireSecret, requireSetting, type PublishTarget } from './common'

export interface LumenAccess {
  mode: 'public' | 'password' | 'users'
  password?: string
}

/** The server's base address: scheme added when missing, trailing slashes removed. */
export function lumenServerBase(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const u = new URL(withScheme)
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    throw new PublishError(`"${raw}" is not a server address. Use something like http://nas.local:8080.`)
  }
}

export const lumenServer: PublishTarget & {
  deployWithAccess: (...args: [...Parameters<PublishTarget['deploy']>, LumenAccess | undefined]) => ReturnType<PublishTarget['deploy']>
} = {
  async test(dest, site, ctx) {
    const base = lumenServerBase(requireSetting(dest, 'url', 'The server address'))
    const token = requireSecret(dest, 'token', 'server token')
    const health = await requestJson<{ ok?: boolean; name?: string; version?: string }>(ctx, 'Lumen Server', `${base}/api/health`).catch((e: unknown) => {
      throw e instanceof PublishError && e.status === 404 ? new PublishError(`${base} answers, but it is not a Lumen Server.`) : e
    })
    if (health?.name !== 'lumen-server') throw new PublishError(`${base} answers, but it is not a Lumen Server.`)
    const list = await requestJson<Array<{ slug: string }>>(ctx, 'Lumen Server', `${base}/api/dashboards`, { headers: { authorization: `Bearer ${token}` } })
    const exists = site ? list.some((d) => d.slug === site) : false
    const me = await requestJson<{ email?: string | null }>(ctx, 'Lumen Server', `${base}/api/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null)
    return `Connected to Lumen Server ${health.version ?? ''}${me?.email ? ` as ${me.email}` : ''} (${list.length} dashboard${list.length === 1 ? '' : 's'}).${site ? (exists ? ` Publishing replaces ${site}.` : ` ${site} will be created.`) : ''}`
  },

  deploy(dest, site, files, title, ctx) {
    return lumenServer.deployWithAccess(dest, site, files, title, ctx, undefined)
  },

  async deployWithAccess(dest, site, files, _title, ctx, access) {
    const base = lumenServerBase(requireSetting(dest, 'url', 'The server address'))
    const token = requireSecret(dest, 'token', 'server token')
    ctx.progress({ message: `Uploading to ${base}`, fraction: 0.3 })
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/zip' }
    if (access) {
      headers['x-lumen-access'] = access.mode
      if (access.mode === 'password' && access.password) headers['x-lumen-password'] = Buffer.from(access.password, 'utf8').toString('base64')
    }
    const zip = zipSite(files)
    const out = await requestJson<{ url: string }>(ctx, 'Lumen Server', `${base}/api/dashboards/${encodeURIComponent(site)}`, {
      method: 'PUT',
      headers,
      body: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
    })
    return { url: new URL(out.url, `${base}/`).href }
  }
}

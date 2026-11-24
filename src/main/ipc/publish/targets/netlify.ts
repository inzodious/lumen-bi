/**
 * Netlify: one Netlify site per dashboard (the site name is the dashboard's address, `<name>.netlify.app`), created
 * on first publish. Each publish uploads the site as a zip deploy, which replaces the site's previous content.
 * Secret: a personal access token (User settings ▸ Applications).
 */
import { zipSite } from '../site'
import { PublishError, requestJson, requireSecret, type DeployContext, type PublishTarget } from './common'

const API = 'https://api.netlify.com/api/v1'

interface Site {
  id: string
  name: string
  ssl_url?: string
  url?: string
}

function headers(token: string, json = true): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...(json ? { 'content-type': 'application/json' } : {}) }
}

async function findSite(ctx: DeployContext, token: string, name: string): Promise<Site | undefined> {
  const sites = await requestJson<Site[]>(ctx, 'Netlify', `${API}/sites?name=${encodeURIComponent(name)}&filter=all&per_page=100`, { headers: headers(token) })
  return sites.find((s) => s.name === name)
}

export const netlify: PublishTarget = {
  async test(dest, site, ctx) {
    const token = requireSecret(dest, 'token', 'Netlify access token')
    const user = await requestJson<{ email?: string; full_name?: string }>(ctx, 'Netlify', `${API}/user`, { headers: headers(token) })
    const who = user.full_name || user.email || 'your account'
    if (!site) return `Signed in as ${who}.`
    const found = await findSite(ctx, token, site)
    return found ? `Signed in as ${who}. Publishing replaces the site ${found.name}.` : `Signed in as ${who}. The site ${site} will be created on first publish.`
  },

  async deploy(dest, site, files, _title, ctx) {
    const token = requireSecret(dest, 'token', 'Netlify access token')
    ctx.progress({ message: 'Finding the Netlify site' })
    let target = await findSite(ctx, token, site)
    if (!target) {
      ctx.progress({ message: `Creating the Netlify site ${site}` })
      try {
        target = await requestJson<Site>(ctx, 'Netlify', `${API}/sites`, { method: 'POST', headers: headers(token), body: JSON.stringify({ name: site }) })
      } catch (e) {
        if (e instanceof PublishError && e.status === 422) throw new PublishError(`The Netlify site name "${site}" is taken by another account. Choose another site name.`, 422)
        throw e
      }
    }
    ctx.progress({ message: 'Uploading', fraction: 0.2 })
    const zip = zipSite(files)
    let deploy = await requestJson<{ id: string; state: string; error_message?: string }>(ctx, 'Netlify', `${API}/sites/${target.id}/deploys`, {
      method: 'POST',
      headers: { ...headers(token, false), 'content-type': 'application/zip' },
      body: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
    })
    for (let i = 0; i < 60 && deploy.state !== 'ready' && deploy.state !== 'error'; i++) {
      ctx.progress({ message: `Netlify is processing the upload (${deploy.state})`, fraction: 0.8 })
      await ctx.sleep(2000)
      deploy = await requestJson(ctx, 'Netlify', `${API}/deploys/${deploy.id}`, { headers: headers(token) })
    }
    if (deploy.state === 'error') throw new PublishError(`Netlify could not publish the site${deploy.error_message ? `: ${deploy.error_message}` : ''}.`)
    if (deploy.state !== 'ready') ctx.progress({ message: 'Netlify is still processing the upload; the site updates when it finishes.' })
    return { url: (target.ssl_url || target.url || `https://${target.name}.netlify.app`).replace(/\/?$/, '/') }
  }
}

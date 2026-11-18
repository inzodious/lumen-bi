/**
 * OAuth 2.0 for Web.Contents / Firestore credentials:
 *  - authorization code + PKCE (RFC 7636) through the system browser with a loopback redirect
 *    (RFC 8252: http://127.0.0.1:<random port>/callback, the native-app pattern) — no client secret needed,
 *    but one can be sent for providers that require it (Google "Desktop app" clients);
 *  - refresh tokens;
 *  - client credentials (service-to-service).
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { ConnectorError } from './common'

export interface OAuthConfig {
  authUrl?: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scope?: string
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** ms since epoch */
  expiresAt?: number
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

async function tokenRequest(cfg: OAuthConfig, params: Record<string, string>): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: cfg.clientId, ...params })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  let res: Response
  try {
    res = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(60_000) })
  } catch (e) {
    throw new ConnectorError(`The token endpoint ${cfg.tokenUrl} wasn't reachable (${(e as Error).message}).`)
  }
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    // some providers answer form-encoded
    json = Object.fromEntries(new URLSearchParams(text))
  }
  if (!res.ok || typeof json['access_token'] !== 'string') {
    const err = [json['error'], json['error_description']].filter(Boolean).join(': ') || `HTTP ${res.status}`
    throw new ConnectorError(`OAuth sign-in failed (${err}).`, 'credentials')
  }
  const expiresIn = Number(json['expires_in'])
  return {
    accessToken: json['access_token'] as string,
    refreshToken: typeof json['refresh_token'] === 'string' ? (json['refresh_token'] as string) : undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined
  }
}

export function refreshAccessToken(cfg: OAuthConfig, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken, ...(cfg.scope ? { scope: cfg.scope } : {}) }).then((t) => ({ ...t, refreshToken: t.refreshToken ?? refreshToken }))
}

export function clientCredentials(cfg: OAuthConfig): Promise<TokenSet> {
  if (!cfg.clientSecret) throw new ConnectorError('The client credentials grant needs a client secret.', 'credentials')
  return tokenRequest(cfg, { grant_type: 'client_credentials', ...(cfg.scope ? { scope: cfg.scope } : {}) })
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px 'Segoe UI',system-ui,sans-serif;margin:48px;color:#252423"><h2 style="font-weight:600">${title}</h2><p>${text}</p></body>`

/**
 * Authorization code + PKCE: opens the provider's sign-in page in the system browser and waits (up to
 * 5 minutes) for the redirect to a one-shot loopback server.
 */
export async function authorizationCodeFlow(cfg: OAuthConfig, openExternal: (url: string) => Promise<void> | void, opts: { timeoutMs?: number; extraParams?: Record<string, string> } = {}): Promise<TokenSet> {
  if (!cfg.authUrl) throw new ConnectorError('The OAuth authorization URL is missing.', 'credentials')
  const { verifier, challenge } = pkcePair()
  const state = b64url(randomBytes(16))
  let server: Server | undefined
  try {
    const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ConnectorError('Sign-in timed out (no answer from the browser within 5 minutes).', 'credentials')), opts.timeoutMs ?? 5 * 60_000)
      let redirect = ''
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const err = url.searchParams.get('error')
        const got = url.searchParams.get('code')
        if (url.searchParams.get('state') !== state || (!got && !err)) {
          res.writeHead(400, { 'content-type': 'text/html' }).end(PAGE('Sign-in failed', 'The response did not match the request. Close this window and try again.'))
          return
        }
        clearTimeout(timer)
        if (err) {
          res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('Sign-in cancelled', 'You can close this window and return to Lumen.'))
          reject(new ConnectorError(`Sign-in was refused (${err}${url.searchParams.get('error_description') ? `: ${url.searchParams.get('error_description')}` : ''}).`, 'credentials'))
          return
        }
        res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('Signed in', 'You can close this window and return to Lumen.'))
        resolve({ code: got!, redirect })
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as { port: number }).port
        redirect = `http://127.0.0.1:${port}/callback`
        const u = new URL(cfg.authUrl!)
        u.searchParams.set('response_type', 'code')
        u.searchParams.set('client_id', cfg.clientId)
        u.searchParams.set('redirect_uri', redirect)
        if (cfg.scope) u.searchParams.set('scope', cfg.scope)
        u.searchParams.set('state', state)
        u.searchParams.set('code_challenge', challenge)
        u.searchParams.set('code_challenge_method', 'S256')
        // Google only issues a refresh token with offline access + consent
        if (/accounts\.google\.com/.test(u.host)) {
          u.searchParams.set('access_type', 'offline')
          u.searchParams.set('prompt', 'consent')
        }
        for (const [k, v] of Object.entries(opts.extraParams ?? {})) u.searchParams.set(k, v)
        Promise.resolve(openExternal(u.toString())).catch(reject)
      })
    })
    return await tokenRequest(cfg, { grant_type: 'authorization_code', code: code.code, redirect_uri: code.redirect, code_verifier: verifier })
  } finally {
    server?.close()
  }
}

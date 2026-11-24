/**
 * "Sign in with Google" for a Lumen Server destination: Lumen listens once on a loopback port, opens the server's
 * /connect page in the browser, and the server (after Google sign-in and a confirmation) sends the browser back to
 * that port with a publishing key. The key never passes through anything but this computer and the server.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import type { AddressInfo } from 'node:net'
import { PublishError } from './targets/common'
import { lumenServerBase } from './targets/lumenServer'

export interface LumenConnectResult {
  key: string
  email: string
}

const DONE_PAGE = (ok: boolean, text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Lumen</title></head><body style="font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f3f2f1;color:#252423"><div style="text-align:center"><div style="font-size:20px;font-weight:600;margin-bottom:8px">${ok ? 'Lumen is connected' : 'Lumen was not connected'}</div><div>${text}</div></div></body></html>`

export async function connectLumenServer(rawUrl: string, openExternal: (url: string) => Promise<void> | void, opts: { fetch?: typeof fetch; timeoutMs?: number; computerName?: string } = {}): Promise<LumenConnectResult> {
  const base = lumenServerBase(rawUrl)
  const doFetch = opts.fetch ?? fetch
  let health: { name?: string; signIn?: string } = {}
  try {
    health = (await (await doFetch(`${base}/api/health`)).json()) as typeof health
  } catch {
    throw new PublishError(`Lumen could not reach ${base}. Check the address.`)
  }
  if (health.name !== 'lumen-server') throw new PublishError(`${base} answers, but it is not a Lumen Server.`)
  if (health.signIn !== 'google') throw new PublishError('This server does not have Google sign-in set up. Paste its server token instead.')

  const state = randomBytes(16).toString('base64url')
  return new Promise<LumenConnectResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (u.pathname !== '/lumen-callback') {
        res.writeHead(404).end()
        return
      }
      const key = u.searchParams.get('key') ?? ''
      const email = u.searchParams.get('email') ?? ''
      if (u.searchParams.get('state') !== state || !key.startsWith('lsk_')) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE(false, 'Start the sign-in again from Lumen.'))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE(true, `Signed in as ${email.replace(/[<>&"]/g, '')}. You can close this tab and go back to Lumen.`))
      finish(() => resolve({ key, email }))
    })
    const finish = (fn: () => void) => {
      clearTimeout(timer)
      server.close()
      fn()
    }
    server.on('error', (e) => finish(() => reject(e)))
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const q = new URLSearchParams({ callback: `http://127.0.0.1:${port}/lumen-callback`, state, name: (opts.computerName ?? hostname()).slice(0, 80) })
      timer = setTimeout(() => finish(() => reject(new PublishError('The sign-in was not finished within 5 minutes.'))), opts.timeoutMs ?? 5 * 60 * 1000)
      Promise.resolve(openExternal(`${base}/connect?${q}`)).catch((e) => finish(() => reject(e)))
    })
  })
}

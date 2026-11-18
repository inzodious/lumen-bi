/**
 * Code visual frames (main process side).
 *
 * The author's code of a code visual runs in an `<iframe sandbox="allow-scripts">` (opaque origin: no access to the
 * app's DOM, storage, the preload bridge or Node). Its document and scripts come from the privileged `lumen-frame:`
 * scheme registered here, because a sandboxed frame may not load `file:` resources; every response carries a strict
 * Content-Security-Policy: no network of any kind (connect / img / font / media / frame / form / worker), scripts only
 * from this scheme plus `unsafe-eval` for the author's transpiled JSX, inline styles only.
 *
 * Frames with author JavaScript (JSX) are served from a host of their own (`lumen-frame://jsx-<id>/`), which Chromium's
 * site isolation puts in a separate renderer process: a runaway script freezes only that frame, and removing the frame
 * ends the process.
 *
 * `guardFrameNavigation` additionally cancels any navigation of a sub-frame away from `lumen-frame:` / `about:` /
 * `blob:` / `data:` (a frame navigating itself to a URL would otherwise reach the network).
 */
import { protocol, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

export const CODE_FRAME_SCHEME = 'lumen-frame'

export const CODE_FRAME_CSP = [
  "default-src 'none'",
  `script-src ${CODE_FRAME_SCHEME}: 'unsafe-eval'`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  `font-src ${CODE_FRAME_SCHEME}: data:`,
  "connect-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "manifest-src 'none'"
].join('; ')

const FILES: Record<string, string> = {
  '/frame.html': 'text/html; charset=utf-8',
  '/frame.js': 'text/javascript; charset=utf-8',
  '/react.js': 'text/javascript; charset=utf-8'
}
const FONT = /^\/fonts\/[a-z-]+\.woff2$/

/** Call before `app.whenReady()`. */
export function registerCodeFrameScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: CODE_FRAME_SCHEME, privileges: { standard: true, secure: true } }])
}

/** Call after `app.whenReady()`. `rendererDir` is the built renderer folder (holds `codeframe/`). */
export function handleCodeFrameScheme(rendererDir: string): void {
  const base = normalize(join(rendererDir, 'codeframe'))
  const cache = new Map<string, Buffer>()
  protocol.handle(CODE_FRAME_SCHEME, async (req) => {
    const url = new URL(req.url)
    // `code` hosts the frames of template-only visuals; `jsx-<id>` one frame with author JavaScript each, so it gets a
    // renderer process of its own (a different site) and a runaway script there blocks nothing else
    const hostOk = url.host === 'code' || /^jsx-[a-z0-9]{6,32}$/.test(url.host)
    const type = !hostOk ? undefined : FONT.test(url.pathname) ? 'font/woff2' : FILES[url.pathname]
    if (!type || req.method !== 'GET') return new Response('Not found', { status: 404, headers: { 'content-security-policy': CODE_FRAME_CSP } })
    let body = cache.get(url.pathname)
    if (!body) {
      try {
        body = await readFile(join(base, url.pathname.slice(1)))
      } catch {
        return new Response('Not found', { status: 404, headers: { 'content-security-policy': CODE_FRAME_CSP } })
      }
      // dev builds rewrite the files; only cache packaged ones
      if (!process.env['ELECTRON_RENDERER_URL']) cache.set(url.pathname, body)
    }
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': type,
        'content-security-policy': CODE_FRAME_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': type === 'font/woff2' ? 'public, max-age=31536000, immutable' : 'no-store',
        'cross-origin-resource-policy': 'cross-origin',
        // fonts load in CORS mode from the frame's opaque origin
        ...(type === 'font/woff2' ? { 'access-control-allow-origin': '*' } : {})
      }
    })
  })
}

const FRAME_OK = /^(lumen-frame:|about:|blob:|data:)/i

/** Cancel navigations of sub-frames to anything but the code-frame scheme and local documents. */
export function guardFrameNavigation(wc: WebContents): void {
  wc.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return
    if (!FRAME_OK.test(e.url)) e.preventDefault()
  })
}

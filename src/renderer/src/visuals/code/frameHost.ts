/**
 * Code visual: one sandboxed frame and its message channel (host side of core/codevisual/protocol.ts).
 *
 *  - `<iframe sandbox="allow-scripts" src="lumen-frame://code/frame.html">`: an opaque origin (no app DOM, storage,
 *    cookies, preload bridge or Node), a document served by the main process with a no-network CSP (src/main/codeFrame.ts).
 *  - Messages count only from the frame's own window with origin "null", carrying this instance's random token and a
 *    strictly increasing counter (core ReplayGuard); everything else is ignored.
 *  - A watchdog pings the frame; when a render or a ping gets no answer in time (a runaway script), the frame is torn
 *    down and the visual shows an error with "Run again". Frames run in their own renderer process (cross-site frame),
 *    so a loop inside one does not block the report canvas.
 */
import { PROTOCOL, ReplayGuard, newToken, validateFrameEnvelope, type FrameMessage, type HostMessage, type RenderMessage } from '@core/codevisual/protocol'

export const FRAME_URL = 'lumen-frame://code/frame.html'

/**
 * Frames that run author JavaScript get a host of their own (`jsx-<random>`): a separate site, so Chromium gives them a
 * separate renderer process and a runaway script there cannot stall other code visuals (src/main/codeFrame.ts).
 */
export function frameUrl(isolated: boolean): string {
  if (!isolated) return FRAME_URL
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return `lumen-frame://jsx-${Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16)}/frame.html`
}
/** a render must answer within this time (ms), a ping within PING_TIMEOUT */
export const RENDER_TIMEOUT = 8000
const PING_EVERY = 4000
const PING_TIMEOUT = 4000

export interface FrameHandlers {
  message(msg: FrameMessage): void
  /** the frame stopped answering (runaway script) and was removed */
  timeout(): void
}

const hosts = new Map<Window, CodeFrameHost>()
let listening = false

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('message', (ev) => {
    const src = ev.source as Window | null
    if (!src) return
    const host = hosts.get(src)
    if (!host) return
    // sandboxed without allow-same-origin: the frame's origin is opaque
    if (ev.origin !== 'null') return
    host.receive(ev.data)
  })
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export class CodeFrameHost {
  readonly iframe: HTMLIFrameElement
  readonly token = newToken(randomBytes)
  private guard = new ReplayGuard()
  private booted = false
  private queued: Omit<RenderMessage, 'p' | 'token'> | null = null
  private renderTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined
  private pongTimer: ReturnType<typeof setTimeout> | undefined
  private pingId = 0
  private dead = false
  private win: Window | null = null

  constructor(
    parent: HTMLElement,
    title: string,
    private handlers: FrameHandlers,
    isolated = false
  ) {
    listen()
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts')
    f.setAttribute('referrerpolicy', 'no-referrer')
    f.setAttribute('allow', '')
    f.setAttribute('loading', 'eager')
    f.title = title
    f.className = 'wbi-codevisual__frame'
    f.src = frameUrl(isolated)
    this.iframe = f
    parent.appendChild(f)
    this.win = f.contentWindow
    if (this.win) hosts.set(this.win, this)
    this.pingTimer = setInterval(() => this.ping(), PING_EVERY)
  }

  /** Message from the frame window (already matched by source and origin). */
  receive(raw: unknown): void {
    if (this.dead) return
    const v = validateFrameEnvelope(raw)
    if (!v) return
    if (v.boot) {
      if (this.booted) return
      this.booted = true
      if (this.queued) this.send(this.queued)
      return
    }
    if (!this.booted || v.token !== this.token || !this.guard.accept(v.n)) return
    const m = v.msg
    if (m.type === 'rendered' || m.type === 'error') clearTimeout(this.renderTimer)
    if (m.type === 'pong') {
      clearTimeout(this.pongTimer)
      return
    }
    this.handlers.message(m)
  }

  render(msg: Omit<RenderMessage, 'p' | 'token' | 'type'>): void {
    if (this.dead) return
    const full = { ...msg, type: 'render' as const }
    this.queued = full
    if (this.booted) this.send(full)
    clearTimeout(this.renderTimer)
    this.renderTimer = setTimeout(() => this.kill(), RENDER_TIMEOUT)
  }

  post(msg: Omit<Extract<HostMessage, { type: 'pointer' }>, 'p' | 'token'>): void {
    if (this.dead || !this.booted) return
    this.win?.postMessage({ ...msg, p: PROTOCOL, token: this.token }, '*')
  }

  private send(msg: Omit<RenderMessage, 'p' | 'token'>): void {
    // structured clone (no transfer): the frame gets a copy, never a reference into the app
    this.win?.postMessage({ ...msg, p: PROTOCOL, token: this.token }, '*')
  }

  private ping(): void {
    if (this.dead || !this.booted) return
    const id = ++this.pingId
    this.win?.postMessage({ p: PROTOCOL, token: this.token, type: 'ping', id }, '*')
    clearTimeout(this.pongTimer)
    this.pongTimer = setTimeout(() => this.kill(), PING_TIMEOUT)
  }

  private kill(): void {
    if (this.dead) return
    this.destroy()
    this.handlers.timeout()
  }

  get alive(): boolean {
    return !this.dead
  }

  destroy(): void {
    this.dead = true
    clearTimeout(this.renderTimer)
    clearTimeout(this.pongTimer)
    clearInterval(this.pingTimer)
    if (this.win) hosts.delete(this.win)
    this.win = null
    // removing the element ends its browsing context (and stops a runaway script there)
    this.iframe.src = 'about:blank'
    this.iframe.remove()
  }
}

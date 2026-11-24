/**
 * Code visual: the postMessage protocol between the host (the report canvas) and the sandboxed frame that runs the
 * author's code. Both sides validate every message with the functions below and ignore anything else.
 *
 * Host → frame (`HostMessage`): `render` (code + data), `pointer` (edit-mode clicks and moves forwarded from the
 * canvas overlay), `ping` (watchdog).
 * Frame → host (`FrameMessage`): `boot` (the runtime loaded), `rendered`, `error`, `select`, `clear`, `tooltip`,
 * `menu` (context menu), `drill`, `drillUp`, `expand`, `nextLevel`, `pong`.
 *
 * Trust rules (enforced by the host, renderer/src/visuals/code/frameHost.ts):
 *  - a message counts only when `event.source` is the visual's own frame window and `event.origin` is "null" (the
 *    frame has an opaque origin: sandbox without allow-same-origin);
 *  - after `boot`, every message must carry the per-frame random `token` the host sent in `render`, and a strictly
 *    increasing `n` (replayed or reordered messages are dropped);
 *  - the payload must match the shape below, within the size limits; row references are keys the host issued.
 * The frame accepts only messages whose `event.source` is its parent and that pass `validateHostMessage`.
 */
import type { CodeData, ThemeInfo } from './types'

export const PROTOCOL = 'lumen-code-visual/1'

/** limits for frame → host messages */
export const MAX_FRAME_MESSAGE_CHARS = 64 * 1024
export const MAX_KEYS = 5000
const MAX_TEXT = 4000
const MAX_TOOLTIP_ITEMS = 40

export type ErrorPhase = 'template' | 'css' | 'transpile' | 'runtime' | 'promise' | 'data' | 'timeout'

export interface RenderMessage {
  p: typeof PROTOCOL
  type: 'render'
  token: string
  seq: number
  /** 'html' = template output only; 'jsx' = run `code` (CommonJS from the transpiler), with `html` available as a prop */
  mode: 'html' | 'jsx'
  html: string
  css: string
  code?: string
  vars: Record<string, string>
  /** per-row CSS variables (style text), parallel to data.rows */
  rowStyles: string[]
  data: CodeData
  theme: ThemeInfo
  /** registered report images referenced by the code, as data: URIs */
  resources: Record<string, string>
  /** root state attributes */
  state: { level: number; hasHighlight: boolean; hasSelection: boolean; editing: boolean; overflow: 'hidden' | 'visible' | 'auto'; rowTooltips: boolean }
}

export interface PointerMessage {
  p: typeof PROTOCOL
  type: 'pointer'
  token: string
  kind: 'click' | 'move' | 'leave' | 'menu' | 'wheel' | 'dblclick'
  x: number
  y: number
  ctrl: boolean
  shift: boolean
  dx?: number
  dy?: number
}

export interface PingMessage {
  p: typeof PROTOCOL
  type: 'ping'
  token: string
  id: number
}

export type HostMessage = RenderMessage | PointerMessage | PingMessage

export interface TooltipLine {
  label: string
  value: string
}

export type FrameMessage =
  | { type: 'boot' }
  | { type: 'rendered'; seq: number; height?: number }
  | { type: 'error'; seq: number; phase: ErrorPhase; message: string; line?: number; column?: number }
  | { type: 'select'; keys: string[]; multi: boolean }
  | { type: 'clear' }
  | { type: 'tooltip'; key?: string; items?: TooltipLine[]; x: number; y: number }
  | { type: 'tooltipHide' }
  | { type: 'menu'; key?: string; x: number; y: number }
  | { type: 'drill'; key: string }
  | { type: 'drillUp' }
  | { type: 'expand' }
  | { type: 'nextLevel' }
  | { type: 'pong'; id: number }

/** Envelope of every frame → host message after boot. */
export interface FrameEnvelope {
  p: typeof PROTOCOL
  token: string
  n: number
  msg: FrameMessage
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCoord = (v: unknown): v is number => isNum(v) && Math.abs(v) < 1e6
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 2 ** 52
const PHASES = new Set<ErrorPhase>(['template', 'css', 'transpile', 'runtime', 'promise', 'data', 'timeout'])

function approxSize(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0
  } catch {
    return Infinity
  }
}

/**
 * Validate a frame → host envelope. Returns the inner message, or null. `boot` is the only message accepted without
 * an envelope (the frame does not know its token yet).
 */
export function validateFrameEnvelope(raw: unknown): { boot: true } | { boot: false; token: string; n: number; msg: FrameMessage } | null {
  if (!isObj(raw) || raw.p !== PROTOCOL) return null
  if (approxSize(raw) > MAX_FRAME_MESSAGE_CHARS) return null
  if (raw.type === 'boot' && Object.keys(raw).length === 2) return { boot: true }
  if (!isStr(raw.token, 64) || !isInt(raw.n)) return null
  const msg = validateFrameMessage(raw.msg)
  return msg ? { boot: false, token: raw.token, n: raw.n, msg } : null
}

export function validateFrameMessage(m: unknown): FrameMessage | null {
  if (!isObj(m) || typeof m.type !== 'string') return null
  switch (m.type) {
    case 'rendered':
      return isInt(m.seq) && (m.height === undefined || isCoord(m.height)) ? { type: 'rendered', seq: m.seq, ...(m.height !== undefined ? { height: m.height as number } : {}) } : null
    case 'error': {
      if (!isInt(m.seq) || !PHASES.has(m.phase as ErrorPhase) || typeof m.message !== 'string') return null
      const out: FrameMessage = { type: 'error', seq: m.seq, phase: m.phase as ErrorPhase, message: m.message.slice(0, MAX_TEXT) }
      if (isInt(m.line) && m.line > 0) out.line = m.line
      if (isInt(m.column) && m.column > 0) out.column = m.column
      return out
    }
    case 'select':
      if (!Array.isArray(m.keys) || m.keys.length > MAX_KEYS || !m.keys.every((k) => isStr(k, 2000)) || typeof m.multi !== 'boolean') return null
      return { type: 'select', keys: [...m.keys] as string[], multi: m.multi }
    case 'clear':
    case 'drillUp':
    case 'expand':
    case 'nextLevel':
    case 'tooltipHide':
      return { type: m.type }
    case 'tooltip': {
      if (!isCoord(m.x) || !isCoord(m.y)) return null
      if (m.key !== undefined && !isStr(m.key, 2000)) return null
      let items: TooltipLine[] | undefined
      if (m.items !== undefined) {
        if (!Array.isArray(m.items) || m.items.length > MAX_TOOLTIP_ITEMS) return null
        if (!m.items.every((i) => isObj(i) && isStr(i.label, 500) && isStr(i.value, 500))) return null
        items = (m.items as TooltipLine[]).map((i) => ({ label: i.label, value: i.value }))
      }
      if (m.key === undefined && !items) return null
      return { type: 'tooltip', x: m.x, y: m.y, ...(m.key !== undefined ? { key: m.key as string } : {}), ...(items ? { items } : {}) }
    }
    case 'menu':
      if (!isCoord(m.x) || !isCoord(m.y) || (m.key !== undefined && !isStr(m.key, 2000))) return null
      return { type: 'menu', x: m.x, y: m.y, ...(m.key !== undefined ? { key: m.key as string } : {}) }
    case 'drill':
      return isStr(m.key, 2000) ? { type: 'drill', key: m.key } : null
    case 'pong':
      return isInt(m.id) ? { type: 'pong', id: m.id } : null
    default:
      return null
  }
}

/** Validate a host → frame message (run in the frame). */
export function validateHostMessage(m: unknown): HostMessage | null {
  if (!isObj(m) || m.p !== PROTOCOL || !isStr(m.token, 64)) return null
  switch (m.type) {
    case 'render':
      if (!isInt(m.seq) || (m.mode !== 'html' && m.mode !== 'jsx') || typeof m.html !== 'string' || typeof m.css !== 'string') return null
      if (m.code !== undefined && typeof m.code !== 'string') return null
      if (!isObj(m.vars) || !Array.isArray(m.rowStyles) || !isObj(m.data) || !isObj(m.theme) || !isObj(m.resources) || !isObj(m.state)) return null
      if (!Object.values(m.vars).every((v) => typeof v === 'string')) return null
      if (!Object.keys(m.vars).every((k) => /^--[a-z0-9-]+$/.test(k))) return null
      if (!Array.isArray((m.data as Record<string, unknown>).rows) || !Array.isArray((m.data as Record<string, unknown>).columns)) return null
      return m as unknown as RenderMessage
    case 'pointer':
      if (!['click', 'move', 'leave', 'menu', 'wheel', 'dblclick'].includes(m.kind as string) || !isCoord(m.x) || !isCoord(m.y)) return null
      return m as unknown as PointerMessage
    case 'ping':
      return isInt(m.id) ? (m as unknown as PingMessage) : null
    default:
      return null
  }
}

/** Monotonic-sequence guard: accepts each `n` once, in increasing order. */
export class ReplayGuard {
  private last = -1
  accept(n: number): boolean {
    if (n <= this.last) return false
    this.last = n
    return true
  }
}

/** A random token (hex) for one frame instance. */
export function newToken(random: (n: number) => Uint8Array): string {
  return Array.from(random(16), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Visual animations (Lumen extension of Power BI's load / filter animations), driven from the DOM a visual renders.
 *
 * One `VisualAnimator` watches a visual container's content with a MutationObserver. It acts only while armed:
 *  - `enter` (the visual appeared: page load, page change, new visual): marks that the renderer added play their entrance
 *    (bars grow from the axis, lines and areas reveal left to right, slices sweep, points pop, values count up), or the
 *    whole content fades / rises / zooms in for visuals without marks or with an explicit entrance;
 *  - `update` (filters, cross-highlights, fields or data changed): marks whose geometry changed morph from the old
 *    geometry to the new one (MutationObserver `attributeOldValue`), new marks enter, values count from the old number.
 * Unarmed mutations (formatting edits, resizing, hover) never animate.
 *
 * Renderers opt in by tagging data marks with `data-wbi-mark` (visuals/common/motionMarks.ts). The animations use the
 * Web Animations API only: no attribute or style is left behind, so the DOM after an animation is exactly what the
 * visual rendered, and a cancelled animation simply shows the final state. Count-up is the one exception: it rewrites a
 * text node's characters while it runs and always ends on the visual's own text.
 */
import type { VisualEntrance } from '@core/report/motion'
import { countFrom, easeOut, formatCountText, parseCountText } from './countText'

export const MOTION_ANIMATION_ID = 'wbi-motion'
export const EASING = 'cubic-bezier(0.22, 0.8, 0.3, 1)'

const GEOMETRY = ['x', 'y', 'width', 'height', 'd', 'cx', 'cy', 'r']
const MAX_MARKS = 1500
const SETTLE_MS = 350

export type MarkKind = 'grow-up' | 'grow-down' | 'grow-left' | 'grow-right' | 'grow-center' | 'reveal' | 'label' | 'sweep' | 'pop' | 'count' | 'fade'

export interface AnimatorOptions {
  duration: number
  /** 'marks': the renderer tags marks; 'fade': no marks, the content fades in */
  family: 'marks' | 'fade'
  entrance: Exclude<VisualEntrance, 'none'>
  /** ms before the entrance starts */
  delay: number
}

interface Tween {
  node: Text
  raf: number
  shown: string
}

export class VisualAnimator {
  private mo: MutationObserver
  private mode: 'idle' | 'enter' | 'update' = 'idle'
  private until = 0
  private pausedUntil = 0
  private entered = false
  private tweens = new Map<Text, Tween>()
  private disposed = false
  private observing = false

  constructor(
    private root: HTMLElement,
    private opts: AnimatorOptions
  ) {
    this.mo = new MutationObserver((records) => this.onRecords(records))
    this.observe()
  }

  setOptions(opts: AnimatorOptions): void {
    this.opts = opts
    if (opts.family === 'marks') this.observe()
  }

  private observe(): void {
    if (this.observing || this.disposed) return
    this.observing = true
    this.mo.observe(this.root, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: GEOMETRY, characterData: true, characterDataOldValue: true })
  }

  /** Visuals without marks never morph: once they have entered, stop watching (large tables mutate a lot). */
  private unobserve(): void {
    if (!this.observing) return
    this.observing = false
    this.mo.disconnect()
  }

  /** Animate what the visual renders next: `enter` once per mount, `update` after a data change. */
  arm(kind: 'enter' | 'update', windowMs = 2500): void {
    if (this.disposed) return
    if (kind === 'enter' && this.entered) return
    this.mode = kind
    this.until = now() + windowMs
    if (kind === 'enter' && this.root.childElementCount > 0) this.enterExisting()
  }

  /** Play the entrance again (Format pane ▸ Animation ▸ Preview). */
  replay(): void {
    this.entered = false
    this.arm('enter')
  }

  /** Drop pending changes and ignore new ones for `ms` (resizing, layout edits). */
  pause(ms = 300): void {
    this.mo.takeRecords()
    this.pausedUntil = now() + ms
  }

  dispose(): void {
    this.disposed = true
    this.mo.disconnect()
    for (const t of this.tweens.values()) cancelAnimationFrame(t.raf)
    this.tweens.clear()
  }

  // ---------------------------------------------------------------------------------------------

  private onRecords(records: MutationRecord[]): void {
    if (this.disposed || this.mode === 'idle') return
    const t = now()
    if (t > this.until) {
      this.mode = 'idle'
      return
    }
    if (t < this.pausedUntil) return
    // keep listening a little longer: charts often render twice (measure, then lay out)
    this.until = Math.max(this.until, t + SETTLE_MS)
    if (this.mode === 'enter') this.enterFrom(records)
    else this.updateFrom(records)
  }

  private enterExisting(): void {
    if (this.opts.family === 'fade' || this.opts.entrance !== 'auto') {
      this.entered = true
      this.animateRoot()
      return
    }
    this.enterMarks([...this.root.querySelectorAll<Element>('[data-wbi-mark]')])
  }

  private enterFrom(records: MutationRecord[]): void {
    if (this.opts.family === 'fade' || this.opts.entrance !== 'auto') {
      if (!this.entered && records.some((r) => r.type === 'childList' && r.addedNodes.length)) {
        this.entered = true
        this.animateRoot()
      }
      return
    }
    const added: Element[] = []
    const counts: Array<{ node: Text; from: string | null }> = []
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n instanceof Element) {
            if (n.hasAttribute('data-wbi-mark')) added.push(n)
            added.push(...n.querySelectorAll('[data-wbi-mark]'))
          } else if (n instanceof Text && markOf(n.parentElement) === 'count') counts.push({ node: n, from: null })
        }
      } else if (r.type === 'characterData' && r.target instanceof Text && markOf(r.target.parentElement) === 'count') counts.push({ node: r.target, from: null })
    }
    if (added.length || counts.length) this.entered = true
    this.enterMarks(added)
    for (const c of counts) this.count(c.node, c.from, this.opts.delay)
  }

  private enterMarks(marks: Element[]): void {
    if (!marks.length) return
    this.entered = true
    const list = marks.length > MAX_MARKS ? [] : marks
    if (!list.length) {
      this.animateRoot('fade')
      return
    }
    const d = this.opts.duration
    const spread = Math.min(d * 0.4, 400)
    const byKind = new Map<string, Element[]>()
    for (const el of list) {
      const k = markOf(el) ?? 'fade'
      byKind.set(k, [...(byKind.get(k) ?? []), el])
    }
    for (const [kind, els] of byKind) {
      const step = els.length > 1 ? spread / (els.length - 1) : 0
      els.forEach((el, i) => {
        const delay = this.opts.delay + (kind === 'reveal' || kind === 'count' || kind === 'label' ? 0 : i * step)
        if (kind === 'count') {
          const text = textChild(el)
          if (text) this.count(text, null, delay)
        } else enterMark(el, kind as MarkKind, d, delay)
      })
    }
  }

  private updateFrom(records: MutationRecord[]): void {
    const old = new Map<Element, Map<string, string | null>>()
    const added: Element[] = []
    for (const r of records) {
      if (r.type === 'attributes' && r.target instanceof Element && r.attributeName) {
        if (!markOf(r.target)) continue
        let m = old.get(r.target)
        if (!m) old.set(r.target, (m = new Map()))
        if (!m.has(r.attributeName)) m.set(r.attributeName, r.oldValue)
      } else if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n instanceof Element) {
            if (n.hasAttribute('data-wbi-mark')) added.push(n)
            added.push(...n.querySelectorAll('[data-wbi-mark]'))
          } else if (n instanceof Text && markOf(n.parentElement) === 'count') {
            const removed = [...r.removedNodes].find((x) => x instanceof Text) as Text | undefined
            this.count(n, removed?.data ?? null, 0)
          }
        }
      } else if (r.type === 'characterData' && r.target instanceof Text && markOf(r.target.parentElement) === 'count') {
        const tw = this.tweens.get(r.target)
        this.count(r.target, tw ? tw.shown : r.oldValue, 0)
      }
    }
    if (old.size + added.length > MAX_MARKS) return
    for (const [el, attrs] of old) morph(el, attrs, this.opts.duration)
    const fresh = added.filter((el) => el.isConnected && markOf(el) !== 'count')
    const d = this.opts.duration
    for (const el of fresh) enterMark(el, markOf(el) as MarkKind, d, 0)
    for (const el of added) if (markOf(el) === 'count') {
      const t = textChild(el)
      if (t) this.count(t, null, 0)
    }
  }

  private animateRoot(kind: VisualEntrance = this.opts.entrance): void {
    const k = kind === 'auto' ? 'fade' : kind
    const frames: Keyframe[] =
      k === 'rise'
        ? [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }]
        : k === 'zoom'
          ? [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }]
          : [{ opacity: 0 }, { opacity: 1 }]
    play(this.root, frames, this.opts.duration, this.opts.delay)
    if (this.opts.family === 'fade') this.unobserve()
    for (const el of this.root.querySelectorAll('[data-wbi-mark="count"]')) {
      const t = textChild(el)
      if (t) this.count(t, null, this.opts.delay)
    }
  }

  /** Count a text node up from `from` (its old text) to its current text. */
  private count(node: Text, from: string | null, delay: number): void {
    const prev = this.tweens.get(node)
    if (prev) {
      cancelAnimationFrame(prev.raf)
      this.tweens.delete(node)
    }
    const final = node.data
    const shape = parseCountText(final)
    if (!shape) return
    const start = countFrom(from, shape)
    if (start === shape.value) return
    // "2,454 TB" → "655 TB": frames above 999 keep the old text's thousands separator
    const old = from ? parseCountText(from) : null
    const print = old?.grouped && !shape.grouped ? { ...shape, grouped: true, group: old.group } : shape
    const d = this.opts.duration
    const t0 = now() + delay
    const tw: Tween = { node, raf: 0, shown: final }
    const write = (text: string) => {
      if (node.data === text) return
      node.data = text
      tw.shown = text
      this.mo.takeRecords()
    }
    const frame = () => {
      if (this.disposed || !node.isConnected) return void this.tweens.delete(node)
      const p = (now() - t0) / d
      if (p >= 1) {
        write(final)
        this.tweens.delete(node)
        return
      }
      write(formatCountText(print, start + (shape.value - start) * easeOut(Math.max(0, p))))
      tw.raf = requestAnimationFrame(frame)
    }
    write(formatCountText(print, start))
    this.tweens.set(node, tw)
    tw.raf = requestAnimationFrame(frame)
  }
}

// ---------------------------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------------------------

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function markOf(el: Element | null | undefined): string | null {
  return el?.getAttribute?.('data-wbi-mark') ?? null
}

function textChild(el: Element): Text | null {
  for (const n of el.childNodes) if (n instanceof Text && n.data.trim()) return n
  return null
}

function play(el: Element, frames: Keyframe[], duration: number, delay: number): Animation | null {
  try {
    const a = el.animate(frames, { duration, delay, easing: EASING, fill: 'backwards' })
    a.id = MOTION_ANIMATION_ID
    return a
  } catch {
    return null
  }
}

function running(el: Element): Animation[] {
  return el.getAnimations().filter((a) => a.id === MOTION_ANIMATION_ID)
}

/** The entrance of one mark. */
export function enterMark(el: Element, kind: MarkKind, duration: number, delay: number): void {
  for (const a of running(el)) a.cancel()
  const hasTransform = el.hasAttribute('transform')
  const box = { transformBox: 'fill-box' } as Keyframe
  switch (kind) {
    case 'grow-up':
    case 'grow-down':
    case 'grow-left':
    case 'grow-right':
    case 'grow-center': {
      if (hasTransform) return void play(el, [{ opacity: 0 }, { opacity: 1 }], duration, delay)
      const vertical = kind === 'grow-up' || kind === 'grow-down'
      const origin = kind === 'grow-up' ? '50% 100%' : kind === 'grow-down' ? '50% 0%' : kind === 'grow-right' ? '0% 50%' : kind === 'grow-left' ? '100% 50%' : '50% 50%'
      const from = vertical ? 'scaleY(0)' : 'scaleX(0)'
      play(el, [{ ...box, transformOrigin: origin, transform: from }, { ...box, transformOrigin: origin, transform: 'none' }], duration, delay)
      return
    }
    case 'label':
      play(el, [{ opacity: 0 }, { opacity: 1 }], duration * 0.5, delay + duration * 0.6)
      return
    case 'reveal':
      play(el, [{ clipPath: 'inset(-50% 100% -50% -1%)' }, { clipPath: 'inset(-50% -1% -50% -1%)' }], duration * 1.2, delay)
      return
    case 'sweep': {
      if (hasTransform) return void play(el, [{ opacity: 0 }, { opacity: 1 }], duration, delay)
      const cx = Number(el.getAttribute('data-wbi-cx'))
      const cy = Number(el.getAttribute('data-wbi-cy'))
      let origin = '50% 50%'
      if (Number.isFinite(cx) && Number.isFinite(cy) && 'getBBox' in el) {
        try {
          const bb = (el as SVGGraphicsElement).getBBox()
          origin = `${cx - bb.x}px ${cy - bb.y}px`
        } catch {
          /* not rendered */
        }
      }
      play(el, [{ ...box, transformOrigin: origin, transform: 'rotate(-60deg) scale(0.55)', opacity: 0 }, { ...box, transformOrigin: origin, transform: 'none', opacity: 1 }], duration * 1.1, delay)
      return
    }
    case 'pop':
      if (hasTransform) return void play(el, [{ opacity: 0 }, { opacity: 1 }], duration, delay)
      play(el, [{ ...box, transformOrigin: '50% 50%', transform: 'scale(0)', opacity: 0 }, { ...box, transformOrigin: '50% 50%', transform: 'none', opacity: 1 }], duration * 0.8, delay + duration * 0.3)
      return
    default:
      play(el, [{ opacity: 0 }, { opacity: 1 }], duration, delay)
  }
}

/** Morph one mark from its old geometry attributes to its current ones. */
export function morph(el: Element, old: Map<string, string | null>, duration: number): void {
  if (markOf(el) === 'label') {
    // text has no animatable x / y: a moved label fades in where it lands, once its mark has arrived
    if ([...old].some(([attr, prev]) => prev !== el.getAttribute(attr))) enterMark(el, 'label', duration, 0)
    return
  }
  const live = running(el)
  const cs = live.length ? getComputedStyle(el) : null
  const from: Keyframe = {}
  const to: Keyframe = {}
  for (const [attr, prev] of old) {
    const next = el.getAttribute(attr)
    if (next === null || prev === next) continue
    if (attr === 'd') {
      const p = cs ? cs.getPropertyValue('d') : prev ? `path("${prev}")` : ''
      if (!p || p === 'none' || !samePathShape(p.replace(/^path\("|"\)$/g, ''), next)) continue
      from.d = p
      to.d = `path("${next}")`
    } else {
      const p = cs ? cs.getPropertyValue(attr) : prev
      if (p === null || p === '' || !Number.isFinite(parseFloat(p))) continue
      from[attr] = /px$/.test(p) ? p : `${parseFloat(p)}px`
      to[attr] = `${parseFloat(next)}px`
    }
  }
  for (const a of live) a.cancel()
  if (!Object.keys(to).length) return
  try {
    const a = el.animate([from, to], { duration, easing: EASING })
    a.id = MOTION_ANIMATION_ID
  } catch {
    /* property not animatable here */
  }
}

/** Two path strings with the same command letters in the same order (so `d` interpolates). */
export function samePathShape(a: string, b: string): boolean {
  const cmds = (s: string) => s.replace(/[^MLHVCSQTAZmlhvcsqtaz]/g, '')
  const ca = cmds(a)
  return ca.length > 0 && ca === cmds(b) && numberCount(a) === numberCount(b)
}

function numberCount(s: string): number {
  return (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).length
}

/**
 * Whether motion may play at all in this window, whatever the report says.
 *
 * Off when:
 *  - the main process runs a headless mode (capture, sweep, e2e): it passes `--lumen-still`, the preload exposes
 *    `__LUMEN_STILL__`, so screenshots and `wbiReady` waits never catch a visual mid-animation;
 *  - the page URL carries `motion=off` (query or hash route), which publish page previews and embeds can use;
 *  - the OS asks for reduced motion (`prefers-reduced-motion: reduce`);
 *  - the browser has no Web Animations API.
 * End-to-end journeys that test motion turn it back on with `setMotionOverride('on')` (window.__lumen).
 */

import { useEffect, useState } from 'react'
import { STILL_GLOBAL } from '@shared/still'

let override: 'on' | 'off' | null = null
const listeners = new Set<() => void>()

export function setMotionOverride(v: 'on' | 'off' | null): void {
  override = v
  for (const l of listeners) l()
}

export function onMotionOverride(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

function urlSaysOff(): boolean {
  if (typeof location === 'undefined') return false
  const q = new URLSearchParams(location.search).get('motion')
  const h = new URLSearchParams(location.hash.split('?')[1] ?? '').get('motion')
  return q === 'off' || h === 'off'
}

export function motionAllowed(): boolean {
  if (override) return override === 'on'
  if ((globalThis as Record<string, unknown>)[STILL_GLOBAL] === true) return false
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return false
  if (urlSaysOff()) return false
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return true
}

/** `motionAllowed()` as React state, following the reduced-motion setting and the e2e override. */
export function useMotionAllowed(): boolean {
  const [v, setV] = useState(motionAllowed)
  useEffect(() => {
    const update = () => setV(motionAllowed())
    const off = onMotionOverride(update)
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    mq?.addEventListener?.('change', update)
    return () => {
      off()
      mq?.removeEventListener?.('change', update)
    }
  }, [])
  return v
}

const REPLAY_EVENT = 'wbi-motion-replay'

/** Replay the entrance of every visual on the open page (or only `visual`), even where the canvas doesn't animate on its own. */
export function replayMotion(visual?: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: { visual } }))
}

export function onReplayMotion(fn: (visual?: string) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<{ visual?: string }>).detail?.visual)
  window.addEventListener(REPLAY_EVENT, h)
  return () => window.removeEventListener(REPLAY_EVENT, h)
}

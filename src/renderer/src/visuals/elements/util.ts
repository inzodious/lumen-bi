/**
 * Shared helpers for the element visuals (textbox, shapes, image, buttons, navigators):
 * typed property access with button-state selectors, and the hover/press state hook.
 */
import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getProp, makePropContext, rawProp, type PropContext, type Selector } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import { withTransparency } from '@core/report/theme'

/** Button / shape / navigator interaction states (PBIR selector ids). */
export type ElementState = 'default' | 'hover' | 'press' | 'selected' | 'disabled'

/** Selector for a state: the default state resolves entries without selector or with `id: 'default'`. */
export function stateSelector(state: ElementState): Selector | undefined {
  return state === 'default' ? undefined : { id: state }
}

/**
 * Typed property reader. State lookups fall back to the default entry (props.ts semantics), and
 * then to the theme's visualStyles bag for that `$id`, exactly like PBI's state inheritance.
 */
export class Props {
  readonly pc: PropContext
  constructor(
    visualJson: any,
    readonly theme: ResolvedTheme
  ) {
    this.pc = makePropContext(visualJson, theme)
  }

  has(object: string, prop: string, sel?: Selector): boolean {
    return rawProp(this.pc, object, prop, sel) !== undefined
  }

  raw(object: string, prop: string, sel?: Selector): any {
    return rawProp(this.pc, object, prop, sel)
  }

  any(object: string, prop: string, sel?: Selector): any {
    return getProp<any>(this.pc, object, prop, undefined, sel)
  }

  bool(object: string, prop: string, fallback: boolean, sel?: Selector): boolean {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    if (typeof v === 'boolean') return v
    if (v === 'true') return true
    if (v === 'false') return false
    return fallback
  }

  num(object: string, prop: string, fallback: number, sel?: Selector): number {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : fallback
  }

  str(object: string, prop: string, fallback: string, sel?: Selector): string {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    return typeof v === 'string' ? v : v === null || v === undefined ? fallback : String(v)
  }

  color(object: string, prop: string, fallback: string, sel?: Selector): string {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    return typeof v === 'string' ? v : fallback
  }

  /** color with the object's `transparency` (0..100) applied */
  fill(object: string, colorProp: string, fallback: string, sel?: Selector, transparencyProp = 'transparency', fallbackTransparency = 0): string {
    return withTransparency(this.color(object, colorProp, fallback, sel), this.num(object, transparencyProp, fallbackTransparency, sel))
  }
}

/** Hover / press tracking. `enabled` = interactive (view mode, or ctrl held in edit mode). */
export function useElementState(enabled: boolean) {
  const [hover, setHover] = useState(false)
  const [press, setPress] = useState(false)
  const onMouseEnter = useCallback(() => setHover(true), [])
  const onMouseLeave = useCallback(() => {
    setHover(false)
    setPress(false)
  }, [])
  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button === 0) setPress(true)
  }, [])
  const onMouseUp = useCallback(() => setPress(false), [])
  const state: ElementState = !enabled ? 'default' : press ? 'press' : hover ? 'hover' : 'default'
  return { state, handlers: { onMouseEnter, onMouseLeave, onMouseDown, onMouseUp } }
}

/** PBI: in edit mode buttons only act on Ctrl+click; in view mode on a plain click. */
export function actionAllowed(mode: 'view' | 'edit', e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return mode === 'view' || e.ctrlKey || e.metaKey
}

/** 20×20 visualizations-pane icon (stroke uses currentColor). */
export function svgIcon(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2">${body}</svg>`
}

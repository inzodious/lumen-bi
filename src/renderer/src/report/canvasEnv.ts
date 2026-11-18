import { createContext, useContext, type PointerEvent as RPointerEvent } from 'react'
import type { PageDocument } from '@core/report/types'
import type { HostEnv } from './host'

/** Shared per-canvas environment (one PageCanvas instance = one env). */
export interface CanvasEnv extends HostEnv {
  page: PageDocument
  /** edit chrome + manipulation enabled */
  editing: boolean
  /** current visual scale (CSS px per page px) */
  scale: number
  /** show visual headers on hover */
  headers: boolean
  /** spotlighted visual on this page */
  spotlight?: string
  /** visual container finished its first render */
  reportDone(name: string): void
  /**
   * Overlay above every visual (inside the scaled page) that hosts hover visual headers, so a header can sit above
   * its visual's top edge like PBI's without being covered by later visuals or covering the visual's own controls.
   * Absent (mobile layout, focus mode, print): headers render inside the container's top-right corner.
   */
  headerLayer?: HTMLElement | null
  /** edit-mode pointer down on a container (selection / drag) */
  onContainerPointerDown?(e: RPointerEvent, name: string): void
}

export const CanvasEnvContext = createContext<CanvasEnv | null>(null)

export function useCanvasEnv(): CanvasEnv {
  const env = useContext(CanvasEnvContext)
  if (!env) throw new Error('CanvasEnvContext missing')
  return env
}

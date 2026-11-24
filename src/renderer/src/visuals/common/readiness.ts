/**
 * Per-visual readiness. The container (report/VisualContainer.tsx) reports a visual as rendered one frame after its
 * first render; a visual that draws asynchronously (the code visual's sandboxed frame) takes a hold from this context
 * and releases it once its output is on screen, so exports and captures wait for it (with the canvas' own timeout).
 */
import { createContext, useContext, useEffect, useRef } from 'react'

export interface VisualReadiness {
  /** delay "rendered" until the returned function is called (idempotent) */
  hold(): () => void
}

export const VisualReadyContext = createContext<VisualReadiness | null>(null)

/**
 * Hold readiness from the first render until `done` becomes true (or the component unmounts). Returns nothing; the
 * hold is taken synchronously during the first render so the container's first report waits for it.
 */
export function useReadyHold(done: boolean): void {
  const ready = useContext(VisualReadyContext)
  const release = useRef<(() => void) | null | undefined>(undefined)
  if (release.current === undefined) release.current = ready ? ready.hold() : null
  useEffect(() => {
    if (done && release.current) {
      release.current()
      release.current = null
    }
  }, [done])
  useEffect(
    () => () => {
      release.current?.()
      release.current = null
    },
    []
  )
}

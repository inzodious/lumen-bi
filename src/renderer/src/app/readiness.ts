/**
 * Headless-capture readiness signals on <body>:
 *  - `data-wbi-ready` ('1' once the visible screen finished rendering — set by ReportView / other views)
 *  - `data-wbi-busy`  ('1' while any long operation runs: launching, opening a project, saving, scripted exports…)
 * The capture harness (src/main/index.ts) waits for ready === '1' && busy !== '1' (stable over two polls).
 *
 * Rules (the open flow):
 *  - busy = '1' from the moment the renderer loads / an open is requested (before any await) until the open finished
 *    (project set + route options applied + React committed) or failed; it is reference-counted so overlapping
 *    operations don't clear each other, and the store's `busy` (BusyOverlay: "Reading model metadata 37%") is mirrored.
 *  - ready stays '0' while busy (views ask `canSignalReady()` before setting it); when a project with a report is
 *    installed, ready is reset to '0' and the report canvas sets it once the first page rendered.
 */
import { useApp } from '../state/store'

export interface ReadinessSink {
  busy(on: boolean): void
}

/** Pure, testable busy state machine (reference-counted holds). */
export class BusyTracker {
  private holds = new Set<symbol>()
  constructor(private sink: ReadinessSink) {}
  get busy(): boolean {
    return this.holds.size > 0
  }
  hold(reason = 'busy'): () => void {
    const token = Symbol(reason)
    this.holds.add(token)
    this.sink.busy(true)
    return () => {
      if (this.holds.delete(token) && !this.busy) this.sink.busy(false)
    }
  }
}

const domSink: ReadinessSink = {
  busy(on) {
    if (typeof document !== 'undefined' && document.body) document.body.dataset.wbiBusy = on ? '1' : '0'
  }
}

const tracker = new BusyTracker(domSink)

/** Mark the app busy until the returned release function is called (idempotent). */
export function holdBusy(reason = 'busy'): () => void {
  return tracker.hold(reason)
}

/** True while any busy hold is active (views must not signal ready then). */
export function isBusy(): boolean {
  return tracker.busy
}

/** Views call this before setting ready='1' for "nothing to render" states. */
export function canSignalReady(): boolean {
  return !tracker.busy
}

/** Release after two animation frames (lets React commit + effects run first); setTimeout fallback for hidden windows. */
export function releaseAfterPaint(release: () => void): void {
  let done = false
  const fire = () => {
    if (done) return
    done = true
    release()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fire))
  setTimeout(fire, 100)
}

let storeRelease: (() => void) | null = null
let mirrored = false

/** Mirror `useApp().busy` into the busy signal (call once at startup). */
export function mirrorStoreBusy(): void {
  if (mirrored) return
  mirrored = true
  const sync = (busy: unknown) => {
    if (busy && !storeRelease) storeRelease = holdBusy('store')
    else if (!busy && storeRelease) {
      const r = storeRelease
      storeRelease = null
      releaseAfterPaint(r)
    }
  }
  sync(useApp.getState().busy)
  useApp.subscribe((s, prev) => {
    if (s.busy !== prev.busy) sync(s.busy)
  })
}

/** Set the ready flag (same as report/ReportView.setReady; duplicated to keep app/ free of canvas imports). */
export function setReady(on: boolean): void {
  if (typeof document !== 'undefined' && document.body) document.body.dataset.wbiReady = on ? '1' : '0'
}

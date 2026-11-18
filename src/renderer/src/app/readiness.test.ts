import { describe, expect, it } from 'vitest'
import { BusyTracker } from './readiness'

describe('readiness busy tracker', () => {
  it('is busy while any hold is active and signals transitions', () => {
    const log: boolean[] = []
    const t = new BusyTracker({ busy: (on) => log.push(on) })
    expect(t.busy).toBe(false)
    const launch = t.hold('launch')
    const store = t.hold('store') // e.g. "Reading model metadata 37%"
    expect(t.busy).toBe(true)
    launch()
    expect(t.busy).toBe(true) // store busy still active: never ready mid-load
    launch() // idempotent
    expect(t.busy).toBe(true)
    store()
    expect(t.busy).toBe(false)
    expect(log[log.length - 1]).toBe(false)
    expect(log.slice(0, -1).every((b) => b)).toBe(true)
  })

  it('open flow: busy from request until first page rendered', () => {
    const states: string[] = []
    let busy = false
    let ready = true // e.g. start screen was ready before
    const t = new BusyTracker({ busy: (on) => (busy = on) })
    const snap = (label: string) => states.push(`${label}:${busy ? 'B' : '-'}${ready ? 'R' : '-'}`)
    const capturable = () => ready && !busy
    // open requested
    const rel = t.hold('open')
    snap('request')
    expect(capturable()).toBe(false)
    // project installed: ready reset by the open flow
    ready = false
    rel()
    snap('installed')
    expect(capturable()).toBe(false)
    // canvas rendered
    ready = true
    snap('rendered')
    expect(capturable()).toBe(true)
    expect(states).toEqual(['request:BR', 'installed:--', 'rendered:-R'])
  })
})

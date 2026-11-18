import { describe, expect, it } from 'vitest'
import { centredPlacement } from './insertPlacement'

const page = { width: 1280, height: 720 }

describe('Insert ▸ Icon placement', () => {
  it('centres the new visual on the visible part of the page', () => {
    expect(centredPlacement(page, { x: 0, y: 0, width: 1280, height: 720 }, 96, 96)).toEqual({ x: 592, y: 312, width: 96, height: 96 })
    // scrolled / zoomed in: the visible rectangle is part of the page
    expect(centredPlacement(page, { x: 600, y: 300, width: 400, height: 200 }, 96, 96)).toEqual({ x: 752, y: 352, width: 96, height: 96 })
  })

  it('without a visible rectangle (canvas not shown) uses the page centre; stays inside the page', () => {
    expect(centredPlacement(page, undefined, 96, 96)).toEqual({ x: 592, y: 312, width: 96, height: 96 })
    expect(centredPlacement(page, { x: 1250, y: 700, width: 30, height: 20 }, 96, 96)).toEqual({ x: 1184, y: 624, width: 96, height: 96 })
    expect(centredPlacement({ width: 50, height: 40 }, undefined, 96, 96)).toEqual({ x: 0, y: 0, width: 50, height: 40 })
  })

  it('steps down-right while another visual sits exactly there', () => {
    const taken = [{ x: 592, y: 312 }, { x: 612, y: 332 }]
    expect(centredPlacement(page, undefined, 96, 96, taken)).toEqual({ x: 632, y: 352, width: 96, height: 96 })
  })
})

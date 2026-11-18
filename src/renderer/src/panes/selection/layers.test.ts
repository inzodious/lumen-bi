import { describe, expect, it } from 'vitest'
import type { PageDocument } from '@core/report/types'
import { flattenTree, layerName, layerTree, moveLayerAbove, moveTabOrder, renameLayer, tabOrderList } from './layers'

function page(): PageDocument {
  const v = (name: string, z: number, extra: any = {}) => ({ name, json: { name, position: { x: 0, y: 0, width: 10, height: 10, z, tabOrder: z }, visual: { visualType: 'card' }, ...extra } })
  return {
    name: 'p',
    json: {},
    visuals: [
      v('a', 0),
      v('b', 1000),
      { name: 'g', json: { name: 'g', position: { x: 0, y: 0, z: 2000, width: 1, height: 1, tabOrder: 2000 }, visualGroup: { displayName: 'Group 1' } } },
      v('c', 0, { parentGroupName: 'g' }),
      v('d', 1000, { parentGroupName: 'g' })
    ]
  }
}

describe('selection pane layers', () => {
  it('builds a tree with top-most first', () => {
    const t = layerTree(page())
    expect(t.map((n) => n.visual.name)).toEqual(['g', 'b', 'a'])
    expect(t[0].children.map((n) => n.visual.name)).toEqual(['d', 'c'])
    expect(flattenTree(t, new Set()).map((n) => n.visual.name)).toEqual(['g', 'd', 'c', 'b', 'a'])
    expect(flattenTree(t, new Set(['g'])).map((n) => n.visual.name)).toEqual(['g', 'b', 'a'])
  })

  it('names and renames layers', () => {
    const p = page()
    expect(layerName(p.visuals[2], () => 'x')).toBe('Group 1')
    expect(layerName(p.visuals[0], (t) => `T:${t}`)).toBe('T:card')
    renameLayer(p.visuals[0], "Sales's card")
    expect(layerName(p.visuals[0], () => 'x')).toBe("Sales's card")
    renameLayer(p.visuals[2], 'KPIs')
    expect(p.visuals[2].json.visualGroup.displayName).toBe('KPIs')
  })

  it('reorders siblings only', () => {
    const p = page()
    expect(moveLayerAbove(p, 'a', 'b')).toBe(true)
    expect(layerTree(p).map((n) => n.visual.name)).toEqual(['g', 'a', 'b'])
    expect(moveLayerAbove(p, 'a', 'c')).toBe(false)
  })

  it('moves tab order', () => {
    const p = page()
    expect(tabOrderList(p).map((v) => v.name)).toEqual(['a', 'c', 'b', 'd', 'g'])
    moveTabOrder(p, 'b', -1)
    expect(tabOrderList(p).map((v) => v.name)).toEqual(['a', 'b', 'c', 'd', 'g'])
    expect(p.visuals.find((v) => v.name === 'b')!.json.position.tabOrder).toBe(1000)
  })
})

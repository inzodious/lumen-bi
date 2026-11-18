import { describe, expect, it } from 'vitest'
import { parseDiagramPrefs } from './diagramPrefs'

describe('model view preferences', () => {
  it('defaults when nothing (valid) is stored', () => {
    const d = { lineStyle: null, mode: 'pan', snap: true }
    expect(parseDiagramPrefs(null)).toEqual(d)
    expect(parseDiagramPrefs('nope')).toEqual(d)
    expect(parseDiagramPrefs('[]')).toEqual(d)
    expect(parseDiagramPrefs('{"lineStyle":"wavy","mode":"fly","snap":"yes"}')).toEqual(d)
  })
  it('reads stored values', () => {
    expect(parseDiagramPrefs('{"lineStyle":"curved","mode":"select","snap":false}')).toEqual({ lineStyle: 'curved', mode: 'select', snap: false })
  })
})

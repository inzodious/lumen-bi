import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import { readSlicerFormat } from './slicerFormat'
import { setSearchEnabled } from './SlicerVisual'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })

describe('slicer context menu: Search', () => {
  it('writes general.selfFilterEnabled like the Format pane option; switching it off drops the saved search text', () => {
    const json: any = { visual: { visualType: 'slicer', objects: { general: [{ properties: { selfFilter: { filter: { Version: 2, Where: [] } }, filter: { filter: { Version: 2, Where: [] } } } }] } } }
    setSearchEnabled(json, true)
    expect(json.visual.objects.general[0].properties.selfFilterEnabled).toEqual(lit('true'))
    expect(readSlicerFormat(json, resolveTheme()).searchEnabled).toBe(true)
    expect(json.visual.objects.general[0].properties.selfFilter).toBeDefined()
    setSearchEnabled(json, false)
    expect(readSlicerFormat(json, resolveTheme()).searchEnabled).toBe(false)
    expect(json.visual.objects.general[0].properties.selfFilter).toBeUndefined()
    // the slicer's selection is untouched
    expect(json.visual.objects.general[0].properties.filter).toBeDefined()
  })
})

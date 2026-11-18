import { describe, expect, it } from 'vitest'
import { literalProp, setObjectProp } from '../props'

describe('literalProp', () => {
  it('writes PBIR literals: dates as datetime literals, numbers L / D, text quoted, colors as solid fills', () => {
    expect(literalProp(new Date(Date.UTC(2024, 0, 31)))).toEqual({ expr: { Literal: { Value: "datetime'2024-01-31T00:00:00'" } } })
    expect(literalProp(new Date(Date.UTC(2024, 11, 5, 13, 4, 9)))).toEqual({ expr: { Literal: { Value: "datetime'2024-12-05T13:04:09'" } } })
    expect(literalProp(3)).toEqual({ expr: { Literal: { Value: '3L' } } })
    expect(literalProp(2.5)).toEqual({ expr: { Literal: { Value: '2.5D' } } })
    expect(literalProp("it's")).toEqual({ expr: { Literal: { Value: "'it''s'" } } })
    expect(literalProp(true)).toEqual({ expr: { Literal: { Value: 'true' } } })
    expect(literalProp(null)).toEqual({ expr: { Literal: { Value: 'null' } } })
    expect(literalProp('#118DFF')).toEqual({ solid: { color: { expr: { Literal: { Value: "'#118DFF'" } } } } })
  })
  it('setObjectProp stores a date property as a datetime literal (date slicer anchors)', () => {
    const v: any = { visual: {} }
    setObjectProp(v, 'date', 'start', new Date(Date.UTC(2023, 5, 1)))
    expect(v.visual.objects.date[0].properties.start).toEqual({ expr: { Literal: { Value: "datetime'2023-06-01T00:00:00'" } } })
  })
})

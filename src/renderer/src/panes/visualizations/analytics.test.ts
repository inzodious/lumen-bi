import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import { forecastParam, setForecastParam } from './AnalyticsTab'
import { readForecastSpecs } from '../../visuals/charts/cartesian/forecast'
import type { ObjectEntry } from '@core/report/props'

describe('Analytics ▸ Forecast PBIR', () => {
  it('writes transform parameters the chart reads (PBI Desktop shape)', () => {
    const e: ObjectEntry = { properties: { show: { expr: { Literal: { Value: 'true' } } } }, selector: { metadata: 'Sales.Total', id: '1' } } as any
    setForecastParam(e, 'Unit', 7)
    setForecastParam(e, 'ForecastLength', 12)
    setForecastParam(e, 'IgnoreLast', 2)
    setForecastParam(e, 'ConfidenceLevel', 0.9)
    setForecastParam(e, 'MaxSeasonality', 4)
    expect((e.properties as any).transform).toEqual({
      algorithm: 'Forecast',
      parameters: [
        { Name: 'Unit', Literal: { Value: '7D' } },
        { Name: 'ForecastLength', Literal: { Value: '12D' } },
        { Name: 'IgnoreLast', Literal: { Value: '2D' } },
        { Name: 'ConfidenceLevel', Literal: { Value: '0.9D' } },
        { Name: 'MaxSeasonality', Literal: { Value: '4D' } }
      ]
    })
    expect(forecastParam(e, 'ForecastLength')).toBe(12)
    const [spec] = readForecastSpecs({ forecast: [e] }, resolveTheme())
    expect(spec).toMatchObject({ metadata: 'Sales.Total', unit: 7, length: 12, ignoreLast: 2, confidence: 0.9, seasonality: 4 })
  })

  it('updates in place and removes a parameter', () => {
    const e: ObjectEntry = { properties: {} } as any
    setForecastParam(e, 'ForecastLength', 10)
    setForecastParam(e, 'ForecastLength', 20)
    expect((e.properties as any).transform.parameters).toEqual([{ Name: 'ForecastLength', Literal: { Value: '20D' } }])
    setForecastParam(e, 'ForecastLength', undefined)
    expect((e.properties as any).transform.parameters).toEqual([])
    expect(forecastParam(e, 'ForecastLength')).toBeUndefined()
  })
})

/** Code visuals from the starter templates with wells from the built-in sample (screenshot and docs journeys). */
import { STARTER_TEMPLATES, applyTemplate } from '../../src/core/codevisual/templates'
import { CODE_VISUAL_TYPE } from '../../src/core/codevisual/model'

export const col = (t: string, c: string, extra: Record<string, unknown> = {}) => ({ field: { Column: { Expression: { SourceRef: { Entity: t } }, Property: c } }, queryRef: `${t}.${c}`, nativeQueryRef: c, ...extra })
export const mea = (m: string) => ({ field: { Measure: { Expression: { SourceRef: { Entity: '_Measures' } }, Property: m } }, queryRef: `_Measures.${m}`, nativeQueryRef: m })

/** Wells per template, from the built-in sample. */
export function sampleWells(id: string): Record<string, { projections: unknown[] }> {
  const product = [col('Product', 'Category', { active: true }), col('Product', 'Subcategory'), col('Product', 'Product')]
  switch (id) {
    case 'kpi':
      return { Category: { projections: [col('Date', 'Year Month')] }, Y: { projections: [mea('Total Sales'), mea('Sales LY')] } }
    case 'ring':
      return { Y: { projections: [mea('Margin'), mea('Total Cost')] } }
    case 'scorecard':
      return { Category: { projections: [col('Region', 'Country')] }, Y: { projections: [mea('Total Sales'), mea('Sales LY')] } }
    case 'steps':
      return { Category: { projections: [col('Date', 'Quarter')] }, Y: { projections: [mea('Total Sales')] } }
    case 'badges':
      return { Category: { projections: [col('Region', 'Country')] }, Y: { projections: [mea('Total Sales'), mea('Margin %')] } }
    default:
      return { Category: { projections: product }, Y: { projections: [mea('Total Sales')] } }
  }
}

/** A code visual's JSON for a starter template with sample wells. */
export function templateVisual(name: string, id: string, rect: { x: number; y: number; w: number; h: number }, background?: string): any {
  const t = STARTER_TEMPLATES.find((x) => x.id === id)!
  const json: any = {
    name,
    position: { x: rect.x, y: rect.y, z: 1000, width: rect.w, height: rect.h, tabOrder: 1000 },
    visual: { visualType: CODE_VISUAL_TYPE, query: { queryState: sampleWells(id) }, objects: {}, drillFilterOtherVisuals: true }
  }
  applyTemplate(json, t)
  if (background)
    json.visual.visualContainerObjects = {
      background: [{ properties: { show: { expr: { Literal: { Value: 'true' } } }, color: { solid: { color: { expr: { Literal: { Value: `'${background}'` } } } } }, transparency: { expr: { Literal: { Value: '0D' } } } } }],
      border: [{ properties: { show: { expr: { Literal: { Value: 'false' } } } } }]
    }
  return json
}

export const DARK_THEME = {
  name: 'Code visual dark',
  dataColors: ['#4CA8FF', '#7FD1C9', '#FF9E6B', '#C59BFF', '#FF7BC2', '#9C8CFF', '#F2C94C', '#FF6F7D'],
  background: '#252423',
  backgroundLight: '#323130',
  backgroundNeutral: '#3B3A39',
  foreground: '#F3F2F1',
  foregroundNeutralSecondary: '#C8C6C4',
  foregroundNeutralTertiary: '#8A8886',
  good: '#3DD16B',
  bad: '#FF6F7D',
  neutral: '#F2B84B',
  tableAccent: '#4CA8FF',
  textClasses: { label: { color: '#F3F2F1' }, title: { color: '#F3F2F1' }, header: { color: '#F3F2F1' }, callout: { color: '#F3F2F1' } }
}


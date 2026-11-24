/** Dev-gallery fixtures for the code visual (sample model: common/sampleData.ts). The frame needs the app, so the
 * dev gallery and server-side smoke tests show the host part only (the frame itself is exercised in e2e/codevisual). */
import { registerNonChartEntries } from '../gallery/entries-nonchart'
import type { NonChartGalleryEntry } from '../common/nonchartGallery'
import { S, proj } from '../common/sampleData'
import { CODE_VISUAL_TYPE } from '@core/codevisual/model'
import { BAR_LIST, KPI_TILE, applyTemplate } from '@core/codevisual/templates'

function visual(name: string, queryState: any, template: typeof BAR_LIST): any {
  const json: any = { name, visual: { visualType: CODE_VISUAL_TYPE, query: { queryState }, objects: {} } }
  applyTemplate(json, template)
  return json
}

export const galleryEntries: NonChartGalleryEntry[] = [
  {
    id: 'code-barlist',
    title: 'Code visual — bar list with a drillable hierarchy',
    width: 400,
    height: 260,
    visualJson: visual(
      'gallery-code-barlist',
      {
        Category: { projections: [proj(S.col('Category'), 'Sales.Category', { active: true }), proj(S.col('Subcategory'), 'Sales.Subcategory'), proj(S.col('Product'), 'Sales.Product')] },
        Y: { projections: [proj(S.m('Total Sales'), '_m.Total Sales')] }
      },
      BAR_LIST
    )
  },
  {
    id: 'code-kpi',
    title: 'Code visual — KPI tile',
    width: 320,
    height: 180,
    visualJson: visual(
      'gallery-code-kpi',
      { Category: { projections: [proj(S.col('Month'), 'Sales.Month')] }, Y: { projections: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Total Cost'), '_m.Total Cost')] } },
      KPI_TILE
    )
  }
]

registerNonChartEntries('Code visual', galleryEntries)

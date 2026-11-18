/**
 * Gallery entry shape for the non-chart visuals (tables, cards, slicers, elements, custom).
 * Each family exports `galleryEntries: NonChartGalleryEntry[]` from its `gallery.ts`; they are
 * aggregated by `visuals/gallery/entries-nonchart.ts` and rendered against the sample engine
 * (`common/sampleData.ts`) with a mock host (`common/mockHost.ts`).
 */
import type { SQFilter } from '@core/report/sq'

export interface NonChartGalleryEntry {
  id: string
  title: string
  /** visual.json (visualContainer) content — `{ name, position, visual: { visualType, query, objects, ... } }` */
  visualJson: any
  /** content-area size in px */
  width: number
  height: number
  filters?: SQFilter[]
  mode?: 'view' | 'edit'
}

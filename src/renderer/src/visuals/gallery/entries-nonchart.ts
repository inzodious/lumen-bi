/**
 * Adapter: registers the non-chart families' gallery entries (tables, cards, slicers, elements,
 * custom — each exports `galleryEntries: NonChartGalleryEntry[]` from its `gallery.ts`) into the
 * gallery registry. They run against their own neutral sample model (common/sampleData.ts) via
 * the in-memory engine, with demo report pages/bookmarks for navigators.
 */
import type { QueryEngine } from '@core/engine/api'
import type { NonChartGalleryEntry } from '../common/nonchartGallery'
import { createSampleEngine } from '../common/sampleData'
import type { ReportInfo } from '../contract'
import { registerGalleryEntries } from './registry'

let engine: QueryEngine | undefined
function sampleEngine(): QueryEngine {
  return (engine ??= createSampleEngine())
}

const DEMO_REPORT: ReportInfo = {
  pages: [
    { name: 'p1', displayName: 'Overview', hidden: false },
    { name: 'p2', displayName: 'Sales detail', hidden: false },
    { name: 'p3', displayName: 'Customers', hidden: false },
    { name: 'p4', displayName: 'Hidden page', hidden: true }
  ],
  activePage: 'p1',
  bookmarks: [
    { name: 'b1', displayName: 'Default view' },
    { name: 'b2', displayName: 'Top regions' }
  ],
  resolveImage: () => undefined
}

export function registerNonChartEntries(section: string, entries: NonChartGalleryEntry[]): void {
  registerGalleryEntries(
    entries.map((e) => ({
      id: `${section}:${e.id}`,
      section,
      title: e.title,
      json: e.visualJson,
      // the gallery card adds a title row + padding around the content area
      width: e.width + 12,
      height: e.height + 32,
      filters: e.filters,
      mode: e.mode,
      get engine() {
        return sampleEngine()
      },
      report: DEMO_REPORT
    }))
  )
}

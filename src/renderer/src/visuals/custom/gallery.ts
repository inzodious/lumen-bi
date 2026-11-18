/** Dev gallery entries for the custom visuals (HTML Content, Deneb, Power Automate). */
import { registerNonChartEntries } from '../gallery/entries-nonchart'
import type { NonChartGalleryEntry } from '../common/nonchartGallery'
import { S, proj } from '../common/sampleData'
import { POWER_AUTOMATE_TYPE } from './PowerAutomate'

const L = (v: string | number | boolean) => ({
  expr: { Literal: { Value: typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : typeof v === 'number' ? (Number.isInteger(v) ? `${v}L` : `${v}D`) : String(v) } }
})

const HTML_TYPE = 'htmlContent443BE3AD55E043BF878BED274D3A6865'
const contentFormatting = [{ properties: { showRawHtml: L(false), fontSize: L(11), align: L('left'), userSelect: L(true) } }]

const DENEB_SPEC = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  width: 'container',
  height: 'container',
  data: { name: 'dataset' },
  mark: { type: 'bar', cornerRadiusEnd: 3, tooltip: true },
  encoding: {
    y: { field: 'Region', type: 'nominal', sort: '-x', axis: { title: null } },
    x: { field: 'Total Sales', type: 'quantitative', axis: { title: null, format: '$.2s' } },
    color: { field: 'Region', type: 'nominal', legend: null }
  }
}

export const galleryEntries: NonChartGalleryEntry[] = [
  {
    id: 'html-single',
    title: 'HTML Content — measure HTML',
    width: 300,
    height: 90,
    visualJson: {
      name: 'html1',
      visual: { visualType: HTML_TYPE, query: { queryState: { content: { projections: [proj(S.m('Sales Html'), '_m.Sales Html')] } } }, objects: { contentFormatting } }
    }
  },
  {
    id: 'html-rows',
    title: 'HTML Content — one entry per Region + stylesheet',
    width: 300,
    height: 260,
    visualJson: {
      name: 'html2',
      visual: {
        visualType: HTML_TYPE,
        query: {
          queryState: {
            content: { projections: [proj(S.m('Sales Html'), '_m.Sales Html')] },
            sampling: { projections: [proj(S.col('Region'), 'Sales.Region')] }
          }
        },
        objects: { contentFormatting, stylesheet: [{ properties: { stylesheet: L('.htmlViewerEntry{border-bottom:1px solid #EDEBE9;margin-bottom:2px}') } }] }
      }
    }
  },
  {
    id: 'deneb-bar',
    title: 'Deneb — Vega-Lite bar chart',
    width: 360,
    height: 200,
    visualJson: {
      name: 'deneb1',
      visual: {
        visualType: 'deneb7E15AEF80B9E4D4F8E12924291ECE89A',
        query: {
          queryState: {
            dataset: { projections: [proj(S.col('Region'), 'Sales.Region'), proj(S.m('Total Sales'), '_m.Total Sales')] }
          }
        },
        objects: {
          vega: [{ properties: { provider: L('vegaLite'), jsonSpec: L(JSON.stringify(DENEB_SPEC, null, 2)), jsonConfig: L('{"view": {"stroke": ""}}'), renderMode: L('svg') } }]
        }
      }
    }
  },
  {
    id: 'power-automate-default',
    title: 'Power Automate button — default',
    width: 200,
    height: 50,
    visualJson: { name: 'pa1', visual: { visualType: POWER_AUTOMATE_TYPE } }
  },
  {
    id: 'power-automate-styled',
    title: 'Power Automate button — custom text and fill',
    width: 320,
    height: 46,
    visualJson: {
      name: 'pa2',
      visual: {
        visualType: POWER_AUTOMATE_TYPE,
        query: { queryState: { table: { projections: [proj(S.col('Region'), 'Sales.Region')] } } },
        objects: {
          buttonFill: [{ properties: { color: { solid: { color: L('#3B5E96') } } }, selector: { id: 'default' } }],
          buttonText: [{ properties: { text: L('Notify regional managers') }, selector: { id: 'default' } }]
        }
      }
    }
  }
]

registerNonChartEntries('Custom visuals', galleryEntries)

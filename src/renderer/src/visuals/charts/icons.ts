/** 20×20 visualization-pane icons (monochrome, PBI-pane style). */
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#252423" stroke-width="1">${body}</svg>`
const F = 'fill="#252423" stroke="none"'

export const ICONS: Record<string, string> = {
  clusteredColumnChart: svg(`<path d="M2.5 17.5h15"/><rect x="3.5" y="9" width="2.5" height="8" ${F}/><rect x="6" y="5" width="2.5" height="12" fill="none"/><rect x="11" y="11" width="2.5" height="6" ${F}/><rect x="13.5" y="7" width="2.5" height="10" fill="none"/>`),
  columnChart: svg(`<path d="M2.5 17.5h15"/><rect x="4" y="10" width="3" height="7" ${F}/><rect x="4" y="5" width="3" height="5"/><rect x="8.5" y="12" width="3" height="5" ${F}/><rect x="8.5" y="8" width="3" height="4"/><rect x="13" y="9" width="3" height="8" ${F}/><rect x="13" y="3" width="3" height="6"/>`),
  hundredPercentStackedColumnChart: svg(`<path d="M2.5 17.5h15"/><rect x="4" y="9" width="3" height="8" ${F}/><rect x="4" y="3" width="3" height="6"/><rect x="8.5" y="12" width="3" height="5" ${F}/><rect x="8.5" y="3" width="3" height="9"/><rect x="13" y="6" width="3" height="11" ${F}/><rect x="13" y="3" width="3" height="3"/>`),
  clusteredBarChart: svg(`<path d="M2.5 2.5v15"/><rect x="3" y="3.5" width="8" height="2.5" ${F}/><rect x="3" y="6" width="12" height="2.5"/><rect x="3" y="11" width="6" height="2.5" ${F}/><rect x="3" y="13.5" width="10" height="2.5"/>`),
  barChart: svg(`<path d="M2.5 2.5v15"/><rect x="3" y="4" width="7" height="3" ${F}/><rect x="10" y="4" width="5" height="3"/><rect x="3" y="8.5" width="5" height="3" ${F}/><rect x="8" y="8.5" width="4" height="3"/><rect x="3" y="13" width="8" height="3" ${F}/><rect x="11" y="13" width="6" height="3"/>`),
  hundredPercentStackedBarChart: svg(`<path d="M2.5 2.5v15"/><rect x="3" y="4" width="8" height="3" ${F}/><rect x="11" y="4" width="6" height="3"/><rect x="3" y="8.5" width="5" height="3" ${F}/><rect x="8" y="8.5" width="9" height="3"/><rect x="3" y="13" width="11" height="3" ${F}/><rect x="14" y="13" width="3" height="3"/>`),
  lineChart: svg(`<path d="M2.5 2.5v15h15"/><path d="M3.5 14l4-5 3.5 3 6-7.5" stroke-width="1.4" stroke-linejoin="round"/>`),
  areaChart: svg(`<path d="M2.5 2.5v15h15"/><path d="M3 16.5V13l4-5 3.5 3 6.5-7v12.5z" ${F} opacity=".85"/>`),
  stackedAreaChart: svg(`<path d="M2.5 2.5v15h15"/><path d="M3 16.5v-4l4-3 4 2 6-4v9z" ${F}/><path d="M3 12.5l4-6 4 2 6-5" stroke-width="1.2"/>`),
  hundredPercentStackedAreaChart: svg(`<path d="M2.5 2.5v15h15"/><path d="M3 16.5v-6l4-2 4 3 6-3v8z" ${F}/><path d="M3 3.5h14v5l-6 3-4-3-4 2z"/>`),
  lineClusteredColumnComboChart: svg(`<path d="M2.5 17.5h15"/><rect x="4" y="10" width="2.5" height="7" ${F}/><rect x="6.5" y="12" width="2.5" height="5"/><rect x="11" y="8" width="2.5" height="9" ${F}/><rect x="13.5" y="11" width="2.5" height="6"/><path d="M3 7l5-3 4 3 5-4" stroke-width="1.3"/>`),
  lineStackedColumnComboChart: svg(`<path d="M2.5 17.5h15"/><rect x="4" y="11" width="3" height="6" ${F}/><rect x="4" y="8" width="3" height="3"/><rect x="8.5" y="13" width="3" height="4" ${F}/><rect x="8.5" y="10" width="3" height="3"/><rect x="13" y="9" width="3" height="8" ${F}/><rect x="13" y="7" width="3" height="2"/><path d="M3 6l5-3 4 3 5-4" stroke-width="1.3"/>`),
  ribbonChart: svg(`<path d="M2.5 17.5h15"/><rect x="3" y="9" width="3" height="8" ${F}/><rect x="14" y="5" width="3" height="12" ${F}/><path d="M6 9l8-4v12H6z" fill="#252423" opacity=".35" stroke="none"/><rect x="3" y="5" width="3" height="4"/><rect x="14" y="2.5" width="3" height="2.5"/>`),
  waterfallChart: svg(`<path d="M2.5 17.5h15"/><rect x="3" y="9" width="3" height="8" ${F}/><rect x="6.5" y="5" width="3" height="4"/><rect x="10" y="7" width="3" height="3" ${F}/><rect x="13.5" y="7" width="3" height="10" ${F}/>`),
  scatterChart: svg(`<path d="M2.5 2.5v15h15"/><circle cx="6" cy="13" r="1.3" ${F}/><circle cx="9" cy="9" r="1.3" ${F}/><circle cx="12" cy="11" r="1.3" ${F}/><circle cx="14.5" cy="5.5" r="1.3" ${F}/><circle cx="7.5" cy="6" r="1.3" ${F}/>`),
  pieChart: svg(`<circle cx="10" cy="10" r="7"/><path d="M10 10V3a7 7 0 0 1 6.6 9.3z" ${F}/>`),
  donutChart: svg(`<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.5"/><path d="M10 3a7 7 0 0 1 6.6 9.3l-3.3-1.2A3.5 3.5 0 0 0 10 6.5z" ${F}/>`),
  funnel: svg(`<rect x="2.5" y="3" width="15" height="3" ${F}/><rect x="4.5" y="7.5" width="11" height="3"/><rect x="6.5" y="12" width="7" height="3" ${F}/><rect x="8.5" y="16" width="3" height="1.5"/>`),
  treemap: svg(`<rect x="2.5" y="2.5" width="15" height="15"/><rect x="2.5" y="2.5" width="8" height="15" ${F}/><path d="M10.5 9.5h7M14 9.5v8"/>`),
  gauge: svg(`<path d="M3 14a7 7 0 0 1 14 0"/><path d="M3 14a7 7 0 0 1 9.5-6.5" stroke-width="3"/><path d="M10 14l3-4" stroke-width="1.2"/>`),
  kpi: svg(`<path d="M3 15l4-4 3 2 7-7" stroke-width="1.3"/><path d="M13 6h4v4"/><path d="M2.5 17.5h15"/>`),
  map: svg(`<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c-3 3-3 12 0 15M10 2.5c3 3 3 12 0 15"/><circle cx="7" cy="7.5" r="1.5" ${F}/><circle cx="13" cy="12" r="2" ${F}/>`),
  filledMap: svg(`<path d="M3 6l4-2 3 1.5 4-1.5 3 2v9l-4 2-3-1.5-4 1.5-3-2z" ${F} opacity=".85"/><path d="M7 4v12M10 5.5v12M14 4v12" stroke="#fff"/>`),
  shapeMap: svg(`<path d="M3 5h5l2 3h7v8H3z"/><path d="M3 5h5l2 3H3z" ${F}/>`),
  azureMap: svg(`<path d="M10 17.5s-5-5.2-5-9a5 5 0 0 1 10 0c0 3.8-5 9-5 9z"/><circle cx="10" cy="8.5" r="2" ${F}/>`),
  decompositionTreeVisual: svg(`<rect x="2.5" y="8" width="4" height="4" ${F}/><rect x="13.5" y="3" width="4" height="3"/><rect x="13.5" y="8.5" width="4" height="3" ${F}/><rect x="13.5" y="14" width="4" height="3"/><path d="M6.5 10h3.5M10 4.5v11M10 4.5h3.5M10 10h3.5M10 15.5h3.5"/>`),
  keyDriversVisual: svg(`<circle cx="10" cy="10" r="2.5" ${F}/><circle cx="4" cy="4.5" r="1.5"/><circle cx="16" cy="4.5" r="1.5"/><circle cx="4" cy="15.5" r="1.5"/><circle cx="16" cy="15.5" r="1.5"/><path d="M5 5.5l3.2 3M15 5.5l-3.2 3M5 14.5l3.2-3M15 14.5l-3.2-3"/>`),
  qnaVisual: svg(`<path d="M3 4h14v9H9l-4 3v-3H3z"/><path d="M8.5 7.2a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.7.6-.7 1.1M10 11v.1" stroke-width="1.2"/>`),
  aiNarratives: svg(`<path d="M3 4.5h14M3 8h14M3 11.5h9M3 15h6"/><path d="M15 12l.7 1.6 1.6.7-1.6.7L15 16.6l-.7-1.6-1.6-.7 1.6-.7z" ${F}/>`)
}

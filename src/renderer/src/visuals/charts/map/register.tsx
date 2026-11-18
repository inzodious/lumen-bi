/** Registers the map visuals: filledMap, map (bubble), azureMap, shapeMap. */
import type { DataRoleDef, FormatCardDef, VisualDefinition, VisualProps } from '../../contract'
import { registerVisual } from '../../registry'
import { buildCategorical, categoricalTable } from '../../common/categorical'
import { FormatReader, PBI } from '../../common/fmtProps'
import { ICONS } from '../icons'
import { dataColorsCard, legendCard } from '../formatCards'
import { MapChart } from './MapChart'
import { deriveMapQuery, type MapKind } from './mapQuery'

const bubblesCard: FormatCardDef = {
  object: 'bubbles',
  displayName: 'Bubbles',
  properties: [{ name: 'bubbleSize', displayName: 'Size', type: 'integer', min: -100, max: 100, default: 0 }]
}

/** Azure Maps bubble layer (theme CY24SU10: radius 8, min 8, max 40). */
const bubbleLayerCard: FormatCardDef = {
  object: 'bubbleLayer',
  displayName: 'Bubble layer',
  properties: [
    { name: 'bubbleRadius', displayName: 'Size (no size field)', type: 'integer', min: 1, max: 50, default: 8 },
    { name: 'minBubbleRadius', displayName: 'Minimum size', type: 'integer', min: 1, max: 50, default: 8 },
    { name: 'maxRadius', displayName: 'Maximum size', type: 'integer', min: 1, max: 200, default: 40 },
    { name: 'strokeColor', displayName: 'Border color', type: 'color', default: '#FFFFFF' },
    { name: 'strokeWidth', displayName: 'Border width', type: 'integer', min: 0, max: 10, default: 1 },
    { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
  ]
}

const mapControlsCard: FormatCardDef = {
  object: 'mapControls',
  displayName: 'Controls',
  properties: [
    { name: 'autoZoom', displayName: 'Auto zoom', type: 'bool', default: true },
    { name: 'zoomButtonsVisible', displayName: 'Zoom buttons', type: 'bool', default: false }
  ]
}

const BING_STYLES = [
  { value: 'road', label: 'Road' },
  { value: 'aerial', label: 'Aerial' },
  { value: 'canvasDark', label: 'Dark' },
  { value: 'canvasLight', label: 'Light' },
  { value: 'grayscale', label: 'Grayscale' }
]

const mapStylesCard: FormatCardDef = {
  object: 'mapStyles',
  displayName: 'Style',
  properties: [
    { name: 'mapTheme', displayName: 'Style', type: 'enum', options: BING_STYLES, default: 'road' },
    { name: 'showLabels', displayName: 'Labels', type: 'bool', default: true }
  ]
}

const azureStylesCard: FormatCardDef = {
  object: 'mapStyles',
  displayName: 'Style',
  properties: [
    {
      name: 'mapTheme',
      displayName: 'Style',
      type: 'enum',
      options: [
        { value: 'road', label: 'Road' },
        { value: 'grayscale_light', label: 'Grayscale light' },
        { value: 'grayscale_dark', label: 'Grayscale dark' },
        { value: 'night', label: 'Night' },
        { value: 'road_shaded_relief', label: 'Road shaded relief' },
        { value: 'satellite', label: 'Satellite' },
        { value: 'satellite_road_labels', label: 'Hybrid' },
        { value: 'high_contrast_dark', label: 'High contrast dark' },
        { value: 'high_contrast_light', label: 'High contrast light' }
      ],
      default: 'road'
    },
    { name: 'showLabels', displayName: 'Labels', type: 'bool', default: true }
  ]
}

const categoryLabelsCard: FormatCardDef = {
  object: 'categoryLabels',
  displayName: 'Category labels',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: false },
    { name: 'color', displayName: 'Color', type: 'color', default: PBI.dataLabelColor },
    { name: 'fontSize', displayName: 'Text size', type: 'fontSize', default: 9 },
    { name: 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
    { name: 'enableBackground', displayName: 'Background', type: 'bool', default: true },
    { name: 'backgroundColor', displayName: 'Background color', type: 'color', default: '#FFFFFF' },
    { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 30 }
  ]
}

/** Shape map: map type is fixed to the built-in geometry Lumen has (US states / world countries). */
const shapeCard: FormatCardDef = {
  object: 'shape',
  displayName: 'Map settings',
  properties: [
    {
      name: 'projectionEnum',
      displayName: 'Projection',
      type: 'enum',
      options: [
        { value: 'mercator', label: 'Mercator' },
        { value: 'equirectangular', label: 'Equirectangular' },
        { value: 'orthographic', label: 'Orthographic' }
      ],
      default: 'mercator'
    }
  ]
}

const defaultColorsCard: FormatCardDef = {
  object: 'defaultColors',
  displayName: 'Default colors',
  properties: [
    { name: 'defaultColor', displayName: 'Blank area color', type: 'color', default: '#E6E6E6' },
    { name: 'borderColor', displayName: 'Border color', type: 'color', default: '#FFFFFF' },
    { name: 'borderThickness', displayName: 'Border thickness', type: 'integer', min: 0, max: 10, default: 1 }
  ]
}

const shapeZoomCard: FormatCardDef = {
  object: 'zoom',
  displayName: 'Zoom',
  properties: [
    { name: 'manualZoom', displayName: 'Manual zoom', type: 'bool', default: true },
    { name: 'zoomButtonsVisible', displayName: 'Zoom buttons', type: 'bool', default: false }
  ]
}

const shapeLabelsCard: FormatCardDef = {
  object: 'labels',
  displayName: 'Data labels',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: false },
    { name: 'color', displayName: 'Color', type: 'color', default: PBI.dataLabelColor },
    { name: 'fontSize', displayName: 'Text size', type: 'fontSize', default: 9 }
  ]
}

const location: DataRoleDef = { name: 'Category', displayName: 'Location', kind: 'grouping', drillable: true }
const legend: DataRoleDef = { name: 'Series', displayName: 'Legend', kind: 'grouping', max: 1 }
const tooltips: DataRoleDef = { name: 'Tooltips', displayName: 'Tooltips', kind: 'measure' }

const SPECS: Array<{ type: MapKind; displayName: string; roles: DataRoleDef[]; cards: FormatCardDef[] }> = [
  {
    type: 'map',
    displayName: 'Map',
    roles: [
      location,
      legend,
      { name: 'Y', displayName: 'Latitude', kind: 'both', max: 1 },
      { name: 'X', displayName: 'Longitude', kind: 'both', max: 1 },
      { name: 'Size', displayName: 'Bubble size', kind: 'measure', max: 1 },
      tooltips
    ],
    cards: [mapStylesCard, mapControlsCard, legendCard(), bubblesCard, dataColorsCard('Bubble colors'), categoryLabelsCard]
  },
  {
    type: 'filledMap',
    displayName: 'Filled map',
    roles: [
      location,
      legend,
      { name: 'Y', displayName: 'Latitude', kind: 'both', max: 1 },
      { name: 'X', displayName: 'Longitude', kind: 'both', max: 1 },
      // legacy "Color saturation" well (still honored when present in older reports)
      { name: 'Size', displayName: 'Color saturation', kind: 'measure', max: 1 },
      tooltips
    ],
    cards: [mapStylesCard, mapControlsCard, legendCard(), dataColorsCard('Fill colors'), categoryLabelsCard]
  },
  {
    type: 'shapeMap',
    displayName: 'Shape map',
    roles: [location, legend, { name: 'Values', displayName: 'Color saturation', kind: 'measure', max: 1 }, tooltips],
    cards: [shapeCard, legendCard(), dataColorsCard('Fill colors'), defaultColorsCard, shapeLabelsCard, shapeZoomCard]
  },
  {
    type: 'azureMap',
    displayName: 'Azure map',
    roles: [
      location,
      legend,
      { name: 'Y', displayName: 'Latitude', kind: 'both', max: 1 },
      { name: 'X', displayName: 'Longitude', kind: 'both', max: 1 },
      { name: 'Size', displayName: 'Size', kind: 'measure', max: 1 },
      tooltips
    ],
    cards: [azureStylesCard, mapControlsCard, legendCard(), bubbleLayerCard, dataColorsCard('Bubble colors'), categoryLabelsCard]
  }
]

export function registerMapVisuals(): void {
  for (const spec of SPECS) {
    const icon = ICONS[spec.type]
    const kind = spec.type
    const Component = (props: VisualProps) => <MapChart {...props} kind={kind} icon={icon} />
    const def: VisualDefinition = {
      type: spec.type,
      displayName: spec.displayName,
      category: 'map',
      icon,
      roles: spec.roles,
      formatCards: spec.cards,
      component: Component,
      inGallery: true,
      supportsHighlight: true,
      supportsDrill: true,
      defaultSize: { width: 400, height: 300 },
      getData(visual, ctx) {
        const d = deriveMapQuery(visual.json, kind)
        const fmt = new FormatReader(d.json, ctx.theme)
        return categoricalTable(buildCategorical(d.json, ctx, { seriesRole: 'Series', splitRoles: d.valueRoles, unsplitRoles: d.coordRoles, fmt }))
      }
    }
    registerVisual(def)
  }
}

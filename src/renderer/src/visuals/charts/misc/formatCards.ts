/**
 * Format-pane cards for the decomposition tree, key influencers and narrative visuals. Object and
 * property names are Power BI's (report theme schema `visualStyles.<visualType>`), so PBIR files and
 * custom themes written by Power BI Desktop resolve unchanged.
 */
import type { FormatCardDef, FormatPropDef } from '../../contract'
import { DISPLAY_UNIT_OPTIONS } from '../../common/units'

const fontProps = (prefix: string, defaults: { size: number; color: string; bold?: boolean }): FormatPropDef[] => [
  { name: `${prefix}FontFamily`, displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
  { name: `${prefix}FontSize`, displayName: 'Font size', type: 'fontSize', default: defaults.size, min: 8, max: 60 },
  { name: `${prefix}Bold`, displayName: 'Bold', type: 'bool', default: defaults.bold ?? false },
  { name: `${prefix}Italic`, displayName: 'Italic', type: 'bool', default: false },
  { name: `${prefix}Underline`, displayName: 'Underline', type: 'bool', default: false },
  { name: `${prefix}FontColor`, displayName: 'Color', type: 'color', default: defaults.color }
]

/** Decomposition tree defaults (Power BI Desktop look). */
export const DECOMP_DEFAULTS = {
  barsPerLevel: 10,
  connectorDefaultColor: '#E1DFDD',
  dataBarBackgroundColor: '#E6E6E6',
  negativeBarColor: '#D64550',
  dataBarWidthPercent: 100,
  categoryLabelFontSize: 9,
  categoryLabelFontColor: '#252423',
  dataLabelFontSize: 9,
  dataLabelFontColor: '#605E5C',
  levelTitleFontSize: 10,
  levelTitleFontColor: '#252423',
  levelSubtitleFontSize: 9,
  levelSubtitleFontColor: '#605E5C'
}

export const decompositionTreeCards: FormatCardDef[] = [
  {
    object: 'analysis',
    displayName: 'Analysis',
    properties: [
      { name: 'aiEnabled', displayName: 'Enable AI splits', type: 'bool', default: true },
      {
        name: 'aiMode',
        displayName: 'Type',
        type: 'enum',
        default: 'absolute',
        options: [
          { value: 'absolute', label: 'Absolute' },
          { value: 'relative', label: 'Relative' }
        ]
      }
    ]
  },
  {
    object: 'tree',
    displayName: 'Tree',
    properties: [
      {
        name: 'density',
        displayName: 'Density',
        type: 'enum',
        default: 'default',
        options: [
          { value: 'dense', label: 'Dense' },
          { value: 'default', label: 'Default' },
          { value: 'sparse', label: 'Sparse' }
        ]
      },
      { name: 'barsPerLevel', displayName: 'Bars per level', type: 'integer', default: DECOMP_DEFAULTS.barsPerLevel, min: 2, max: 50 },
      {
        name: 'connectorType',
        displayName: 'Connector type',
        type: 'enum',
        default: 'curve',
        options: [
          { value: 'curve', label: 'Curve' },
          { value: 'round', label: 'Round' }
        ]
      },
      { name: 'accentColor', displayName: 'Accent color', type: 'color' },
      { name: 'connectorDefaultColor', displayName: 'Connector color', type: 'color', default: DECOMP_DEFAULTS.connectorDefaultColor }
    ]
  },
  {
    object: 'dataBars',
    displayName: 'Data bars',
    properties: [
      { name: 'positiveBarColor', displayName: 'Positive bar color', type: 'color' },
      { name: 'negativeBarColor', displayName: 'Negative bar color', type: 'color', default: DECOMP_DEFAULTS.negativeBarColor },
      { name: 'dataBarBackgroundColor', displayName: 'Bar background', type: 'color', default: DECOMP_DEFAULTS.dataBarBackgroundColor },
      { name: 'dataBarWidthPercent', displayName: 'Bar width (%)', type: 'integer', default: DECOMP_DEFAULTS.dataBarWidthPercent, min: 50, max: 300 },
      {
        name: 'dataBarScalingType',
        displayName: 'Scale to',
        type: 'enum',
        default: 'levelMaximum',
        options: [
          { value: 'levelMaximum', label: 'Level maximum' },
          { value: 'parentNode', label: 'Parent node' },
          { value: 'topNode', label: 'Top node' }
        ]
      }
    ]
  },
  {
    object: 'dataLabels',
    displayName: 'Data labels',
    properties: [
      ...fontProps('dataLabel', { size: DECOMP_DEFAULTS.dataLabelFontSize, color: DECOMP_DEFAULTS.dataLabelFontColor }),
      { name: 'dataLabelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
      { name: 'dataLabelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 }
    ]
  },
  {
    object: 'categoryLabels',
    displayName: 'Category labels',
    properties: fontProps('categoryLabel', { size: DECOMP_DEFAULTS.categoryLabelFontSize, color: DECOMP_DEFAULTS.categoryLabelFontColor })
  },
  {
    object: 'levelHeader',
    displayName: 'Level header',
    properties: [
      ...fontProps('levelTitle', { size: DECOMP_DEFAULTS.levelTitleFontSize, color: DECOMP_DEFAULTS.levelTitleFontColor }).map((p) => ({ ...p, displayName: `Title ${p.displayName.toLowerCase()}` })),
      { name: 'showSubtitles', displayName: 'Show subtitles', type: 'bool', default: true },
      ...fontProps('levelSubtitle', { size: DECOMP_DEFAULTS.levelSubtitleFontSize, color: DECOMP_DEFAULTS.levelSubtitleFontColor }).map((p) => ({ ...p, displayName: `Subtitle ${p.displayName.toLowerCase()}` })),
      { name: 'levelHeaderBackgroundColor', displayName: 'Background color', type: 'color' }
    ]
  }
]

/** Key influencers defaults (Power BI keeps its own teal/slate palette, independent of the report theme). */
export const KI_DEFAULTS = {
  primaryColor: '#01B8AA',
  secondaryColor: '#374649',
  canvasColor: '#F3F2F1',
  fontColor: '#252423',
  primaryFontColor: '#FFFFFF',
  secondaryFontColor: '#252423',
  defaultColor: '#C8C6C4',
  referenceLineColor: '#FD625E'
}

export const keyInfluencersCards: FormatCardDef[] = [
  {
    object: 'keyDrivers',
    displayName: 'Analysis',
    properties: [
      {
        name: 'selectedNumericAnalysis',
        displayName: 'Analysis type',
        type: 'enum',
        default: 'Continuous',
        options: [
          { value: 'Continuous', label: 'Continuous' },
          { value: 'Categorical', label: 'Categorical' }
        ]
      },
      { name: 'allowKeyDrivers', displayName: 'Key influencers tab', type: 'bool', default: true },
      { name: 'allowProfiles', displayName: 'Top segments tab', type: 'bool', default: true },
      {
        name: 'selectedSort',
        displayName: 'Sort by',
        type: 'enum',
        default: 'impact',
        options: [
          { value: 'impact', label: 'Impact' },
          { value: 'count', label: 'Count' }
        ]
      }
    ]
  },
  {
    object: 'keyInfluencersVisual',
    displayName: 'Key influencers',
    properties: [
      { name: 'primaryColor', displayName: 'Selected color', type: 'color', default: KI_DEFAULTS.primaryColor },
      { name: 'secondaryColor', displayName: 'Bar color', type: 'color', default: KI_DEFAULTS.secondaryColor },
      { name: 'canvasColor', displayName: 'Influencer pane background', type: 'color', default: KI_DEFAULTS.canvasColor },
      { name: 'fontColor', displayName: 'Text color', type: 'color', default: KI_DEFAULTS.fontColor },
      { name: 'primaryFontColor', displayName: 'Selected bubble text', type: 'color', default: KI_DEFAULTS.primaryFontColor },
      { name: 'secondaryFontColor', displayName: 'Bubble text', type: 'color', default: KI_DEFAULTS.secondaryFontColor }
    ]
  },
  {
    object: 'keyDriversDrillVisual',
    displayName: 'Influencer details',
    properties: [
      { name: 'defaultColor', displayName: 'Bubble color', type: 'color', default: KI_DEFAULTS.defaultColor },
      { name: 'referenceLineColor', displayName: 'Average line color', type: 'color', default: KI_DEFAULTS.referenceLineColor }
    ]
  }
]

export const narrativeCards: FormatCardDef[] = [
  {
    object: 'text',
    displayName: 'Text',
    properties: [
      { name: 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
      { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: 11, min: 8, max: 60 },
      { name: 'fontColor', displayName: 'Color', type: 'color', default: '#252423' },
      {
        name: 'textAlignment',
        displayName: 'Alignment',
        type: 'enum',
        default: 'Auto',
        options: [
          { value: 'Auto', label: 'Auto' },
          { value: 'Left', label: 'Left' },
          { value: 'Center', label: 'Center' },
          { value: 'Right', label: 'Right' }
        ]
      }
    ]
  },
  {
    object: 'userPrompt',
    displayName: 'Summary scope',
    properties: [{ name: 'useAllVisuals', displayName: 'Summarize all visuals on the page', type: 'bool', default: true }]
  }
]

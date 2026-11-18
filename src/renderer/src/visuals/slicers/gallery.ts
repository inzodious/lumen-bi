/** Dev-gallery entries for the slicer visuals (sample "Sales" model, see common/sampleData.ts). */
import { registerNonChartEntries } from '../gallery/entries-nonchart'
import type { NonChartGalleryEntry } from '../common/nonchartGallery'
import { S, proj } from '../common/sampleData'
import { listFilter, rangeFilter, relativeFilter, containsFilter, hierarchyFilter, datePresetFilter, equalsFilter, wallClockNow } from './filterModel'
import { pickerFilter, writePickerRule, type PickerRule } from './datePicker'

const lit = (v: string | number | boolean) => ({ expr: { Literal: { Value: typeof v === 'string' ? `'${v}'` : typeof v === 'number' ? `${v}D` : String(v) } } })
const color = (c: string) => ({ solid: { color: { expr: { Literal: { Value: `'${c}'` } } } } })

function slicerJson(name: string, fields: Array<[any, string]>, objects: Record<string, Record<string, any> | Array<{ selector?: any; properties: Record<string, any> }>>, filter?: any, visualType = 'slicer', extraRoles: Record<string, Array<[any, string]>> = {}): any {
  const objs: Record<string, any[]> = {}
  for (const [k, props] of Object.entries(objects)) objs[k] = Array.isArray(props) ? props : [{ properties: props }]
  if (filter) {
    objs.general ??= [{ properties: {} }]
    objs.general[0].properties.filter = { filter }
  }
  return {
    name,
    position: { x: 0, y: 0, width: 240, height: 260 },
    visual: {
      visualType,
      query: {
        queryState: {
          [visualType === 'listSlicer' ? 'Field' : 'Values']: { projections: fields.map(([f, ref]) => proj(f, ref, { active: true })) },
          ...Object.fromEntries(Object.entries(extraRoles).map(([role, fs]) => [role, { projections: fs.map(([f, ref]) => proj(f, ref)) }]))
        }
      },
      objects: objs,
      drillFilterOtherVisuals: true
    }
  }
}

const corpusHeader = {
  textSize: lit(11),
  fontFamily: { expr: { Literal: { Value: "'''Segoe UI Semibold'', wf_segoe-ui_semibold, helvetica, arial, sans-serif'" } } },
  fontColor: color('#12239E'),
  background: color('#F3F2F1'),
  text: lit('Region')
}

export const galleryEntries: NonChartGalleryEntry[] = [
  {
    id: 'slicer-basic',
    title: 'Slicer — vertical list (select all, search, multi)',
    width: 220,
    height: 250,
    visualJson: slicerJson(
      'slicer-basic',
      [[S.col('Country'), 'Sales.Country']],
      { data: { mode: lit('Basic') }, general: { selfFilterEnabled: lit(true) }, selection: { selectAllCheckboxEnabled: lit(true), singleSelect: lit(false), strictSingleSelect: lit(false) } },
      listFilter(S.col('Country'), { mode: 'include', values: ['Canada', 'Germany'] })
    )
  },
  {
    id: 'slicer-single',
    title: 'Slicer — single select (radio)',
    width: 200,
    height: 150,
    visualJson: slicerJson('slicer-single', [[S.col('Region'), 'Sales.Region']], { data: { mode: lit('Basic') }, selection: { strictSingleSelect: lit(true) } }, listFilter(S.col('Region'), { mode: 'include', values: ['Europe'] }))
  },
  {
    id: 'slicer-dropdown',
    title: 'Slicer — dropdown (styled)',
    width: 220,
    height: 70,
    visualJson: slicerJson(
      'slicer-dropdown',
      [[S.col('Region'), 'Sales.Region']],
      {
        data: { mode: lit('Dropdown') },
        header: corpusHeader,
        items: { textSize: lit(10), outlineStyle: lit(0) },
        selection: { selectAllCheckboxEnabled: lit(true), singleSelect: lit(false), strictSingleSelect: lit(false) },
        general: { selfFilterEnabled: lit(true) }
      },
      listFilter(S.col('Region'), { mode: 'include', values: ['Europe', 'Asia Pacific'] })
    )
  },
  {
    id: 'slicer-hierarchy',
    title: 'Slicer — hierarchy (Category › Subcategory, parent minus child)',
    width: 240,
    height: 230,
    visualJson: slicerJson(
      'slicer-hierarchy',
      [
        [S.col('Category'), 'Sales.Category'],
        [S.col('Subcategory'), 'Sales.Subcategory']
      ],
      { data: { mode: lit('Basic') }, items: { steppedLayoutIndentation: lit(14), expandCollapseToggleType: lit(1) }, selection: { selectAllCheckboxEnabled: lit(true), singleSelect: lit(false) } },
      hierarchyFilter([S.col('Category'), S.col('Subcategory')], { include: [['Bikes']], exclude: [['Bikes', 'Road']], inverted: false })
    )
  },
  {
    id: 'slicer-tiles',
    title: 'Slicer — horizontal tiles',
    width: 420,
    height: 60,
    visualJson: slicerJson('slicer-tiles', [[S.col('Segment'), 'Sales.Segment']], { data: { mode: lit('Basic') }, general: { orientation: lit(1) }, header: { show: lit(false) } }, listFilter(S.col('Segment'), { mode: 'include', values: ['Corporate'] }))
  },
  {
    id: 'slicer-between-num',
    title: 'Slicer — between (numeric)',
    width: 240,
    height: 110,
    visualJson: slicerJson('slicer-between-num', [[S.col('Amount'), 'Sales.Amount']], { data: { mode: lit('Between') } }, rangeFilter(S.col('Amount'), { min: 500, max: 3000 }))
  },
  {
    id: 'slicer-between-date',
    title: 'Slicer — between (dates)',
    width: 260,
    height: 110,
    visualJson: slicerJson(
      'slicer-between-date',
      [[S.col('Date'), 'Sales.Date']],
      { data: { mode: lit('Between') } },
      rangeFilter(S.col('Date'), { min: new Date(Date.UTC(2023, 3, 1)), max: new Date(Date.UTC(2024, 5, 30)) })
    )
  },
  {
    id: 'slicer-before',
    title: 'Slicer — before (date)',
    width: 220,
    height: 110,
    visualJson: slicerJson('slicer-before', [[S.col('Date'), 'Sales.Date']], { data: { mode: lit('Before') } })
  },
  {
    id: 'slicer-relative',
    title: 'Slicer — relative date (Last 3 months, calendar)',
    width: 300,
    height: 100,
    visualJson: slicerJson('slicer-relative', [[S.col('Date'), 'Sales.Date']], { data: { mode: lit('Relative') } }, relativeFilter(S.col('Date'), { anchor: 'last', n: 3, unit: 'months', calendar: true }))
  },
  {
    id: 'text-slicer',
    title: 'Text slicer (Contains)',
    width: 260,
    height: 44,
    visualJson: slicerJson(
      'text-slicer',
      [[S.col('Product'), 'Sales.Product']],
      { inputTextBox: { paddingTop: lit(5), paddingBottom: lit(5), paddingLeft: lit(5), paddingRight: lit(5), accentBarShow: lit(true), placeholder: lit('Search products'), placeholderFontSize: lit(10) } },
      containsFilter(S.col('Product'), 'jersey'),
      'textSlicer'
    )
  },
  {
    id: 'button-slicer',
    title: 'Button slicer (advancedSlicerVisual)',
    width: 420,
    height: 110,
    visualJson: slicerJson(
      'button-slicer',
      [[S.col('Category'), 'Sales.Category']],
      { layout: { columnCount: lit(3), cellPadding: lit(6) }, selection: { singleSelect: lit(true) } },
      listFilter(S.col('Category'), { mode: 'include', values: ['Bikes'] }),
      'advancedSlicerVisual'
    )
  }
]

const hover = { id: 'interaction:hover' }
const selected = { id: 'selection:selected' }

/** Phase 2: dropdown extras, date presets, value counts / sorts, What-if single value, button slicer layouts. */
galleryEntries.push(
  {
    id: 'slicer-dropdown-chips',
    title: 'Dropdown — removable chips + clear button (Lumen options)',
    width: 260,
    height: 90,
    visualJson: slicerJson(
      'slicer-dropdown-chips',
      [[S.col('Country'), 'Sales.Country']],
      { data: { mode: lit('Dropdown') }, general: { selfFilterEnabled: lit(true) }, selection: { singleSelect: lit(false) }, lumenSlicer: { summary: lit('chips'), clearButton: lit(true), showCounts: lit(true) } },
      listFilter(S.col('Country'), { mode: 'include', values: ['Canada', 'Germany', 'Japan'] })
    )
  },
  {
    id: 'slicer-dropdown-list-summary',
    title: 'Dropdown — "A, B +2" summary, accent bar, rounded',
    width: 240,
    height: 64,
    visualJson: slicerJson(
      'slicer-dropdown-list-summary',
      [[S.col('Country'), 'Sales.Country']],
      {
        data: { mode: lit('Dropdown') },
        dropdown: { accentBarShow: lit(true), accentBarColor: color('#118DFF'), borderRadius: lit(4) },
        lumenSlicer: { summary: lit('list'), clearButton: lit(true) }
      },
      listFilter(S.col('Country'), { mode: 'include', values: ['Canada', 'France', 'India', 'Spain'] })
    )
  },
  {
    id: 'slicer-counts-sorted',
    title: 'List — value counts, sorted by count, selected first',
    width: 240,
    height: 250,
    visualJson: slicerJson(
      'slicer-counts-sorted',
      [[S.col('Product'), 'Sales.Product']],
      { selection: { singleSelect: lit(false) }, lumenSlicer: { showCounts: lit(true), sort: lit('countDesc'), selectedFirst: lit(true) } },
      listFilter(S.col('Product'), { mode: 'include', values: ['Beam 2000', 'Team Jersey'] })
    )
  },
  {
    id: 'slicer-measure-sort',
    title: 'List — sorted by a measure (Total Sales, high to low)',
    width: 220,
    height: 200,
    visualJson: slicerJson('slicer-measure-sort', [[S.col('Country'), 'Sales.Country']], { lumenSlicer: { sort: lit('measureDesc'), sortMeasure: lit('_m[Total Sales]') } })
  },
  {
    id: 'slicer-date-presets',
    title: 'Between dates — presets (Year to date active)',
    width: 330,
    height: 190,
    visualJson: slicerJson('slicer-date-presets', [[S.col('Date'), 'Sales.Date']], { data: { mode: lit('Between') }, lumenSlicer: { datePresets: lit(true) } }, datePresetFilter(S.col('Date'), 'ytd'))
  },
  {
    id: 'slicer-relative-excl-today',
    title: 'Relative date — Last 30 days, include today off',
    width: 300,
    height: 100,
    visualJson: slicerJson('slicer-relative-excl-today', [[S.col('Date'), 'Sales.Date']], { data: { mode: lit('Relative') }, dateRange: { includeToday: lit(false) } }, relativeFilter(S.col('Date'), { anchor: 'last', n: 30, unit: 'days', calendar: false, includeToday: false }))
  },
  {
    id: 'slicer-single-value',
    title: 'Single value slider (What-if style), styled handle',
    width: 240,
    height: 100,
    visualJson: slicerJson('slicer-single-value', [[S.col('Quantity'), 'Sales.Quantity']], { data: { mode: lit('Single') }, slider: { color: color('#118DFF'), handleFillColor: color('#118DFF'), handleBorderColor: color('#FFFFFF'), handleSize: lit(14) } }, equalsFilter(S.col('Quantity'), 3))
  },
  {
    id: 'list-slicer-dropdown-pills',
    title: 'List slicer (new) — dropdown with selection pills',
    width: 260,
    height: 70,
    visualJson: slicerJson('list-slicer-dropdown-pills', [[S.col('Segment'), 'Sales.Segment']], { data: { dropdownMode: lit(true) }, selection: { singleSelect: lit(false) } }, listFilter(S.col('Segment'), { mode: 'include', values: ['Consumer', 'Corporate'] }), 'listSlicer')
  },
  {
    id: 'button-slicer-label-accent',
    title: 'Button slicer — Label measure, accent bar, selection icon, hover state',
    width: 460,
    height: 130,
    visualJson: slicerJson(
      'button-slicer-label-accent',
      [[S.col('Region'), 'Sales.Region']],
      {
        layout: { columnCount: lit(3) },
        accentBar: [{ properties: { show: lit(false) } }, { selector: selected, properties: { show: lit(true), color: color('#118DFF') } }],
        selectionIcon: { show: lit(true) },
        fillCustom: [{ properties: { fillColor: color('#FFFFFF') } }, { selector: hover, properties: { fillColor: color('#F3F2F1') } }, { selector: selected, properties: { fillColor: color('#EAF4FF') } }],
        selection: { singleSelect: lit(true) }
      },
      listFilter(S.col('Region'), { mode: 'include', values: ['Europe'] }),
      'advancedSlicerVisual',
      { Data: [[S.m('Total Sales'), '_m.Total Sales']] }
    )
  },
  {
    id: 'button-slicer-images',
    title: 'Button slicer — images from a field (left), vertical',
    width: 220,
    height: 200,
    visualJson: slicerJson(
      'button-slicer-images',
      [[S.col('Category'), 'Sales.Category']],
      { layout: { orientation: lit('vertical') }, image: [{ properties: { show: lit(true), sourceType: lit('field'), field: { expr: S.col('ProductImage') }, imageAreaSize: lit(30) } }], value: { horizontalAlignment: lit('left') } },
      undefined,
      'advancedSlicerVisual'
    )
  },
  {
    id: 'button-slicer-paginate',
    title: 'Button slicer — 3 × 2 grid, pagination, Force selection',
    width: 420,
    height: 150,
    visualJson: slicerJson(
      'button-slicer-paginate',
      [[S.col('Product'), 'Sales.Product']],
      { layout: { columnCount: lit(3), rowCount: lit(2), columnPadding: lit(6), rowPadding: lit(6) }, overFlow: { overFlowStyle: lit(1) }, selection: { strictSingleSelect: lit(true) } },
      listFilter(S.col('Product'), { mode: 'include', values: ['Aero 700'] }),
      'advancedSlicerVisual'
    )
  },
  {
    id: 'button-slicer-horizontal',
    title: 'Button slicer — horizontal, fixed size, scroll, Select all',
    width: 460,
    height: 64,
    visualJson: slicerJson(
      'button-slicer-horizontal',
      [[S.col('Segment'), 'Sales.Segment']],
      { layout: { orientation: lit('horizontal'), showFixedSize: lit(true), fixedWidth: lit(110), fixedHeight: lit(40) }, selection: { selectAllCheckboxEnabled: lit(true), singleSelect: lit(false) }, shapeCustomRectangle: { rectangleRoundedCurve: lit(16) } },
      undefined,
      'advancedSlicerVisual'
    )
  }
)

/**
 * Date picker style (`data.mode = 'RelativeDatePicker'`). The sample model's dates span 2023–2024; the anchors
 * below are close to its first/last date and the slicer re-resolves First/Last-date rules against the data.
 * `__lumenGalleryOpen` (gallery-only, not PBIR) opens the flyout for captures.
 */
function datePickerJson(name: string, rule: PickerRule | undefined, objects: Record<string, Record<string, any>> = {}, open?: 'manual' | 'relative'): any {
  const field = S.col('Date')
  const filter = pickerFilter(field, rule, { first: new Date(Date.UTC(2023, 0, 1)), last: new Date(Date.UTC(2024, 11, 28)) }, wallClockNow())
  const j = slicerJson(name, [[field, 'Sales.Date']], { data: { mode: lit('RelativeDatePicker') }, ...objects }, filter)
  writePickerRule(j, rule)
  if (open) j.__lumenGalleryOpen = open
  return j
}

galleryEntries.push(
  {
    id: 'slicer-datepicker-relative',
    title: 'Date picker — last 2 calendar months, offset -1, from last date',
    width: 300,
    height: 110,
    visualJson: datePickerJson('slicer-datepicker-relative', { kind: 'relative', range: 'last', n: 2, unit: 'months', calendar: true, anchor: 'last', offset: -1 })
  },
  {
    id: 'slicer-datepicker-manual',
    title: 'Date picker — manual range',
    width: 300,
    height: 90,
    visualJson: datePickerJson('slicer-datepicker-manual', { kind: 'manual', start: new Date(Date.UTC(2024, 3, 14)), end: new Date(Date.UTC(2024, 3, 24)) })
  },
  {
    id: 'slicer-datepicker-today',
    title: 'Date picker — last 30 days from today (outside the data: indicator)',
    width: 300,
    height: 110,
    visualJson: datePickerJson('slicer-datepicker-today', { kind: 'relative', range: 'last', n: 30, unit: 'days', calendar: false, anchor: 'today', offset: 0 })
  },
  {
    id: 'slicer-datepicker-unfiltered',
    title: 'Date picker — no selection, single date, styled button',
    width: 300,
    height: 90,
    visualJson: datePickerJson('slicer-datepicker-unfiltered', undefined, {
      selection: { singleDate: lit(true) },
      calendarButton: { backgroundShow: lit(true), backgroundColor: color('#E6F2F0'), strokeColor: color('#377666'), iconColor: color('#377666') }
    })
  },
  {
    id: 'slicer-datepicker-open-manual',
    title: 'Date picker — flyout, Manual tab',
    width: 300,
    height: 470,
    visualJson: datePickerJson('slicer-datepicker-open-manual', { kind: 'manual', start: new Date(Date.UTC(2024, 3, 14)), end: new Date(Date.UTC(2024, 3, 24)) }, {}, 'manual')
  },
  {
    id: 'slicer-datepicker-open-relative',
    title: 'Date picker — flyout, Relative tab',
    width: 300,
    height: 380,
    visualJson: datePickerJson('slicer-datepicker-open-relative', { kind: 'relative', range: 'last', n: 1, unit: 'months', calendar: false, anchor: 'last', offset: 0 }, {}, 'relative')
  }
)

registerNonChartEntries('Slicers', galleryEntries)

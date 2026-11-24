/**
 * Design kit: a theme and visual builders bound to one template's tokens, so a design file only says
 * where things go and how they differ from the template's defaults.
 *
 * tokens: { bg, ink, muted, grid, colors[], fontBody, fontHead, fontNum, tableHead?, tableRow? }
 */
import { c, group, image, props, shape, textbox, visual } from './lib.mjs'

const sel = { $selector: { id: 'default' } }

/** Power BI font value for a family name (PBI writes the face then its web-font fallbacks). */
export function pbiFont(name) {
  return name.includes(',') ? name : `'${name}'`
}

export function themeOf(t) {
  const solid = (color) => ({ solid: { color } })
  return {
    dataColors: t.colors,
    background: t.bg,
    foreground: t.ink,
    tableAccent: t.colors[0],
    good: t.good ?? t.colors[1],
    bad: t.bad ?? t.colors[2],
    neutral: t.muted,
    maximum: t.colors[0],
    center: t.colors[1] ?? t.colors[0],
    minimum: t.bg,
    foregroundNeutralSecondary: t.muted,
    foregroundNeutralTertiary: t.grid,
    backgroundLight: t.grid,
    backgroundNeutral: t.grid,
    textClasses: {
      callout: { fontSize: 28, fontFace: t.fontNum ?? t.fontHead, color: t.ink },
      title: { fontSize: 11, fontFace: t.fontHead, color: t.ink },
      header: { fontSize: 11, fontFace: t.fontHead, color: t.ink },
      label: { fontSize: 9, fontFace: t.fontBody, color: t.muted }
    },
    visualStyles: {
      '*': {
        '*': {
          background: [{ show: false }],
          border: [{ show: false }],
          visualHeader: [{ show: false }],
          dropShadow: [{ show: false }],
          title: [{ fontFamily: t.fontHead, fontColor: solid(t.ink), fontSize: 11 }],
          categoryAxis: [{ labelColor: solid(t.muted), fontFamily: t.fontBody, fontSize: 8, showAxisTitle: false, gridlineShow: false }],
          valueAxis: [{ labelColor: solid(t.muted), fontFamily: t.fontBody, fontSize: 8, showAxisTitle: false, gridlineColor: solid(t.grid), gridlineStyle: 'dotted' }],
          legend: [{ labelColor: solid(t.muted), fontFamily: t.fontBody, fontSize: 8, position: 'Top' }],
          labels: [{ color: solid(t.ink), fontFamily: t.fontBody, fontSize: 8 }],
          outspacePane: [{ backgroundColor: solid(t.bg), foregroundColor: solid(t.ink), titleSize: 11, headerSize: 10, fontFamily: t.fontBody }]
        }
      },
      page: { '*': { background: [{ transparency: 0 }] } }
    }
  }
}

/** dataPoint entries coloring each value of a column: `colorMap(col('T', 'Orbit'), { LEO: '#0ff' })`. */
export function colorMap(field, map, { all = false } = {}) {
  const entries = Object.entries(map).map(([value, color]) => ({
    fill: c(color),
    $selector: { data: [{ scopeId: { Comparison: { ComparisonKind: 0, Left: { Column: { Expression: { SourceRef: { Entity: field.entity } }, Property: field.prop } }, Right: { Literal: { Value: `'${value.replace(/'/g, "''")}'` } } } } }] }
  }))
  return all ? [{ showAllDataPoints: true }, ...entries] : entries
}

export function kit(seed, t) {
  const font = (f) => f ?? t.fontBody
  const axisOff = { show: false }
  const chartBase = (o = {}) => ({
    categoryAxis: { show: o.xAxis !== false, ...(o.scalar ? { axisType: 'Scalar' } : {}), labelColor: c(o.axisColor ?? t.muted), fontFamily: t.fontBody, fontSize: o.axisSize ?? 8, showAxisTitle: false, gridlineShow: false },
    valueAxis:
      o.yAxis === false
        ? { show: false, gridlineShow: o.grid !== false, gridlineColor: c(t.grid), gridlineStyle: o.gridStyle ?? 'dotted' }
        : { show: true, labelColor: c(o.axisColor ?? t.muted), fontFamily: t.fontBody, fontSize: o.axisSize ?? 8, showAxisTitle: false, gridlineShow: o.grid !== false, gridlineColor: c(t.grid), gridlineStyle: o.gridStyle ?? 'dotted' },
    legend: o.legend ? { show: true, position: o.legend, labelColor: c(o.axisColor ?? t.muted), fontFamily: t.fontBody, fontSize: 8 } : { show: false }
  })
  const seriesColors = (fields, colors) => (colors ? fields.map((f, i) => ({ fill: c(colors[i]), $selector: { metadata: `${f.entity}.${f.prop}` } })) : undefined)
  const catColors = (colors) => colors?.map((cc) => ({ fill: c(cc) }))

  return {
    text: (spec) => textbox(seed, spec),
    img: (spec) => image(seed, spec),
    shape: (spec) => shape(seed, spec),
    raw: (spec) => visual(seed, spec),
    group: (spec, children) => group(seed, spec, children),

    /** Big number (new card visual), left / center / right aligned, optional label under it. */
    card: (spec) =>
      visual(seed, {
        ...spec,
        type: 'cardVisual',
        roles: { Data: [spec.field] },
        objects: {
          fillCustom: { show: false },
          outline: { show: false, ...sel },
          padding: { paddingSelection: 'Narrow', ...sel },
          value: { fontSize: spec.size ?? 28, fontFamily: pbiFont(font(spec.font ?? t.fontNum)), fontColor: c(spec.color ?? t.ink), horizontalAlignment: spec.align ?? 'left', bold: spec.bold ?? false, italic: spec.italic ?? false, labelDisplayUnits: spec.units ?? 1, ...(spec.wrap ? { textWrap: true } : {}), ...sel },
          label: spec.label
            ? { show: true, fontSize: spec.labelSize ?? 9, fontFamily: pbiFont(font(spec.labelFont)), fontColor: c(spec.labelColor ?? t.muted), horizontalAlignment: spec.align ?? 'left', position: spec.labelPosition ?? 'belowValue', ...sel }
            : { show: false, ...sel },
          layout: { alignment: spec.vAlign ?? 'middle' },
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    /** Legacy card (centered value + category label). */
    bigNumber: (spec) =>
      visual(seed, {
        ...spec,
        type: 'card',
        roles: { Values: [spec.field] },
        objects: {
          labels: { labelDisplayUnits: spec.units ?? 1, color: c(spec.color ?? t.ink), fontSize: spec.size ?? 28, fontFamily: font(spec.font ?? t.fontNum), bold: spec.bold ?? false, italic: spec.italic ?? false },
          categoryLabels: spec.label === false ? { show: false } : { show: true, color: c(spec.labelColor ?? t.muted), fontSize: spec.labelSize ?? 9, fontFamily: font(spec.labelFont) },
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    line: (spec) =>
      visual(seed, {
        ...spec,
        type: spec.area ? (spec.stacked ? 'stackedAreaChart' : 'areaChart') : 'lineChart',
        roles: { Category: [spec.cat], Y: spec.val, ...(spec.series ? { Series: [spec.series] } : {}) },
        objects: {
          ...chartBase(spec),
          lineStyles: { strokeWidth: spec.width ?? 2, showMarker: spec.markers ?? false, ...(spec.smooth ? { lineChartType: 'smooth' } : {}), ...(spec.markers ? { markerSize: spec.markerSize ?? 4 } : {}) },
          ...(spec.colors ? { dataPoint: seriesColors(spec.val, spec.colors) } : {}),
          ...(spec.colorMap && spec.series ? { dataPoint: colorMap(spec.series, spec.colorMap) } : {}),
          ...(spec.labels ? { labels: { show: true, color: c(spec.labelColor ?? t.ink), fontSize: spec.labelSize ?? 8, fontFamily: t.fontBody } } : {}),
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    column: (spec) =>
      visual(seed, {
        ...spec,
        type: spec.horizontal ? (spec.stacked ? (spec.pct ? 'hundredPercentStackedBarChart' : 'barChart') : 'clusteredBarChart') : spec.stacked ? (spec.pct ? 'hundredPercentStackedColumnChart' : 'columnChart') : 'clusteredColumnChart',
        roles: { Category: [spec.cat], Y: spec.val, ...(spec.series ? { Series: [spec.series] } : {}) },
        sort: spec.sort,
        objects: {
          ...chartBase(spec),
          ...(spec.colorMap ? { dataPoint: colorMap(spec.series ?? spec.cat, spec.colorMap, { all: !spec.series }) } : {}),
          ...(spec.colors && !spec.colorMap ? { dataPoint: spec.series ? undefined : spec.val.length > 1 ? seriesColors(spec.val, spec.colors) : [{ fill: c(spec.colors[0]) }] } : {}),
          ...(spec.labels ? { labels: { show: true, color: c(spec.labelColor ?? t.ink), fontSize: spec.labelSize ?? 8, fontFamily: t.fontBody, ...(spec.labelPos ? { labelPosition: spec.labelPos } : {}) } } : {}),
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    combo: (spec) =>
      visual(seed, {
        ...spec,
        type: 'lineClusteredColumnComboChart',
        roles: { Category: [spec.cat], Y: spec.columns, Y2: spec.lines },
        objects: {
          ...chartBase(spec),
          valueAxis: { ...chartBase(spec).valueAxis, secShowAxisTitle: false, secShow: spec.secondAxis ?? true },
          lineStyles: { strokeWidth: spec.width ?? 2, showMarker: spec.markers ?? true, markerSize: 4 },
          ...(spec.colors ? { dataPoint: seriesColors([...spec.columns, ...spec.lines], spec.colors) } : {}),
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    donut: (spec) =>
      visual(seed, {
        ...spec,
        type: spec.pie ? 'pieChart' : 'donutChart',
        roles: { Category: [spec.cat], Y: [spec.val] },
        objects: {
          legend: spec.legend ? { show: true, position: spec.legend, labelColor: c(t.muted), fontFamily: t.fontBody, fontSize: 8 } : { show: false },
          labels: spec.labels === false ? { show: false } : { show: true, color: c(spec.labelColor ?? t.ink), fontSize: spec.labelSize ?? 8, fontFamily: t.fontBody, labelStyle: spec.labelStyle ?? 'Category', percentageLabelPrecision: 0 },
          ...(spec.innerRadius ? { slices: { innerRadiusRatio: spec.innerRadius } } : {}),
          ...(spec.colorMap ? { dataPoint: colorMap(spec.cat, spec.colorMap) } : {}),
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    table: (spec) =>
      visual(seed, {
        ...spec,
        type: 'tableEx',
        roles: { Values: spec.fields },
        sort: spec.sort,
        objects: {
          grid: { gridVertical: false, gridHorizontal: spec.hlines ?? true, gridHorizontalColor: c(spec.lineColor ?? t.grid), rowPadding: spec.rowPadding ?? 4, outlineColor: c(spec.lineColor ?? t.grid), textSize: spec.size ?? 9 },
          columnHeaders: { fontColor: c(spec.headColor ?? t.muted), backColor: c(spec.headBg ?? t.bg), fontFamily: font(spec.headFont), fontSize: spec.headSize ?? 8, bold: spec.headBold ?? true, ...(spec.headAlign ? { alignment: spec.headAlign } : {}) },
          values: { fontColorPrimary: c(spec.color ?? t.ink), backColorPrimary: c(spec.rowBg ?? t.bg), fontColorSecondary: c(spec.color ?? t.ink), backColorSecondary: c(spec.rowAlt ?? spec.rowBg ?? t.bg), fontFamily: font(spec.font), fontSize: spec.size ?? 9 },
          total: { totals: spec.totals ?? false, fontColor: c(t.ink), backColor: c(spec.rowBg ?? t.bg), fontFamily: font(spec.headFont) },
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    slicer: (spec) =>
      visual(seed, {
        ...spec,
        type: 'slicer',
        roles: { Values: [spec.field] },
        objects: {
          data: { mode: spec.mode ?? 'Dropdown' },
          header: spec.header === false ? { show: false } : { show: true, text: spec.header ?? spec.field.prop, fontColor: c(spec.headColor ?? t.muted), fontFamily: font(spec.headFont), textSize: spec.headSize ?? 8, outline: 'None' },
          items: { fontColor: c(spec.color ?? t.ink), background: c(spec.itemBg ?? t.bg), fontFamily: font(spec.font), textSize: spec.size ?? 9, outline: spec.outline ?? 'None', ...(spec.outlineColor ? { outlineColor: c(spec.outlineColor) } : {}) },
          ...(spec.mode === 'Basic' && spec.horizontal ? { general: { orientation: 1 }, selection: { singleSelect: spec.single ?? false, strictSingleSelect: false } } : {}),
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    gauge: (spec) =>
      visual(seed, {
        ...spec,
        type: 'gauge',
        roles: { Y: [spec.value], ...(spec.max ? { MaxValue: [spec.max] } : {}), ...(spec.target ? { TargetValue: [spec.target] } : {}) },
        objects: {
          dataPoint: { fill: c(spec.fill ?? t.colors[0]), target: c(spec.targetColor ?? t.ink), ...(spec.track ? {} : {}) },
          axis: { ...(spec.min !== undefined ? { min: spec.min } : {}), ...(spec.maxValue !== undefined ? { max: spec.maxValue } : {}) },
          labels: { show: spec.axisLabels ?? false, color: c(t.muted), fontSize: 8 },
          calloutValue: { show: spec.callout ?? true, color: c(spec.calloutColor ?? t.ink), fontSize: spec.calloutSize ?? 20, fontFamily: font(spec.calloutFont ?? t.fontNum) },
          target: { show: !!spec.target, color: c(t.muted) },
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    scatter: (spec) =>
      visual(seed, {
        ...spec,
        type: 'scatterChart',
        roles: { Category: [spec.details], X: [spec.xm], Y: [spec.ym], ...(spec.size ? { Size: [spec.size] } : {}), ...(spec.series ? { Series: [spec.series] } : {}) },
        objects: {
          ...chartBase(spec),
          categoryAxis: { show: true, labelColor: c(t.muted), fontFamily: t.fontBody, fontSize: 8, showAxisTitle: spec.axisTitles ?? false, gridlineShow: false, titleColor: c(t.muted) },
          ...(spec.colors ? { dataPoint: [{ fill: c(spec.colors[0]) }] } : {}),
          ...(spec.labels ? { categoryLabels: { show: true, color: c(spec.labelColor ?? t.ink), fontSize: 8, fontFamily: t.fontBody } } : {}),
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    treemap: (spec) =>
      visual(seed, {
        ...spec,
        type: 'treemap',
        roles: { Group: [spec.cat], Values: [spec.val] },
        objects: {
          legend: { show: false },
          labels: { show: true, color: c(spec.labelColor ?? '#FFFFFF'), fontSize: spec.labelSize ?? 9, fontFamily: t.fontBody },
          categoryLabels: { show: true, color: c(spec.labelColor ?? '#FFFFFF'), fontSize: spec.labelSize ?? 9, fontFamily: t.fontBody },
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    funnel: (spec) =>
      visual(seed, {
        ...spec,
        type: 'funnel',
        roles: { Category: [spec.cat], Y: [spec.val] },
        objects: {
          categoryAxis: { show: true, color: c(spec.axisColor ?? t.muted), fontFamily: t.fontBody, fontSize: 9 },
          labels: { show: true, color: c(spec.labelColor ?? '#FFFFFF'), fontSize: 9, fontFamily: t.fontBody },
          dataPoint: { fill: c(spec.fill ?? t.colors[0]) },
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    waterfall: (spec) =>
      visual(seed, {
        ...spec,
        type: 'waterfallChart',
        roles: { Category: [spec.cat], Y: [spec.val] },
        objects: {
          ...chartBase(spec),
          sentimentColors: { increaseFill: c(spec.up ?? t.colors[1]), decreaseFill: c(spec.down ?? t.colors[2]), totalFill: c(spec.total ?? t.colors[0]) },
          ...(spec.labels ? { labels: { show: true, color: c(spec.labelColor ?? t.ink), fontSize: 8, fontFamily: t.fontBody } } : {}),
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    ribbon: (spec) =>
      visual(seed, {
        ...spec,
        type: 'ribbonChart',
        roles: { Category: [spec.cat], Y: [spec.val], Series: [spec.series] },
        objects: { ...chartBase(spec), ...(spec.objects ?? {}) },
        box: spec.box
      }),

    matrix: (spec) =>
      visual(seed, {
        ...spec,
        type: 'pivotTable',
        roles: { Rows: spec.rows, Columns: spec.columns ?? [], Values: spec.values },
        objects: {
          grid: { gridVertical: false, gridHorizontal: true, gridHorizontalColor: c(spec.lineColor ?? t.grid), rowPadding: spec.rowPadding ?? 4, outlineColor: c(spec.lineColor ?? t.grid), textSize: spec.size ?? 9 },
          columnHeaders: { fontColor: c(spec.headColor ?? t.muted), backColor: c(spec.headBg ?? t.bg), fontFamily: font(spec.headFont), fontSize: spec.headSize ?? 8, bold: true },
          rowHeaders: { fontColor: c(spec.color ?? t.ink), backColor: c(spec.rowBg ?? t.bg), fontFamily: font(spec.font), fontSize: spec.size ?? 9 },
          values: { fontColorPrimary: c(spec.color ?? t.ink), backColorPrimary: c(spec.rowBg ?? t.bg), fontColorSecondary: c(spec.color ?? t.ink), backColorSecondary: c(spec.rowAlt ?? spec.rowBg ?? t.bg), fontFamily: font(spec.font), fontSize: spec.size ?? 9 },
          subTotals: { rowSubtotals: spec.subtotals ?? false, columnSubtotals: spec.subtotals ?? false },
          ...(spec.objects ?? {})
        },
        box: spec.box
      }),

    /**
     * Page navigator (PBI pageNavigator): one button per visible page, the open page in its `selected` style.
     * spec: { vertical, gap, radius, font, size, color, selColor, fill, selFill, hoverFill, line, selLine, align, margin }
     */
    pageNav: (spec) => {
      const st = (id, o) => ({ ...o, $selector: { id } })
      return visual(seed, {
        ...spec,
        type: 'pageNavigator',
        objects: {
          layout: { orientation: spec.vertical === false ? 0 : 1, cellPadding: spec.gap ?? 6 },
          shape: st('default', { tileShape: 'rectangleRounded', roundEdge: spec.radius ?? 8 }),
          text: [
            st('default', { show: true, fontFamily: pbiFont(font(spec.font)), fontSize: spec.size ?? 10, fontColor: c(spec.color ?? t.muted), horizontalAlignment: spec.align ?? 'left', leftMargin: spec.margin ?? 16 }),
            st('hover', { fontColor: c(spec.hoverColor ?? spec.selColor ?? t.ink) }),
            st('selected', { fontFamily: pbiFont(font(spec.selFont ?? spec.font)), fontColor: c(spec.selColor ?? t.ink) })
          ],
          fill: [
            st('default', { show: true, fillColor: c(spec.fill ?? t.bg), transparency: spec.fillTransparency ?? 100 }),
            st('hover', { fillColor: c(spec.hoverFill ?? spec.selFill ?? t.grid), transparency: spec.hoverTransparency ?? 60 }),
            st('selected', { fillColor: c(spec.selFill ?? t.grid), transparency: spec.selTransparency ?? 0 })
          ],
          outline: [
            st('default', { show: !!spec.line, ...(spec.line ? { lineColor: c(spec.line), weight: 1 } : {}) }),
            st('selected', { show: true, lineColor: c(spec.selLine ?? spec.line ?? t.colors[0]), weight: spec.selWeight ?? 1 })
          ],
          ...(spec.objects ?? {})
        },
        box: spec.box
      })
    },

    /**
     * Action button with text (PBI actionButton). action: { type: 'PageNavigation', page } | { type: 'Bookmark', bookmark }
     * | { type: 'Drillthrough', page } | { type: 'Back' }; page and bookmark are PBIR names (pbir.mjs pageId / bookmarkId).
     */
    button: (spec) => {
      const st = (id, o) => ({ ...o, $selector: { id } })
      const a = spec.action
      const link = { show: true, type: a.type, ...(a.type === 'PageNavigation' ? { navigationSection: a.page } : {}), ...(a.type === 'Drillthrough' ? { drillthroughSection: a.page } : {}), ...(a.type === 'Bookmark' ? { bookmark: a.bookmark } : {}), ...(a.tooltip ? { tooltip: a.tooltip } : {}) }
      return visual(seed, {
        ...spec,
        type: 'actionButton',
        objects: {
          shape: st('default', { tileShape: 'rectangleRounded', roundEdge: spec.radius ?? 8 }),
          icon: st('default', { show: !!spec.icon, ...(spec.icon ? { shapeType: spec.icon, lineColor: c(spec.iconColor ?? spec.color ?? t.ink), placement: 'left' } : {}) }),
          text: [
            st('default', { show: !!spec.text, text: spec.text ?? '', fontFamily: pbiFont(font(spec.font)), fontSize: spec.size ?? 9, fontColor: c(spec.color ?? t.ink), horizontalAlignment: spec.align ?? 'center' }),
            st('hover', { fontColor: c(spec.hoverColor ?? spec.color ?? t.ink) })
          ],
          fill: [st('default', { show: true, fillColor: c(spec.fill ?? t.grid), transparency: spec.fillTransparency ?? 0 }), st('hover', { fillColor: c(spec.hoverFill ?? spec.fill ?? t.grid), transparency: 0 })],
          outline: st('default', { show: !!spec.line, ...(spec.line ? { lineColor: c(spec.line), weight: 1 } : {}) }),
          ...(spec.objects ?? {})
        },
        rawObjects: undefined,
        box: { ...(spec.box ?? {}) },
        vcoExtra: { visualLink: [{ properties: props(link) }] }
      })
    },

    axisOff
  }
}

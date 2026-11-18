/** The classic `slicer` visual: dispatches on `data.mode` / orientation / field type. */
import { useMemo } from 'react'
import { setObjectProp } from '@core/report/props'
import type { ContextMenuEntry, VisualProps } from '../contract'
import { ListSlicer, TileSlicer } from './ListSlicer'
import { RangeSlicer, RelativeSlicer } from './RangeSlicer'
import { DatePickerSlicer } from './DatePickerSlicer'
import { SlicerMessage, SlicerStyle } from './SlicerChrome'
import { currentFilter, headerText, isWhatIfColumn, slicerProjections } from './slicerData'
import { readSlicerFormat } from './slicerFormat'

export function SlicerVisual({ visual, ctx, width, height }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => readSlicerFormat(json, ctx.theme), [json, ctx.theme])
  const projs = slicerProjections(json)
  const fields = projs.map((p) => p.expr)
  const filter = currentFilter(json, ctx)
  const dataType = useMemo(() => {
    try {
      return projs[0] ? ctx.engine.describeField(projs[0].expr)?.dataType : undefined
    } catch {
      return undefined
    }
  }, [ctx.engine, projs[0] && JSON.stringify(projs[0].expr)]) // eslint-disable-line react-hooks/exhaustive-deps
  const title = headerText(ctx, projs)
  // Power BI's slicer menu entries: Search (list / dropdown slicers; saved as `general.selfFilterEnabled`) and
  // Clear selections. Shown for a right-click anywhere in the slicer; items add their own (Expand ▸ / Collapse ▸).
  const listLike = fields.length > 1 || fmt.mode === 'Basic' || fmt.mode === 'Dropdown'
  const menuEntries = (): ContextMenuEntry[] => [
    ...(listLike && fields.length ? [{ label: 'Search', checked: fmt.searchEnabled, onClick: () => ctx.updateVisual((j) => setSearchEnabled(j, !fmt.searchEnabled)) }] : []),
    {
      label: 'Clear selections',
      disabled: !filter && !fmt.inverted,
      onClick: () => {
        if (fmt.inverted) ctx.updateVisual((j) => setObjectProp(j, 'data', 'isInvertedSelectionMode', undefined))
        ctx.setSlicerFilter(undefined)
      }
    }
  ]
  let body
  if (!fields.length) body = <SlicerMessage text="Add data fields to the slicer" font={fmt.items.font} />
  else {
    const numeric = dataType === 'int64' || dataType === 'double' || dataType === 'decimal'
    const isDate = dataType === 'dateTime'
    // PBI renders What-if parameter columns as a single-value slider when the style isn't set explicitly
    const whatIf = numeric && fields.length === 1 && !hasExplicitMode(json) && safeWhatIf(ctx.engine, fields[0])
    const mode = whatIf ? 'Single' : fmt.mode
    const common = { ctx, fmt, filter, headerText: title, width, height, menuEntries }
    if (fields.length === 1 && mode === 'RelativeDatePicker' && isDate) body = <DatePickerSlicer {...common} field={fields[0]} visualJson={json} />
    else if (fields.length === 1 && (mode === 'Relative' || mode === 'RelativeTime') && isDate) body = <RelativeSlicer {...common} field={fields[0]} />
    else if (fields.length === 1 && (mode === 'Between' || mode === 'Before' || mode === 'After' || mode === 'Single') && (numeric || isDate))
      body = <RangeSlicer {...common} field={fields[0]} mode={mode} />
    else if (fmt.horizontal && fields.length === 1 && mode !== 'Dropdown') body = <TileSlicer {...common} visualJson={json} fields={fields} dropdown={false} />
    else body = <ListSlicer {...common} visualJson={json} fields={fields} dropdown={mode === 'Dropdown'} dataType={dataType} />
  }
  return (
    <div
      className="wbi-slicer-root"
      data-mode={fmt.mode}
      onContextMenu={(e) => {
        e.preventDefault()
        ctx.showContextMenu({ x: e.clientX, y: e.clientY, target: 'empty', entries: menuEntries() })
      }}
    >
      <SlicerStyle />
      {body}
    </div>
  )
}

/** More options ▸ Search: `general.selfFilterEnabled`; switching it off also drops the saved search text. */
export function setSearchEnabled(visualJson: any, on: boolean): void {
  setObjectProp(visualJson, 'general', 'selfFilterEnabled', on)
  if (on) return
  for (const e of visualJson?.visual?.objects?.general ?? []) if (e?.properties) delete e.properties.selfFilter
}

function hasExplicitMode(json: any): boolean {
  return (json?.visual?.objects?.data ?? []).some((e: any) => e?.properties?.mode !== undefined)
}

function safeWhatIf(engine: VisualProps['ctx']['engine'], field: Parameters<typeof isWhatIfColumn>[1]): boolean {
  try {
    return isWhatIfColumn(engine, field)
  } catch {
    return false
  }
}

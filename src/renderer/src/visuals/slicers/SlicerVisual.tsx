/** The classic `slicer` visual: dispatches on `data.mode` / orientation / field type. */
import { useMemo } from 'react'
import type { VisualProps } from '../contract'
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
  let body
  if (!fields.length) body = <SlicerMessage text="Add data fields to the slicer" font={fmt.items.font} />
  else {
    const numeric = dataType === 'int64' || dataType === 'double' || dataType === 'decimal'
    const isDate = dataType === 'dateTime'
    // PBI renders What-if parameter columns as a single-value slider when the style isn't set explicitly
    const whatIf = numeric && fields.length === 1 && !hasExplicitMode(json) && safeWhatIf(ctx.engine, fields[0])
    const mode = whatIf ? 'Single' : fmt.mode
    const common = { ctx, fmt, filter, headerText: title, width, height }
    if (fields.length === 1 && mode === 'RelativeDatePicker' && isDate) body = <DatePickerSlicer {...common} field={fields[0]} visualJson={json} />
    else if (fields.length === 1 && (mode === 'Relative' || mode === 'RelativeTime') && isDate) body = <RelativeSlicer {...common} field={fields[0]} />
    else if (fields.length === 1 && (mode === 'Between' || mode === 'Before' || mode === 'After' || mode === 'Single') && (numeric || isDate))
      body = <RangeSlicer {...common} field={fields[0]} mode={mode} />
    else if (fmt.horizontal && fields.length === 1 && mode !== 'Dropdown') body = <TileSlicer {...common} visualJson={json} fields={fields} dropdown={false} />
    else body = <ListSlicer {...common} visualJson={json} fields={fields} dropdown={mode === 'Dropdown'} dataType={dataType} />
  }
  return (
    <div className="wbi-slicer-root" data-mode={fmt.mode}>
      <SlicerStyle />
      {body}
    </div>
  )
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

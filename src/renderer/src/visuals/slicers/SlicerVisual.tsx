/** The classic `slicer` visual: dispatches on `data.mode` / orientation / field type. */
import { useMemo } from 'react'
import { setObjectProp } from '@core/report/props'
import type { ContextMenuEntry, VisualProps } from '../contract'
import { ListSlicer, TileSlicer } from './ListSlicer'
import { RangeSlicer, RelativeSlicer } from './RangeSlicer'
import { DatePickerSlicer } from './DatePickerSlicer'
import { SlicerHeader, SlicerMessage, SlicerStyle, StandInBadge } from './SlicerChrome'
import { ChevronDown } from './icons'
import { fontStyle, ptToPx } from '../common/textStyle'
import { currentFilter, headerText, isWhatIfColumn, slicerProjections, standInSelection } from './slicerData'
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
  if (!fields.length) body = fmt.mode === 'Dropdown' && fmt.header.text ? <EmptyDropdown fmt={fmt} /> : <SlicerMessage text="Add data fields to the slicer" font={fmt.items.font} />
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
      {standInSelection(json, ctx) && <StandInBadge />}
      {body}
    </div>
  )
}

/**
 * A dropdown slicer with no field but its own header text (a placeholder filter, e.g. in report templates):
 * draw its header and a closed, empty dropdown box so the formatting shows before a field is added.
 * Lumen-only: Power BI Desktop shows the empty-visual placeholder for any slicer without a field.
 */
function EmptyDropdown({ fmt }: { fmt: ReturnType<typeof readSlicerFormat> }) {
  const lineH = Math.ceil(ptToPx(fmt.items.font.size) * 1.36)
  return (
    <>
      <SlicerHeader
        show={fmt.header.show}
        text={fmt.header.text ?? ''}
        font={fmt.header.font}
        background={fmt.header.background}
        outline={fmt.header.outline}
        outlineColor={fmt.header.outlineColor}
        outlineWeight={fmt.header.outlineWeight}
        canClear={false}
        onClear={() => undefined}
      />
      <div
        className="wbi-slicer-ddbox"
        title="Add data fields to the slicer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: lineH + 10,
          padding: '0 6px 0 8px',
          border: `1px solid ${fmt.dropdown.borderColor}`,
          borderRadius: fmt.dropdown.radius,
          background: fmt.items.background ?? '#FFFFFF',
          flex: 'none',
          marginTop: 2,
          boxSizing: 'border-box'
        }}
      >
        <span style={{ ...fontStyle({ ...fmt.items.font, color: '#A19F9D' }), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Add a field</span>
        <ChevronDown size={Math.round(ptToPx(fmt.items.font.size) * 0.95)} color={fmt.dropdown.iconColor} style={{ flex: 'none' }} />
      </div>
    </>
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

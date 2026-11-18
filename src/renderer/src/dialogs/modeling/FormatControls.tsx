/**
 * Formatting controls (Format / currency symbol / % / thousands separator / decimal places) used in
 * the Properties pane and the Column tools / Measure tools ribbons.
 */
import type { DataType } from '@core/model/types'
import { Dropdown, NumberField, Toggle } from '../../app/ui'
import { CURRENCY_SYMBOLS, DATE_FORMATS, FORMAT_KIND_LABELS, TIME_FORMATS, buildFormatString, formatKindsFor, parseFormatString, type FormatKind, type FormatSpec } from './logic/formats'
import { TextField } from '../../app/ui'

export function FormatControls({ formatString, dataType, onChange, compact }: { formatString: string | undefined; dataType: DataType; onChange(fmt: string | undefined): void; compact?: boolean }) {
  const spec = parseFormatString(formatString, dataType)
  const kinds = formatKindsFor(dataType === 'unknown' || dataType === 'variant' ? 'double' : dataType)
  if (!kinds.includes(spec.kind)) kinds.push(spec.kind)
  const apply = (patch: Partial<FormatSpec>) => onChange(buildFormatString({ ...spec, ...patch }))
  const numericType = dataType === 'int64' || dataType === 'double' || dataType === 'decimal'
  const numeric = (spec.kind === 'general' && numericType) || spec.kind === 'decimal' || spec.kind === 'currency' || spec.kind === 'percentage' || spec.kind === 'scientific' || spec.kind === 'wholeNumber'
  const size = compact ? 'small' : 'normal'
  if (compact) return <CompactFormat spec={spec} kinds={kinds} numeric={numeric} apply={apply} formatString={formatString} onChange={onChange} />
  return (
    <div className={compact ? 'wbi-fmt wbi-fmt--compact' : 'wbi-fmt'}>
      <Dropdown
        label={compact ? undefined : 'Format'}
        size={size}
        value={spec.kind}
        options={kinds.map((k) => ({ value: k, label: FORMAT_KIND_LABELS[k] }))}
        onChange={(k: FormatKind) => apply({ kind: k, decimals: k === 'wholeNumber' ? 0 : k === 'percentage' ? Math.min(spec.decimals, 2) : spec.decimals || 2, pattern: k === 'date' ? 'Short Date' : k === 'time' ? 'Long Time' : spec.pattern, custom: formatString ?? '' })}
        title="Format"
      />
      {spec.kind === 'date' && <Dropdown size={size} label={compact ? undefined : 'Date format'} value={spec.pattern} options={withCurrent(DATE_FORMATS, spec.pattern)} onChange={(p) => apply({ pattern: p })} title="Date format" />}
      {spec.kind === 'time' && <Dropdown size={size} label={compact ? undefined : 'Time format'} value={spec.pattern} options={withCurrent(TIME_FORMATS, spec.pattern)} onChange={(p) => apply({ pattern: p })} title="Time format" />}
      {spec.kind === 'currency' && <Dropdown size={size} label={compact ? undefined : 'Currency format'} value={spec.symbol} options={CURRENCY_SYMBOLS.map((s) => ({ value: s, label: s }))} onChange={(s) => apply({ symbol: s })} title="Currency" />}
      {spec.kind === 'custom' && <TextField size={size} label={compact ? undefined : 'Custom format'} value={spec.custom} onChange={() => undefined} onCommit={(v) => onChange(v.trim() || undefined)} placeholder="#,0.00" />}
      {numeric && (
        <div className="wbi-fmt__row">
          <Toggle size="small" on={spec.kind === 'percentage'} onChange={(on) => apply({ kind: on ? 'percentage' : 'decimal' })} label="Percentage format" />
          {spec.kind !== 'scientific' && spec.kind !== 'currency' && <Toggle size="small" on={spec.thousands} onChange={(on) => apply({ thousands: on, kind: spec.kind === 'wholeNumber' ? 'wholeNumber' : spec.kind })} label="Thousands separator" />}
          {spec.kind !== 'wholeNumber' && <NumberField size={size} label={compact ? undefined : 'Decimal places'} value={spec.decimals} min={0} max={15} step={1} onChange={(v) => apply({ decimals: Math.max(0, Math.min(15, v ?? 0)) })} />}
        </div>
      )}
    </div>
  )
}

/** Ribbon layout (Column tools / Measure tools ▸ Formatting): Format ▾ on top; $ ▾ % , and decimals below. */
function CompactFormat({ spec, kinds, numeric, apply, formatString, onChange }: { spec: FormatSpec; kinds: FormatKind[]; numeric: boolean; apply(p: Partial<FormatSpec>): void; formatString: string | undefined; onChange(f: string | undefined): void }) {
  return (
    <div className="wbi-fmtc">
      <div className="wbi-fmtc__row">
        <span className="wbi-fmtc__label">Format</span>
        <Dropdown
          size="small"
          value={spec.kind === 'date' || spec.kind === 'time' ? spec.pattern : spec.kind}
          options={
            spec.kind === 'date' || spec.kind === 'time'
              ? withCurrent([...DATE_FORMATS, ...TIME_FORMATS], spec.pattern).map((d) => ({ value: d.value, label: d.label }))
              : kinds.map((k) => ({ value: k, label: FORMAT_KIND_LABELS[k] }))
          }
          onChange={(v: string) =>
            spec.kind === 'date' || spec.kind === 'time'
              ? apply({ pattern: v })
              : v === 'custom'
                ? onChange(formatString)
                : apply({ kind: v as FormatKind, decimals: v === 'wholeNumber' ? 0 : spec.decimals || 2, custom: formatString ?? '' })
          }
          title="Format"
        />
      </div>
      <div className="wbi-fmtc__row">
        <Dropdown
          size="small"
          disabled={!numeric}
          value={spec.kind === 'currency' ? spec.symbol : ''}
          options={[{ value: '', label: 'None' }, ...CURRENCY_SYMBOLS.map((c) => ({ value: c, label: c }))]}
          onChange={(c: string) => apply(c ? { kind: 'currency', symbol: c, decimals: spec.decimals } : { kind: 'decimal' })}
          renderValue={() => '$'}
          title="Apply currency format"
          className="wbi-fmtc__cur"
        />
        <button type="button" className={`wbi-fmtc__btn ${spec.kind === 'percentage' ? 'is-on' : ''}`} disabled={!numeric} title="Percentage format" onClick={() => apply({ kind: spec.kind === 'percentage' ? 'decimal' : 'percentage' })}>
          %
        </button>
        <button type="button" className={`wbi-fmtc__btn ${spec.thousands && spec.kind !== 'scientific' ? 'is-on' : ''}`} disabled={!numeric || spec.kind === 'currency' || spec.kind === 'scientific'} title="Thousands separator" onClick={() => apply({ thousands: !spec.thousands })}>
          ,
        </button>
        <span className="wbi-fmtc__dec" title="Decimal places">
          .00
          <input type="number" min={0} max={15} disabled={!numeric || spec.kind === 'wholeNumber'} value={spec.kind === 'wholeNumber' ? 0 : spec.decimals} onChange={(e) => apply({ decimals: Math.max(0, Math.min(15, Number(e.target.value) || 0)) })} aria-label="Decimal places" />
        </span>
      </div>
    </div>
  )
}

function withCurrent(list: Array<{ value: string; label: string }>, current: string) {
  return current && !list.some((d) => d.value === current) ? [...list, { value: current, label: `${current} (custom)` }] : list
}

/**
 * Power Query parameters (Manage Parameters): the query text is
 *   `"value" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`
 * optionally with `List={…}, DefaultValue=…` for "List of values". Pure helpers to read the value for
 * display and to write the expression back.
 */
import { parameterInfo } from '@core/data/queries'
import { mNumber, mText } from './mtext'
import { textLiteral } from './steps'

export type ParamType = 'Any' | 'Binary' | 'Date' | 'DateTime' | 'DateTimeZone' | 'Number' | 'Duration' | 'Text' | 'Time' | 'Logical'

export const PARAM_TYPES: Array<{ id: ParamType; label: string }> = [
  { id: 'Any', label: 'Any' },
  { id: 'Binary', label: 'Binary' },
  { id: 'Date', label: 'Date' },
  { id: 'DateTime', label: 'Date/Time' },
  { id: 'DateTimeZone', label: 'Date/Time/Timezone' },
  { id: 'Number', label: 'Decimal Number' },
  { id: 'Duration', label: 'Duration' },
  { id: 'Text', label: 'Text' },
  { id: 'Time', label: 'Time' },
  { id: 'Logical', label: 'True/False' }
]

export interface ParamSpec {
  type: ParamType
  required: boolean
  /** current value as the user types it (`abc`, `42`, `1/31/2024`, `TRUE`) */
  value: string
  /** "List of values" (as typed); empty = "Any value" */
  list?: string[]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Display text of an M literal (`"a""b"` → `a"b`, `#date(2024, 1, 31)` → `1/31/2024`). */
export function displayValue(literal: string): string {
  const t = literal.trim()
  const text = textLiteral(t)
  if (text !== null) return text
  let m = /^#date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(t)
  if (m) return `${+m[2]!}/${+m[3]!}/${+m[1]!}`
  m = /^#datetime\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(t)
  if (m) {
    const h = +m[4]!
    return `${+m[2]!}/${+m[3]!}/${+m[1]!} ${h % 12 || 12}:${pad2(+m[5]!)}:${pad2(Math.floor(+m[6]!))} ${h < 12 ? 'AM' : 'PM'}`
  }
  m = /^#time\(\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(t)
  if (m) return `${pad2(+m[1]!)}:${pad2(+m[2]!)}:${pad2(Math.floor(+m[3]!))}`
  m = /^#duration\(\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(t)
  if (m) return `${+m[1]!}.${pad2(+m[2]!)}:${pad2(+m[3]!)}:${pad2(Math.floor(+m[4]!))}`
  if (t === 'true') return 'TRUE'
  if (t === 'false') return 'FALSE'
  return t
}

/** The M literal for a value typed in Manage Parameters, per parameter type. */
export function paramLiteral(value: string, type: ParamType): string {
  const v = value.trim()
  switch (type) {
    case 'Text':
      return mText(value)
    case 'Number': {
      const n = Number(v)
      return v !== '' && Number.isFinite(n) ? mNumber(n) : 'null'
    }
    case 'Logical':
      return /^(true|1|yes)$/i.test(v) ? 'true' : /^(false|0|no)$/i.test(v) ? 'false' : 'null'
    case 'Date':
    case 'DateTime':
    case 'DateTimeZone': {
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(v)
      const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v)
      let parts: number[] | null = null
      if (us) {
        let h = us[4] ? +us[4] : 0
        if (us[7]) h = (h % 12) + (/pm/i.test(us[7]) ? 12 : 0)
        parts = [+us[3]!, +us[1]!, +us[2]!, h, us[5] ? +us[5] : 0, us[6] ? +us[6] : 0]
      } else if (iso) parts = [+iso[1]!, +iso[2]!, +iso[3]!, iso[4] ? +iso[4] : 0, iso[5] ? +iso[5] : 0, iso[6] ? +iso[6] : 0]
      if (!parts) return v ? mText(value) : 'null'
      if (type === 'Date') return `#date(${parts[0]}, ${parts[1]}, ${parts[2]})`
      if (type === 'DateTime') return `#datetime(${parts.join(', ')})`
      return `#datetimezone(${parts.join(', ')}, 0, 0)`
    }
    case 'Time': {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v)
      return m ? `#time(${+m[1]!}, ${+m[2]!}, ${m[3] ? +m[3] : 0})` : 'null'
    }
    case 'Duration': {
      const m = /^(?:(-?\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v)
      return m ? `#duration(${m[1] ? +m[1] : 0}, ${+m[2]!}, ${+m[3]!}, ${m[4] ? +m[4] : 0})` : 'null'
    }
    default: {
      // Any / Binary: numbers stay numbers, everything else is text
      if (v !== '' && Number.isFinite(Number(v))) return mNumber(Number(v))
      return mText(value)
    }
  }
}

/** The parameter expression Power Query writes. */
export function parameterExpression(p: ParamSpec): string {
  const list = p.list?.filter((x) => x.trim() !== '')
  const meta = ['IsParameterQuery=true']
  if (list?.length) {
    meta.push(`List={${list.map((x) => paramLiteral(x, p.type)).join(', ')}}`)
    meta.push(`DefaultValue=${paramLiteral(p.value || list[0]!, p.type)}`)
  }
  meta.push(`Type=${mText(p.type)}`)
  meta.push(`IsParameterQueryRequired=${p.required ? 'true' : 'false'}`)
  return `${paramLiteral(p.value, p.type)} meta [${meta.join(', ')}]`
}

/** Reads a parameter query back into the dialog's fields (null when the text isn't a parameter). */
export function readParameter(source: string): ParamSpec | null {
  const info = parameterInfo(source)
  if (!info) return null
  const type = (PARAM_TYPES.find((t) => t.id.toLowerCase() === (info.type ?? 'Any').toLowerCase())?.id ?? 'Any') as ParamType
  return { type, required: !!info.required, value: displayValue(info.valueText), list: info.allowedValues?.map(displayValue) }
}

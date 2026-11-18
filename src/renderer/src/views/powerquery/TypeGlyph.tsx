/**
 * Column type glyph shown in Power Query column headers and the Data Type menu: `ABC` text, `1.2`
 * decimal, `1²3` whole number, `$` fixed decimal, `%` percentage, calendar / clock / date-time /
 * time-zone / duration icons, a check-cross for logical, `ABC/123` for any, and table / record /
 * list icons for structured columns (like Power BI Desktop's Power Query Editor).
 */
import {
  CalendarClockRegular,
  CalendarLtrRegular,
  ClockRegular,
  GlobeClockRegular,
  TableRegular,
  TextBulletListRegular,
  BracesRegular,
  TimerRegular,
  DocumentRegular,
  MathFormulaRegular
} from '@fluentui/react-icons'
import type { TypeIcon } from './logic/format'

export const TYPE_LABELS: Record<TypeIcon, string> = {
  text: 'Text',
  decimal: 'Decimal Number',
  whole: 'Whole Number',
  currency: 'Fixed decimal number',
  percentage: 'Percentage',
  date: 'Date',
  datetime: 'Date/Time',
  datetimezone: 'Date/Time/Timezone',
  time: 'Time',
  duration: 'Duration',
  logical: 'True/False',
  binary: 'Binary',
  any: 'Any',
  table: 'Table',
  record: 'Record',
  list: 'List',
  function: 'Function'
}

export function TypeGlyph({ icon }: { icon: TypeIcon }) {
  const t = (s: React.ReactNode, cls = '') => <span className={`wbi-pq-tg wbi-pq-tg--text ${cls}`}>{s}</span>
  switch (icon) {
    case 'text':
      return t('ABC', 'is-abc')
    case 'decimal':
      return t('1.2')
    case 'whole':
      return t(
        <>
          1<sup>2</sup>3
        </>
      )
    case 'currency':
      return t('$')
    case 'percentage':
      return t('%')
    case 'logical':
      return t(
        <>
          <span className="wbi-pq-tg__ok">✓</span>
          <span className="wbi-pq-tg__no">✗</span>
        </>,
        'is-logical'
      )
    case 'any':
      return (
        <span className="wbi-pq-tg wbi-pq-tg--any">
          <span>ABC</span>
          <span>123</span>
        </span>
      )
    case 'binary':
      return (
        <span className="wbi-pq-tg wbi-pq-tg--any">
          <span>10</span>
          <span>01</span>
        </span>
      )
    case 'date':
      return <CalendarLtrRegular className="wbi-pq-tg" fontSize={15} />
    case 'datetime':
      return <CalendarClockRegular className="wbi-pq-tg" fontSize={15} />
    case 'datetimezone':
      return <GlobeClockRegular className="wbi-pq-tg" fontSize={15} />
    case 'time':
      return <ClockRegular className="wbi-pq-tg" fontSize={15} />
    case 'duration':
      return <TimerRegular className="wbi-pq-tg" fontSize={15} />
    case 'table':
      return <TableRegular className="wbi-pq-tg wbi-pq-tg--nested" fontSize={15} />
    case 'record':
      return <BracesRegular className="wbi-pq-tg wbi-pq-tg--nested" fontSize={15} />
    case 'list':
      return <TextBulletListRegular className="wbi-pq-tg wbi-pq-tg--nested" fontSize={15} />
    case 'function':
      return <MathFormulaRegular className="wbi-pq-tg" fontSize={15} />
    default:
      return <DocumentRegular className="wbi-pq-tg" fontSize={15} />
  }
}

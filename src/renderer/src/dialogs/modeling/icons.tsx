/**
 * Power BI field-list glyphs: data type icons (Σ for summarizable numbers, calendar for dates,
 * "fx" for calculated columns), table, measure (calculator), key, hierarchy.
 */
import { CalendarLtrRegular, CalculatorRegular, KeyRegular, TableRegular, TextTRegular, ToggleLeftRegular, BranchForkRegular, TableLightningRegular } from '@fluentui/react-icons'
import type { DataType, SummarizeBy } from '@core/model/types'

export function DataTypeIcon({ type, calculated, summarizeBy, size = 16 }: { type: DataType; calculated?: boolean; summarizeBy?: SummarizeBy; size?: number }) {
  const style = { fontSize: size, width: size, height: size, flex: 'none' as const, color: '#605E5C' }
  if (calculated)
    return (
      <span className="wbi-glyph-fx" style={{ ...style, fontSize: size * 0.7 }} aria-label="Calculated column">
        fx
      </span>
    )
  if (type === 'dateTime') return <CalendarLtrRegular style={style} aria-label="Date" />
  if (type === 'boolean') return <ToggleLeftRegular style={style} aria-label="True/false" />
  if (type === 'int64' || type === 'double' || type === 'decimal')
    return summarizeBy === 'none' ? (
      <span className="wbi-glyph-num" style={{ ...style, fontSize: size * 0.62 }} aria-label="Number">
        123
      </span>
    ) : (
      <span className="wbi-glyph-sigma" style={{ ...style, fontSize: size * 0.95 }} aria-label="Summarizable number">
        Σ
      </span>
    )
  return <TextTRegular style={style} aria-label="Text" />
}

export const MeasureIcon = ({ size = 16 }: { size?: number }) => <CalculatorRegular style={{ fontSize: size, flex: 'none', color: '#605E5C' }} aria-label="Measure" />
export const TableIcon = ({ size = 16, calculated }: { size?: number; calculated?: boolean }) =>
  calculated ? <TableLightningRegular style={{ fontSize: size, flex: 'none', color: '#605E5C' }} aria-label="Calculated table" /> : <TableRegular style={{ fontSize: size, flex: 'none', color: '#605E5C' }} aria-label="Table" />
export const KeyIcon = ({ size = 14 }: { size?: number }) => <KeyRegular style={{ fontSize: size, flex: 'none', color: '#605E5C' }} aria-label="Key" />
export const HierarchyIcon = ({ size = 16 }: { size?: number }) => <BranchForkRegular style={{ fontSize: size, flex: 'none', color: '#605E5C' }} aria-label="Hierarchy" />

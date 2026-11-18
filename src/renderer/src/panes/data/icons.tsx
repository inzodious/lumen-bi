/**
 * Data pane field icons (16px, PBI gray #605E5C): tables (regular / calculated / measure table /
 * calculation group / field parameter), columns by kind (Σ summarizable, calendar, globe, key, text),
 * measures (calculator), hierarchies, display folders, and the small "fx" calculated badge.
 */
import type { ReactElement } from 'react'
import {
  Table16Regular,
  TableCalculator16Regular,
  TableLightning16Regular,
  TableSettings16Regular,
  Calculator16Regular,
  CalendarLtr16Regular,
  Globe16Regular,
  Key16Regular,
  Folder16Regular,
  TextBulletListTree16Regular,
  TextT16Regular,
  CheckboxChecked16Regular
} from '@fluentui/react-icons'
import type { ColumnDef, TableDef } from '@core/model/types'

const GEO = new Set(['address', 'city', 'continent', 'country', 'countryregion', 'county', 'latitude', 'longitude', 'place', 'postalcode', 'stateorprovince'])

export function isGeoColumn(c: ColumnDef): boolean {
  return !!c.dataCategory && GEO.has(c.dataCategory.toLowerCase().replace(/[^a-z]/g, ''))
}

export function isNumericType(t: string): boolean {
  return t === 'int64' || t === 'double' || t === 'decimal'
}

/** Σ appears for numeric columns that summarize (summarizeBy ≠ none). */
export function isSummarizable(c: ColumnDef): boolean {
  return isNumericType(c.dataType) && (c.summarizeBy ?? 'default') !== 'none'
}

export function isFieldParameterTable(t: TableDef): boolean {
  return t.columns.some((c) => !!(c.extendedProperties as any)?.ParameterMetadata)
}

/** Measure table: has measures and no visible columns (PBI pins these to the top with a calculator icon). */
export function isMeasureTable(t: TableDef): boolean {
  return t.measures.length > 0 && t.columns.every((c) => c.isHidden || c.kind === 'rowNumber')
}

export function isCalculatedTable(t: TableDef): boolean {
  return t.partitions.some((p) => p.sourceType === 'calculated')
}

function Sigma() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 3h8v1.6H6.4L9.3 8l-2.9 3.4H12V13H4v-1.2L7.3 8 4 4.2z" fill="currentColor" />
    </svg>
  )
}

export function FxBadge() {
  return <span className="wbi-dtree__fx">fx</span>
}

export function TableIcon({ table }: { table: TableDef }): ReactElement {
  if (table.calculationGroup) return <TableLightning16Regular />
  if (isFieldParameterTable(table)) return <TableSettings16Regular />
  if (isMeasureTable(table)) return <TableCalculator16Regular />
  if (isCalculatedTable(table))
    return (
      <span className="wbi-dtree__stack">
        <Table16Regular />
        <FxBadge />
      </span>
    )
  return <Table16Regular />
}

export function ColumnIcon({ column }: { column: ColumnDef }): ReactElement {
  let icon: ReactElement
  if (isGeoColumn(column)) icon = <Globe16Regular />
  else if (column.isKey) icon = <Key16Regular />
  else if (column.dataType === 'dateTime') icon = <CalendarLtr16Regular />
  else if (isSummarizable(column)) icon = <Sigma />
  else if (column.dataType === 'boolean') icon = <CheckboxChecked16Regular />
  else icon = <TextT16Regular />
  if (column.kind === 'calculated')
    return (
      <span className="wbi-dtree__stack">
        {icon}
        <FxBadge />
      </span>
    )
  return icon
}

export const MeasureIcon = () => <Calculator16Regular />
export const HierarchyIcon = () => <TextBulletListTree16Regular />
export const FolderIcon = () => <Folder16Regular />

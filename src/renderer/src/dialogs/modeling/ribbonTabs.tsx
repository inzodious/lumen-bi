/**
 * Contextual ribbon tabs contributed to the shell: Table tools, Column tools, Measure tools
 * (shown in Report, Table and Model views when a field is selected — like Power BI Desktop).
 */
import { useEffect, useState } from 'react'
import { CalculatorArrowClockwiseRegular, CalculatorRegular, CalendarLtrRegular, OrganizationRegular, TableAddRegular, TextSortAscendingRegular, TableInsertColumnRegular } from '@fluentui/react-icons'
import { registerRibbonTab } from '../../app/ribbon/registry'
import { RibbonButton, RibbonControl, RibbonGroup } from '../../app/ribbon/Ribbon'
import { Dropdown } from '../../app/ui'
import { useApp, type FieldSelection } from '../../state/store'
import type { DataType, SummarizeBy } from '@core/model/types'
import { DATA_CATEGORIES, DATA_TYPE_LABELS, SUMMARIZE_LABELS } from './logic/formats'
import { FormatControls } from './FormatControls'
import { changeDataType, editColumn, editMeasure, findSelected, moveMeasure, renameSelected } from './fieldEdits'
import { newColumn, newMeasure, newTable, openManageRelationships, openMarkAsDateTable, openQuickMeasure } from './commands'

function NameBox({ sel, value }: { sel: FieldSelection; value: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <RibbonControl label="Name">
      <input
        className="wbi-ribbon-input"
        value={v}
        aria-label="Name"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && !renameSelected(sel, v) && setV(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setV(value)
        }}
      />
    </RibbonControl>
  )
}

function CalcGroup({ table }: { table: string }) {
  return (
    <RibbonGroup label="Calculations">
      <RibbonButton label="New measure" icon={<CalculatorRegular fontSize={32} />} onClick={() => newMeasure(table)} />
      <RibbonButton label="Quick measure" icon={<CalculatorArrowClockwiseRegular fontSize={32} />} onClick={openQuickMeasure} />
      <RibbonButton label="New column" icon={<TableInsertColumnRegular fontSize={32} />} onClick={() => newColumn(table)} />
      <RibbonButton label="New table" icon={<TableAddRegular fontSize={32} />} onClick={newTable} />
    </RibbonGroup>
  )
}

function TableToolsTab() {
  const sel = useApp((s) => s.selectedField)
  const model = useApp((s) => s.project?.model)
  const { table } = findSelected(model, sel)
  if (!sel || !table) return null
  return (
    <>
      <RibbonGroup label="Structure">
        <NameBox sel={{ kind: 'table', table: table.name }} value={table.name} />
      </RibbonGroup>
      <RibbonGroup label="Calendars">
        <RibbonButton label="Mark as date table" icon={<CalendarLtrRegular fontSize={32} />} onClick={() => openMarkAsDateTable(table.name)} checked={table.dataCategory === 'Time'} />
      </RibbonGroup>
      <RibbonGroup label="Relationships">
        <RibbonButton label="Manage relationships" icon={<OrganizationRegular fontSize={32} />} onClick={openManageRelationships} />
      </RibbonGroup>
      <CalcGroup table={table.name} />
    </>
  )
}

function ColumnToolsTab() {
  const sel = useApp((s) => s.selectedField)
  const model = useApp((s) => s.project?.model)
  const { table, column } = findSelected(model, sel)
  if (!sel || !table || !column) return null
  const isNum = column.dataType === 'int64' || column.dataType === 'double' || column.dataType === 'decimal'
  return (
    <>
      <RibbonGroup label="Structure">
        <NameBox sel={sel} value={column.name} />
        <RibbonControl label="Data type">
          <Dropdown
            size="small"
            value={column.dataType}
            disabled={column.kind === 'calculatedTableColumn'}
            options={(['string', 'int64', 'double', 'decimal', 'dateTime', 'boolean'] as DataType[]).map((d) => ({ value: d, label: DATA_TYPE_LABELS[d] ?? d }))}
            onChange={(v: DataType) => changeDataType(table.name, column.name, v)}
          />
        </RibbonControl>
      </RibbonGroup>
      <RibbonGroup label="Formatting">
        <FormatControls compact formatString={column.formatString} dataType={column.dataType} onChange={(f) => editColumn(table.name, column.name, 'Change format', (c) => (f ? (c.formatString = f) : delete c.formatString))} />
      </RibbonGroup>
      <RibbonGroup label="Properties">
        <RibbonControl label="Summarization">
          <Dropdown
            size="small"
            value={column.summarizeBy && column.summarizeBy !== 'default' ? column.summarizeBy : isNum ? 'sum' : 'none'}
            options={SUMMARIZE_LABELS.filter((o) => isNum || ['none', 'count', 'distinctCount'].includes(o.value))}
            onChange={(v: SummarizeBy) =>
              editColumn(table.name, column.name, 'Summarize by', (c) => {
                c.summarizeBy = v
                c.annotations = { ...(c.annotations ?? {}), SummarizationSetBy: 'User' }
              })
            }
          />
        </RibbonControl>
        <RibbonControl label="Data category">
          <Dropdown size="small" value={column.dataCategory ?? ''} options={DATA_CATEGORIES} onChange={(v) => editColumn(table.name, column.name, 'Data category', (c) => (v ? (c.dataCategory = v) : delete c.dataCategory))} />
        </RibbonControl>
      </RibbonGroup>
      <RibbonGroup label="Sort">
        <RibbonButton
          label="Sort by column"
          icon={<TextSortAscendingRegular fontSize={32} />}
          menu={() =>
            table.columns
              .filter((c) => c.kind !== 'rowNumber')
              .map((c) => ({
                label: c.name,
                checked: (column.sortByColumn ?? column.name) === c.name,
                onClick: () => editColumn(table.name, column.name, 'Sort by column', (cc) => (c.name === cc.name ? delete cc.sortByColumn : (cc.sortByColumn = c.name)))
              }))
          }
        />
      </RibbonGroup>
      <RibbonGroup label="Relationships">
        <RibbonButton label="Manage relationships" icon={<OrganizationRegular fontSize={32} />} onClick={openManageRelationships} />
      </RibbonGroup>
      <RibbonGroup label="Calculations">
        <RibbonButton label="New column" icon={<TableInsertColumnRegular fontSize={32} />} onClick={() => newColumn(table.name)} />
      </RibbonGroup>
    </>
  )
}

function MeasureToolsTab() {
  const sel = useApp((s) => s.selectedField)
  const model = useApp((s) => s.project?.model)
  const { table, measure } = findSelected(model, sel)
  if (!sel || !table || !measure || !model) return null
  return (
    <>
      <RibbonGroup label="Structure">
        <NameBox sel={sel} value={measure.name} />
        <RibbonControl label="Home table">
          <Dropdown size="small" value={table.name} options={model.tables.filter((t) => !t.isPrivate && !t.showAsVariationsOnly).map((t) => ({ value: t.name, label: t.name }))} onChange={(v) => moveMeasure(table.name, measure.name, v)} searchable />
        </RibbonControl>
      </RibbonGroup>
      <RibbonGroup label="Formatting">
        {measure.formatStringDefinition ? (
          <RibbonControl label="Format">
            <span className="wbi-ribbon-note">Dynamic</span>
          </RibbonControl>
        ) : (
          <FormatControls compact formatString={measure.formatString} dataType={measure.dataType ?? 'double'} onChange={(f) => editMeasure(table.name, measure.name, 'Change format', (me) => (f ? (me.formatString = f) : delete me.formatString))} />
        )}
      </RibbonGroup>
      <CalcGroup table={table.name} />
    </>
  )
}

registerRibbonTab({ id: 'tableTools', label: 'Table tools', contextual: true, order: 210, views: ['report', 'data', 'model'], visible: (s) => s.selectedField?.kind === 'table' && !!findSelected(s.project?.model, s.selectedField).table, autoSelect: true, render: () => <TableToolsTab /> })
registerRibbonTab({ id: 'columnTools', label: 'Column tools', contextual: true, order: 220, views: ['report', 'data', 'model'], visible: (s) => s.selectedField?.kind === 'column' && !!findSelected(s.project?.model, s.selectedField).column, autoSelect: true, render: () => <ColumnToolsTab /> })
registerRibbonTab({ id: 'measureTools', label: 'Measure tools', contextual: true, order: 230, views: ['report', 'data', 'model'], visible: (s) => s.selectedField?.kind === 'measure' && !!findSelected(s.project?.model, s.selectedField).measure, autoSelect: true, render: () => <MeasureToolsTab /> })

export { TableToolsTab, ColumnToolsTab, MeasureToolsTab }

/**
 * Power Query Editor ribbon: File · Home · Transform · Add Column · View, laid out like Power BI
 * Desktop's Power Query Editor (groups, large / small buttons, split buttons, disabled states when no
 * column is selected). Built from the main ribbon's building blocks (RibbonGroup / RibbonButton /
 * RibbonStack) so it shares their look.
 *
 * Omitted (not applicable to Lumen): Combine Files, Column From Examples, Invoke Custom Function,
 * Parse (XML/JSON), Trigonometry, Query Dependencies, Tools / Help tabs.
 */
import { useState, type ReactElement } from 'react'
import {
  ArrowClockwiseRegular,
  ArrowDownRegular,
  ArrowMoveRegular,
  ArrowRepeatAllRegular,
  ArrowSortDownRegular,
  ArrowSortUpRegular,
  ArrowSwapRegular,
  ArrowUpRegular,
  BracesVariableRegular,
  CalculatorRegular,
  CalendarLtrRegular,
  ClockRegular,
  CodeRegular,
  ColumnTripleRegular,
  CopyRegular,
  DatabaseSearchRegular,
  DataHistogramRegular,
  DeleteRegular,
  DocumentTableRegular,
  GroupListRegular,
  MathFormulaRegular,
  MergeRegular,
  NumberSymbolRegular,
  PanelRightRegular,
  SaveArrowRightRegular,
  SettingsRegular,
  SplitVerticalRegular,
  TableAddRegular,
  TableArrowUpRegular,
  TableCellsMergeRegular,
  TableDeleteColumnRegular,
  TableDeleteRowRegular,
  TableEditRegular,
  TableInsertColumnRegular,
  TableLightningRegular,
  TableSimpleIncludeRegular,
  TableStackBelowRegular,
  TableSwitchRegular,
  TextCaseTitleRegular,
  TextColumnTwoRegular,
  TextNumberFormatRegular,
  TimerRegular,
  ArrowExpandRegular
} from '@fluentui/react-icons'
import { RibbonButton, RibbonGroup, RibbonStack, RibbonControl } from '../../app/ribbon/Ribbon'
import { Checkbox, MenuButton, cx, type MenuItem } from '../../app/ui'
import { save } from '../../app/commands'
import { useShell } from '../../app/shellState'
import { useApp } from '../../state/store'
import * as T from './logic/transforms'
import { PQ_TYPES, pqTypeOf, type PqType } from './logic/mtext'
import { columnOpNeedsArgs } from './logic/dialogArgs'
import { typeIcon } from './logic/format'
import { usePq, previewColumns } from './pqStore'
import type { DraftQuery } from './logic/draft'
import type { ColInfo } from './logic/transforms'
import { openPqDialog, type RowsDialogKind } from './pqDialogs'
import {
  addSpec,
  applyAction,
  changeTypeAction,
  closeAndApply,
  closeEditor,
  deleteQueryAction,
  discardChanges,
  duplicateQueryAction,
  newBlankQuery,
  referenceQueryAction,
  refreshPreview,
  selectedColumnInfo
} from './actions'
import { TypeGlyph } from './TypeGlyph'

type TabId = 'home' | 'transform' | 'addColumn' | 'view'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'transform', label: 'Transform' },
  { id: 'addColumn', label: 'Add Column' },
  { id: 'view', label: 'View' }
]

/** Selection-derived state the ribbon (and the column header menu) needs. */
export function ribbonStateFor(query: DraftQuery | null, isTable: boolean, cols: ColInfo[], selected: readonly string[]) {
  const sel = cols.filter((c) => selected.includes(c.name))
  const kinds = new Set(sel.map((c) => pqTypeOf(c.type)))
  const all = (pred: (k: PqType) => boolean) => sel.length > 0 && [...kinds].every(pred)
  return {
    query,
    isTable,
    cols,
    sel,
    none: sel.length === 0,
    one: sel.length === 1,
    text: all((k) => k === 'text' || k === 'any'),
    number: all((k) => k === 'number' || k === 'int64' || k === 'currency' || k === 'percentage' || k === 'any'),
    date: all((k) => k === 'date' || k === 'datetime' || k === 'datetimezone' || k === 'any'),
    time: all((k) => k === 'time' || k === 'datetime' || k === 'datetimezone' || k === 'any'),
    duration: all((k) => k === 'duration' || k === 'any'),
    nested: sel.length === 1 && ['table', 'record'].includes(typeIcon(sel[0]!.type))
  }
}

function useRibbonState() {
  const selectedCols = usePq((s) => s.selectedCols)
  const result = usePq((s) => s.preview.result?.result)
  const query = usePq((s) => s.draft.queries.find((q) => q.id === s.selectedId) ?? null)
  const isTable = !!result?.ok && result.preview.kind === 'table'
  return ribbonStateFor(query, isTable, isTable ? previewColumns() : [], selectedCols)
}

export type RState = ReturnType<typeof ribbonStateFor>

// ---------------------------------------------------------------------------------------------
// command helpers

const names = (st: RState) => st.sel.map((c) => c.name)

function columnOp(st: RState, op: T.ColumnOp, insert: boolean): void {
  if (st.none) return
  if (columnOpNeedsArgs(op)) return openPqDialog({ id: 'columnOp', op, insert })
  if (insert)
    void addSpec(
      T.insertColumnOp(
        st.sel[0]!,
        op,
        '',
        '',
        st.cols.map((c) => c.name)
      )
    )
  else void addSpec(T.transformColumns(st.sel, op))
}

const opItem = (st: RState, label: string, op: T.ColumnOp, insert: boolean, enabled = true): MenuItem => ({ label, disabled: !enabled, onClick: () => columnOp(st, op, insert) })

export function formatMenu(st: RState, insert: boolean): MenuItem[] {
  return [
    opItem(st, 'lowercase', 'lower', insert),
    opItem(st, 'UPPERCASE', 'upper', insert),
    opItem(st, 'Capitalize Each Word', 'proper', insert),
    opItem(st, 'Trim', 'trim', insert),
    opItem(st, 'Clean', 'clean', insert),
    opItem(st, 'Add Prefix', 'prefix', insert),
    opItem(st, 'Add Suffix', 'suffix', insert)
  ]
}

export function extractMenu(st: RState, insert: boolean): MenuItem[] {
  return [
    opItem(st, 'Length', 'length', insert),
    { separator: true },
    opItem(st, 'First Characters', 'first', insert),
    opItem(st, 'Last Characters', 'last', insert),
    opItem(st, 'Range', 'range', insert),
    { separator: true },
    opItem(st, 'Text Before Delimiter', 'beforeDelimiter', insert),
    opItem(st, 'Text After Delimiter', 'afterDelimiter', insert),
    opItem(st, 'Text Between Delimiters', 'betweenDelimiters', insert)
  ]
}

export function statisticsMenu(st: RState): MenuItem[] {
  const stat = (label: string, op: T.StatOp): MenuItem => ({ label, disabled: !st.one, onClick: () => void addSpec(T.statistic(st.sel[0]!.name, op)) })
  return [stat('Sum', 'sum'), stat('Minimum', 'min'), stat('Maximum', 'max'), stat('Median', 'median'), stat('Average', 'average'), stat('Standard Deviation', 'stddev'), stat('Count Values', 'count'), stat('Count Distinct Values', 'countDistinct')]
}

export const standardMenu = (st: RState, insert: boolean): MenuItem[] => [
  opItem(st, 'Add', 'add', insert),
  opItem(st, 'Multiply', 'multiply', insert),
  opItem(st, 'Subtract', 'subtract', insert),
  opItem(st, 'Divide', 'divide', insert),
  opItem(st, 'Divide (Integer)', 'integerDivide', insert),
  opItem(st, 'Modulo', 'modulo', insert)
]

export const scientificMenu = (st: RState, insert: boolean): MenuItem[] => [opItem(st, 'Absolute Value', 'abs', insert), opItem(st, 'Power', 'power', insert), opItem(st, 'Square Root', 'sqrt', insert)]

export const roundingMenu = (st: RState, insert: boolean): MenuItem[] => [opItem(st, 'Round Up', 'roundUp', insert), opItem(st, 'Round Down', 'roundDown', insert), opItem(st, 'Round…', 'round', insert)]

export const informationMenu = (st: RState, insert: boolean): MenuItem[] => [opItem(st, 'Is Even', 'isEven', insert), opItem(st, 'Is Odd', 'isOdd', insert), opItem(st, 'Sign', 'sign', insert)]

export function dateMenu(st: RState, insert: boolean): MenuItem[] {
  const o = (label: string, op: T.ColumnOp) => opItem(st, label, op, insert)
  return [
    o('Date Only', 'dateOnly'),
    o('Age', 'age'),
    { separator: true },
    { label: 'Year', submenu: [o('Year', 'year'), o('Start of Year', 'startOfYear'), o('End of Year', 'endOfYear')] },
    { label: 'Month', submenu: [o('Month', 'month'), o('Start of Month', 'startOfMonth'), o('End of Month', 'endOfMonth'), o('Days in Month', 'daysInMonth'), o('Name of Month', 'monthName')] },
    { label: 'Quarter', submenu: [o('Quarter of Year', 'quarter'), o('Start of Quarter', 'startOfQuarter'), o('End of Quarter', 'endOfQuarter')] },
    { label: 'Week', submenu: [o('Week of Year', 'weekOfYear'), o('Week of Month', 'weekOfMonth')] },
    { label: 'Day', submenu: [o('Day', 'day'), o('Day of Week', 'dayOfWeek'), o('Day of Year', 'dayOfYear'), o('Name of Day', 'dayName')] }
  ]
}

export const timeMenu = (st: RState, insert: boolean): MenuItem[] => [opItem(st, 'Time Only', 'timeOnly', insert), opItem(st, 'Hour', 'hour', insert), opItem(st, 'Minute', 'minute', insert), opItem(st, 'Second', 'second', insert)]

export const durationMenu = (st: RState, insert: boolean): MenuItem[] => [
  opItem(st, 'Days', 'days', insert),
  opItem(st, 'Hours', 'hours', insert),
  opItem(st, 'Minutes', 'minutes', insert),
  opItem(st, 'Seconds', 'seconds', insert),
  { separator: true },
  opItem(st, 'Total Years', 'totalYears', insert),
  opItem(st, 'Total Days', 'totalDays', insert),
  opItem(st, 'Total Hours', 'totalHours', insert)
]

export function dataTypeMenu(cols: Array<{ name: string; type: string }>): MenuItem[] {
  const current = cols.length === 1 ? pqTypeOf(cols[0]!.type) : null
  return PQ_TYPES.map((t) => ({
    label: t.label,
    icon: <TypeGlyph icon={typeIcon(t.m.replace(/^type /, ''))} />,
    selected: current === t.id,
    onClick: () => void changeTypeAction(cols.map((c) => ({ name: c.name, type: t.id })))
  }))
}

function dataTypeLabel(st: RState): string {
  if (st.sel.length !== 1) return 'Data Type: Any'
  const t = pqTypeOf(st.sel[0]!.type)
  return `Data Type: ${PQ_TYPES.find((x) => x.id === t)?.label ?? 'Any'}`
}

const rows = (kind: RowsDialogKind) => () => openPqDialog({ id: 'rows', kind })

function keepRowsMenu(st: RState): MenuItem[] {
  return [
    { label: 'Keep Top Rows', onClick: rows('keepTop') },
    { label: 'Keep Bottom Rows', onClick: rows('keepBottom') },
    { label: 'Keep Range of Rows', onClick: rows('keepRange') },
    { separator: true },
    { label: 'Keep Duplicates', disabled: st.none, onClick: () => void addSpec(T.keepDuplicates(names(st))) },
    { label: 'Keep Errors', disabled: st.none, onClick: () => void addSpec(T.keepErrors(names(st))) }
  ]
}

function removeRowsMenu(st: RState): MenuItem[] {
  return [
    { label: 'Remove Top Rows', onClick: rows('removeTop') },
    { label: 'Remove Bottom Rows', onClick: rows('removeBottom') },
    { label: 'Remove Alternate Rows', onClick: rows('removeAlternate') },
    { separator: true },
    { label: 'Remove Duplicates', disabled: st.none, onClick: () => void addSpec(T.removeDuplicates(names(st))) },
    { label: 'Remove Blank Rows', onClick: () => void addSpec(T.removeBlankRows()) },
    { label: 'Remove Errors', disabled: st.none, onClick: () => void addSpec(T.removeErrors(names(st))) }
  ]
}

export function moveMenu(st: { cols: Array<{ name: string }>; sel: Array<{ name: string }> }): MenuItem[] {
  const all = st.cols.map((c) => c.name)
  const sel = st.sel.map((c) => c.name)
  const mv = (label: string, kind: T.MoveKind): MenuItem => ({ label, disabled: !sel.length, onClick: () => void addSpec(T.reorderColumns(T.movedOrder(all, sel, kind))) })
  return [mv('Left', 'left'), mv('Right', 'right'), mv('To Beginning', 'beginning'), mv('To End', 'end')]
}

export function unpivotMenu(st: { cols: Array<{ name: string }>; sel: Array<{ name: string }> }): MenuItem[] {
  const all = st.cols.map((c) => c.name)
  const sel = st.sel.map((c) => c.name)
  return [
    { label: 'Unpivot Columns', disabled: !sel.length, onClick: () => void addSpec(T.unpivotColumns(sel, all)) },
    { label: 'Unpivot Other Columns', disabled: !sel.length, onClick: () => void addSpec(T.unpivotOtherColumns(sel)) },
    { label: 'Unpivot Only Selected Columns', disabled: !sel.length, onClick: () => void addSpec(T.unpivotOnlySelected(sel)) }
  ]
}

export function detectTypes(st: RState): void {
  const r = usePq.getState().preview.result?.result
  if (!r?.ok || r.preview.kind !== 'table') return
  const p = r.preview
  const values = (name: string) => {
    const i = p.columns.findIndex((c) => c.name === name)
    return p.rows.map((row) => row[i])
  }
  void addSpec(T.detectTypes(st.sel.length ? st.sel : p.columns, values))
}

// ---------------------------------------------------------------------------------------------
// tabs

function HomeTab({ st }: { st: RState }) {
  const q = st.query
  return (
    <>
      <RibbonGroup label="Close">
        <RibbonButton
          label="Close & Apply"
          icon={<SaveArrowRightRegular fontSize={32} className="wbi-pq-ico-brand" />}
          onClick={closeAndApply}
          menu={[
            { label: 'Close & Apply', onClick: closeAndApply },
            { label: 'Apply', onClick: applyAction },
            { label: 'Close', onClick: () => void closeEditor() }
          ]}
          tooltip="Apply the pending changes to the queries and close the Power Query Editor."
        />
      </RibbonGroup>
      <RibbonGroup label="New Query">
        <RibbonButton
          label="New Source"
          icon={<TableAddRegular fontSize={32} />}
          menu={[
            { label: 'Blank Query', icon: <DocumentTableRegular fontSize={16} />, onClick: newBlankQuery },
            { label: 'Enter Data', icon: <TableEditRegular fontSize={16} />, onClick: () => openPqDialog({ id: 'enterData' }) },
            { separator: true },
            { label: 'Get Data…', onClick: () => useShell.getState().openDialog({ id: 'getData' }) }
          ]}
        />
        <RibbonButton label="Enter Data" icon={<TableEditRegular fontSize={32} />} onClick={() => openPqDialog({ id: 'enterData' })} />
      </RibbonGroup>
      <RibbonGroup label="Data Sources">
        <RibbonButton label="Data source settings" icon={<DatabaseSearchRegular fontSize={32} />} onClick={() => openPqDialog({ id: 'dataSources' })} />
      </RibbonGroup>
      <RibbonGroup label="Parameters">
        <RibbonButton
          label="Manage Parameters"
          icon={<BracesVariableRegular fontSize={32} />}
          onClick={() => openPqDialog({ id: 'parameters' })}
          menu={[
            { label: 'Manage Parameters', onClick: () => openPqDialog({ id: 'parameters' }) },
            { label: 'New Parameter…', onClick: () => openPqDialog({ id: 'parameters', create: true }) }
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Query">
        <RibbonButton label="Refresh Preview" icon={<ArrowClockwiseRegular fontSize={32} />} onClick={refreshPreview} menu={[{ label: 'Refresh Preview', onClick: refreshPreview }, { label: 'Refresh All', onClick: refreshPreview }]} />
        <RibbonStack>
          <RibbonButton size="small" label="Properties" icon={<SettingsRegular fontSize={16} />} disabled={!q} onClick={() => q && openPqDialog({ id: 'properties', queryId: q.id })} />
          <RibbonButton size="small" label="Advanced Editor" icon={<CodeRegular fontSize={16} />} disabled={!q} onClick={() => q && openPqDialog({ id: 'advanced', queryId: q.id })} />
          <RibbonButton
            size="small"
            label="Manage"
            icon={<TableSwitchRegular fontSize={16} />}
            disabled={!q}
            menu={() =>
              q
                ? [
                    { label: 'Delete', icon: <DeleteRegular fontSize={16} />, onClick: () => void deleteQueryAction(q.id) },
                    { label: 'Duplicate', icon: <CopyRegular fontSize={16} />, onClick: () => duplicateQueryAction(q.id) },
                    { label: 'Reference', icon: <TableArrowUpRegular fontSize={16} />, onClick: () => referenceQueryAction(q.id) }
                  ]
                : []
            }
          />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Manage Columns">
        <RibbonButton label="Choose Columns" icon={<TableSimpleIncludeRegular fontSize={32} />} disabled={!st.isTable} onClick={() => openPqDialog({ id: 'chooseColumns' })} menu={[{ label: 'Choose Columns', onClick: () => openPqDialog({ id: 'chooseColumns' }) }]} />
        <RibbonButton
          label="Remove Columns"
          icon={<TableDeleteColumnRegular fontSize={32} />}
          disabled={st.none}
          onClick={() => void addSpec(T.removeColumns(names(st)))}
          menu={[
            { label: 'Remove Columns', onClick: () => void addSpec(T.removeColumns(names(st))) },
            { label: 'Remove Other Columns', onClick: () => void addSpec(T.removeOtherColumns(names(st))) }
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Reduce Rows">
        <RibbonButton label="Keep Rows" icon={<TableStackBelowRegular fontSize={32} />} disabled={!st.isTable} menu={() => keepRowsMenu(st)} />
        <RibbonButton label="Remove Rows" icon={<TableDeleteRowRegular fontSize={32} />} disabled={!st.isTable} menu={() => removeRowsMenu(st)} />
      </RibbonGroup>
      <RibbonGroup label="Sort">
        <RibbonStack>
          <RibbonButton size="small" label="" icon={<ArrowSortUpRegular fontSize={16} />} tooltip="Sort Ascending" disabled={!st.one} onClick={() => void addSpec(T.sortRows([{ col: st.sel[0]!.name, desc: false }]))} />
          <RibbonButton size="small" label="" icon={<ArrowSortDownRegular fontSize={16} />} tooltip="Sort Descending" disabled={!st.one} onClick={() => void addSpec(T.sortRows([{ col: st.sel[0]!.name, desc: true }]))} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Transform">
        <RibbonButton label="Split Column" icon={<SplitVerticalRegular fontSize={32} />} disabled={!st.one || !st.text} menu={() => splitMenu(st)} />
        <RibbonButton label="Group By" icon={<GroupListRegular fontSize={32} />} disabled={!st.isTable} onClick={() => openPqDialog({ id: 'groupBy' })} />
        <RibbonStack>
          <RibbonButton size="small" label={dataTypeLabel(st)} icon={<TypeGlyph icon={st.one ? typeIcon(st.sel[0]!.type) : 'any'} />} disabled={st.none} menu={() => dataTypeMenu(st.sel)} />
          <RibbonButton size="small" label="Use First Row as Headers" icon={<TableArrowUpRegular fontSize={16} />} disabled={!st.isTable} menu={headersMenu} />
          <RibbonButton size="small" label="Replace Values" icon={<ArrowSwapRegular fontSize={16} />} disabled={st.none} onClick={() => openPqDialog({ id: 'replace', columns: names(st) })} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Combine">
        <RibbonStack>
          <RibbonButton
            size="small"
            label="Merge Queries"
            icon={<MergeRegular fontSize={16} />}
            disabled={!st.isTable}
            menu={[
              { label: 'Merge Queries', onClick: () => openPqDialog({ id: 'merge' }) },
              { label: 'Merge Queries as New', onClick: () => openPqDialog({ id: 'merge', asNew: true }) }
            ]}
          />
          <RibbonButton
            size="small"
            label="Append Queries"
            icon={<TableStackBelowRegular fontSize={16} />}
            disabled={!st.isTable}
            menu={[
              { label: 'Append Queries', onClick: () => openPqDialog({ id: 'append' }) },
              { label: 'Append Queries as New', onClick: () => openPqDialog({ id: 'append', asNew: true }) }
            ]}
          />
        </RibbonStack>
      </RibbonGroup>
    </>
  )
}

const headersMenu: MenuItem[] = [
  { label: 'Use First Row as Headers', onClick: () => void addSpec(T.promoteHeaders()) },
  { label: 'Use Headers as First Row', onClick: () => void addSpec(T.demoteHeaders()) }
]

export function splitMenu(st: RState): MenuItem[] {
  const col = st.sel[0]?.name ?? ''
  return [
    { label: 'By Delimiter', onClick: () => openPqDialog({ id: 'split', mode: 'delimiter', column: col }) },
    { label: 'By Number of Characters', onClick: () => openPqDialog({ id: 'split', mode: 'positions', column: col }) }
  ]
}

function TransformTab({ st }: { st: RState }) {
  return (
    <>
      <RibbonGroup label="Table">
        <RibbonButton label="Group By" icon={<GroupListRegular fontSize={32} />} disabled={!st.isTable} onClick={() => openPqDialog({ id: 'groupBy' })} />
        <RibbonButton label="Use First Row as Headers" icon={<TableArrowUpRegular fontSize={32} />} disabled={!st.isTable} onClick={() => void addSpec(T.promoteHeaders())} menu={headersMenu} />
        <RibbonStack>
          <RibbonButton size="small" label="Transpose" icon={<ArrowRepeatAllRegular fontSize={16} />} disabled={!st.isTable} onClick={() => void addSpec(T.transpose())} />
          <RibbonButton size="small" label="Reverse Rows" icon={<ArrowSortUpRegular fontSize={16} />} disabled={!st.isTable} onClick={() => void addSpec(T.reverseRows())} />
          <RibbonButton size="small" label="Count Rows" icon={<NumberSymbolRegular fontSize={16} />} disabled={!st.isTable} onClick={() => void addSpec(T.countRows())} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Any Column">
        <RibbonStack>
          <RibbonButton size="small" label={dataTypeLabel(st)} icon={<TypeGlyph icon={st.one ? typeIcon(st.sel[0]!.type) : 'any'} />} disabled={st.none} menu={() => dataTypeMenu(st.sel)} />
          <RibbonButton size="small" label="Detect Data Type" icon={<TableLightningRegular fontSize={16} />} disabled={st.none} onClick={() => detectTypes(st)} />
          <RibbonButton size="small" label="Rename" icon={<TextNumberFormatRegular fontSize={16} />} disabled={!st.one} onClick={() => usePq.setState({ renamingColumn: st.sel[0]!.name })} />
        </RibbonStack>
        <RibbonStack>
          <RibbonButton
            size="small"
            label="Replace Values"
            icon={<ArrowSwapRegular fontSize={16} />}
            disabled={st.none}
            onClick={() => openPqDialog({ id: 'replace', columns: names(st) })}
            menu={[
              { label: 'Replace Values', onClick: () => openPqDialog({ id: 'replace', columns: names(st) }) },
              { label: 'Replace Errors', onClick: () => openPqDialog({ id: 'replace', columns: names(st), errors: true }) }
            ]}
          />
          <RibbonButton
            size="small"
            label="Fill"
            icon={<ArrowDownRegular fontSize={16} />}
            disabled={st.none}
            menu={[
              { label: 'Down', icon: <ArrowDownRegular fontSize={16} />, onClick: () => void addSpec(T.fillDown(names(st))) },
              { label: 'Up', icon: <ArrowUpRegular fontSize={16} />, onClick: () => void addSpec(T.fillUp(names(st))) }
            ]}
          />
          <RibbonButton size="small" label="Pivot Column" icon={<TableSwitchRegular fontSize={16} />} disabled={!st.one} onClick={() => openPqDialog({ id: 'pivot', column: st.sel[0]!.name })} />
        </RibbonStack>
        <RibbonStack>
          <RibbonButton size="small" label="Unpivot Columns" icon={<TableSwitchRegular fontSize={16} />} disabled={st.none} onClick={() => void addSpec(T.unpivotColumns(names(st), st.cols.map((c) => c.name)))} menu={() => unpivotMenu(st)} />
          <RibbonButton size="small" label="Move" icon={<ArrowMoveRegular fontSize={16} />} disabled={st.none} menu={() => moveMenu(st)} />
          <RibbonButton size="small" label="Convert to List" icon={<TextColumnTwoRegular fontSize={16} />} disabled={!st.one} onClick={() => void addSpec(T.drillDownColumn(st.sel[0]!.name))} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Text Column">
        <RibbonButton label="Split Column" icon={<SplitVerticalRegular fontSize={32} />} disabled={!st.one || !st.text} menu={() => splitMenu(st)} />
        <RibbonButton label="Format" icon={<TextCaseTitleRegular fontSize={32} />} disabled={!st.text} menu={() => formatMenu(st, false)} />
        <RibbonStack>
          <RibbonButton size="small" label="Merge Columns" icon={<TableCellsMergeRegular fontSize={16} />} disabled={st.sel.length < 2} onClick={() => openPqDialog({ id: 'mergeColumns', insert: false })} />
          <RibbonButton size="small" label="Extract" icon={<TextColumnTwoRegular fontSize={16} />} disabled={!st.text} menu={() => extractMenu(st, false)} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Number Column">
        <RibbonButton label="Statistics" icon={<DataHistogramRegular fontSize={32} />} disabled={!st.one || !st.number} menu={() => statisticsMenu(st)} />
        <RibbonButton label="Standard" icon={<CalculatorRegular fontSize={32} />} disabled={!st.number} menu={() => standardMenu(st, false)} />
        <RibbonButton label="Scientific" icon={<MathFormulaRegular fontSize={32} />} disabled={!st.number} menu={() => scientificMenu(st, false)} />
        <RibbonStack>
          <RibbonButton size="small" label="Rounding" icon={<NumberSymbolRegular fontSize={16} />} disabled={!st.number} menu={() => roundingMenu(st, false)} />
          <RibbonButton size="small" label="Information" icon={<NumberSymbolRegular fontSize={16} />} disabled={!st.number} menu={() => informationMenu(st, false)} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Date & Time Column">
        <RibbonButton label="Date" icon={<CalendarLtrRegular fontSize={32} />} disabled={!st.date} menu={() => dateMenu(st, false)} />
        <RibbonButton label="Time" icon={<ClockRegular fontSize={32} />} disabled={!st.time} menu={() => timeMenu(st, false)} />
        <RibbonButton label="Duration" icon={<TimerRegular fontSize={32} />} disabled={!st.duration} menu={() => durationMenu(st, false)} />
      </RibbonGroup>
      <RibbonGroup label="Structured Column">
        <RibbonButton label="Expand" icon={<ArrowExpandRegular fontSize={32} />} disabled={!st.nested} onClick={() => st.sel[0] && usePq.setState({ expandColumn: st.sel[0].name })} />
      </RibbonGroup>
    </>
  )
}

function AddColumnTab({ st }: { st: RState }) {
  return (
    <>
      <RibbonGroup label="General">
        <RibbonButton label="Custom Column" icon={<TableInsertColumnRegular fontSize={32} />} disabled={!st.isTable} onClick={() => openPqDialog({ id: 'customColumn' })} />
        <RibbonStack>
          <RibbonButton size="small" label="Conditional Column" icon={<ColumnTripleRegular fontSize={16} />} disabled={!st.isTable} onClick={() => openPqDialog({ id: 'conditionalColumn' })} />
          <RibbonButton
            size="small"
            label="Index Column"
            icon={<NumberSymbolRegular fontSize={16} />}
            disabled={!st.isTable}
            onClick={() => void addSpec(T.addIndexColumn(0))}
            menu={[
              { label: 'From 0', onClick: () => void addSpec(T.addIndexColumn(0)) },
              { label: 'From 1', onClick: () => void addSpec(T.addIndexColumn(1)) },
              { label: 'Custom…', onClick: () => openPqDialog({ id: 'indexColumn' }) }
            ]}
          />
          <RibbonButton
            size="small"
            label="Duplicate Column"
            icon={<CopyRegular fontSize={16} />}
            disabled={!st.one}
            onClick={() =>
              void addSpec(
                T.duplicateColumn(
                  st.sel[0]!.name,
                  st.cols.map((c) => c.name)
                )
              )
            }
          />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="From Text">
        <RibbonButton label="Format" icon={<TextCaseTitleRegular fontSize={32} />} disabled={!st.one || !st.text} menu={() => formatMenu(st, true)} />
        <RibbonStack>
          <RibbonButton size="small" label="Merge Columns" icon={<TableCellsMergeRegular fontSize={16} />} disabled={st.sel.length < 2} onClick={() => openPqDialog({ id: 'mergeColumns', insert: true })} />
          <RibbonButton size="small" label="Extract" icon={<TextColumnTwoRegular fontSize={16} />} disabled={!st.one || !st.text} menu={() => extractMenu(st, true)} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="From Number">
        <RibbonButton label="Standard" icon={<CalculatorRegular fontSize={32} />} disabled={!st.one || !st.number} menu={() => standardMenu(st, true)} />
        <RibbonButton label="Scientific" icon={<MathFormulaRegular fontSize={32} />} disabled={!st.one || !st.number} menu={() => scientificMenu(st, true)} />
        <RibbonStack>
          <RibbonButton size="small" label="Rounding" icon={<NumberSymbolRegular fontSize={16} />} disabled={!st.one || !st.number} menu={() => roundingMenu(st, true)} />
          <RibbonButton size="small" label="Information" icon={<NumberSymbolRegular fontSize={16} />} disabled={!st.one || !st.number} menu={() => informationMenu(st, true)} />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="From Date & Time">
        <RibbonButton label="Date" icon={<CalendarLtrRegular fontSize={32} />} disabled={!st.one || !st.date} menu={() => dateMenu(st, true)} />
        <RibbonButton label="Time" icon={<ClockRegular fontSize={32} />} disabled={!st.one || !st.time} menu={() => timeMenu(st, true)} />
        <RibbonButton label="Duration" icon={<TimerRegular fontSize={32} />} disabled={!st.one || !st.duration} menu={() => durationMenu(st, true)} />
      </RibbonGroup>
    </>
  )
}

function ViewTab({ st }: { st: RState }) {
  const view = usePq((s) => s.view)
  const setView = usePq((s) => s.setView)
  return (
    <>
      <RibbonGroup label="Layout">
        <RibbonButton label="Query Settings" icon={<PanelRightRegular fontSize={32} />} checked={view.settingsOpen} onClick={() => setView({ settingsOpen: !view.settingsOpen })} />
        <RibbonControl>
          <Checkbox label="Formula Bar" checked={view.formulaBar} onChange={(v) => setView({ formulaBar: v })} />
        </RibbonControl>
      </RibbonGroup>
      <RibbonGroup label="Data Preview">
        <div className="wbi-pq-rchecks">
          <Checkbox label="Monospaced" checked={view.monospaced} onChange={(v) => setView({ monospaced: v })} />
          <Checkbox label="Show whitespace" checked={view.whitespace} onChange={(v) => setView({ whitespace: v })} />
          <Checkbox label="Column quality" checked={view.quality} onChange={(v) => setView({ quality: v })} />
        </div>
        <div className="wbi-pq-rchecks">
          <Checkbox label="Column distribution" checked={view.distribution} onChange={(v) => setView({ distribution: v })} />
          <Checkbox label="Column profile" checked={view.profile} onChange={(v) => setView({ profile: v })} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Advanced">
        <RibbonButton label="Advanced Editor" icon={<CodeRegular fontSize={32} />} disabled={!st.query} onClick={() => st.query && openPqDialog({ id: 'advanced', queryId: st.query.id })} />
      </RibbonGroup>
    </>
  )
}

function fileMenu(): MenuItem[] {
  return [
    { label: 'Close & Apply', icon: <SaveArrowRightRegular fontSize={16} />, onClick: closeAndApply },
    { label: 'Apply', onClick: applyAction },
    {
      label: 'Discard & Close',
      onClick: () => {
        discardChanges()
        useApp.getState().setView('report')
      }
    },
    { separator: true },
    { label: 'Save', onClick: () => void save() },
    { separator: true },
    { label: 'Options and settings', submenu: [{ label: 'Data source settings', onClick: () => openPqDialog({ id: 'dataSources' }) }, { label: 'Options', onClick: () => useShell.getState().openDialog({ id: 'options' }) }] }
  ]
}

export function PqRibbon() {
  const [tab, setTab] = useState<TabId>('home')
  const st = useRibbonState()
  const body: Record<TabId, ReactElement> = {
    home: <HomeTab st={st} />,
    transform: <TransformTab st={st} />,
    addColumn: <AddColumnTab st={st} />,
    view: <ViewTab st={st} />
  }
  return (
    <div className="wbi-ribbon wbi-pq-ribbon">
      <div className="wbi-ribbon__tabs" role="tablist">
        <FileTab />
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={cx('wbi-ribbon__tab', t.id === tab && 'is-active')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="wbi-ribbon__body" role="tabpanel">
        <div className="wbi-ribbon__groups">{body[tab]}</div>
      </div>
    </div>
  )
}

function FileTab() {
  return (
    <MenuButton className="wbi-ribbon__tab wbi-ribbon__tab--file" items={fileMenu}>
      File
    </MenuButton>
  )
}

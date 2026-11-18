/** Renders the open Power Query Editor dialog (see pqDialogs.ts). Mounted by the editor. */
import { AdvancedEditor } from './dialogs/AdvancedEditor'
import { CredentialsDialog, DataSourceSettingsDialog } from './dialogs/SourceDialogs'
import { ParametersDialog } from './dialogs/ParametersDialog'
import { MoveToGroupDialog, PropertiesDialog, RenameColumnDialog, StepPropertiesDialog } from './dialogs/QueryDialogs'
import { EnterDataDialog } from './dialogs/EnterDataDialog'
import { ChooseColumnsDialog, ColumnOpDialog, IndexColumnDialog, MergeColumnsDialog, PivotDialog, ReplaceDialog, RowsDialog, SplitDialog } from './dialogs/ColumnDialogs'
import { GroupByDialog } from './dialogs/GroupByDialog'
import { AppendDialog, MergeDialog } from './dialogs/CombineDialogs'
import { ConditionalColumnDialog, CustomColumnDialog } from './dialogs/AddColumnDialogs'
import { FilterRowsDialog } from './dialogs/FilterRowsDialog'
import { closePqDialog, usePqDialogs, type PqDialog } from './pqDialogs'

/** A stable key per dialog instance so reopening with other arguments resets its state. */
function keyOf(d: PqDialog): string {
  return JSON.stringify(d)
}

export function PqDialogHost() {
  const d = usePqDialogs((s) => s.dialog)
  if (!d) return null
  const k = keyOf(d)
  switch (d.id) {
    case 'advanced':
      return <AdvancedEditor key={k} queryId={d.queryId} onClose={closePqDialog} />
    case 'dataSources':
      return <DataSourceSettingsDialog key={k} />
    case 'credentials':
      return <CredentialsDialog key={k} source={d.source} returnTo={d.returnTo} />
    case 'parameters':
      return <ParametersDialog key={k} queryId={d.queryId} create={d.create} />
    case 'properties':
      return <PropertiesDialog key={k} queryId={d.queryId} />
    case 'stepProperties':
      return <StepPropertiesDialog key={k} step={d.step} />
    case 'enterData':
      return <EnterDataDialog key={k} step={d.step} />
    case 'chooseColumns':
      return <ChooseColumnsDialog key={k} />
    case 'groupBy':
      return <GroupByDialog key={k} step={d.step} />
    case 'merge':
      return <MergeDialog key={k} asNew={d.asNew} step={d.step} />
    case 'append':
      return <AppendDialog key={k} asNew={d.asNew} step={d.step} />
    case 'split':
      return <SplitDialog key={k} mode={d.mode} column={d.column} step={d.step} />
    case 'replace':
      return <ReplaceDialog key={k} columns={d.columns} errors={d.errors} step={d.step} />
    case 'pivot':
      return <PivotDialog key={k} column={d.column} step={d.step} />
    case 'customColumn':
      return <CustomColumnDialog key={k} step={d.step} />
    case 'conditionalColumn':
      return <ConditionalColumnDialog key={k} step={d.step} />
    case 'filterRows':
      return <FilterRowsDialog key={k} column={d.column} op={d.op} step={d.step} />
    case 'rows':
      return <RowsDialog key={k} kind={d.kind} step={d.step} />
    case 'columnOp':
      return <ColumnOpDialog key={k} op={d.op} insert={d.insert} />
    case 'mergeColumns':
      return <MergeColumnsDialog key={k} insert={d.insert} />
    case 'indexColumn':
      return <IndexColumnDialog key={k} step={d.step} />
    case 'renameColumn':
      return <RenameColumnDialog key={k} column={d.column} />
    case 'moveToGroup':
      return <MoveToGroupDialog key={k} queryId={d.queryId} />
  }
  return null
}

/**
 * Modeling commands & dialogs — public entry point.
 *
 * The shell's `runModelingCommand(cmd, arg)` (app/commands.ts) calls `openModelingDialog(cmd, arg)`.
 * Ribbon/context menus can also import the command functions directly.
 */
import * as cmds from './commands'
import './ribbonTabs'

export {
  newMeasure,
  newColumn,
  newTable,
  openQuickMeasure,
  openNumericRangeParameter,
  openFieldParameter,
  newCalculationGroup,
  openCalculationGroup,
  openManageRelationships,
  openNewRelationship,
  openEditRelationship,
  openMarkAsDateTable,
  openManageRoles,
  openViewAs,
  stopViewingAs,
  openEnterData,
  deleteField,
  setHidden
} from './commands'
export { ModelingDialogHost, showModelingDialog } from './host'
export { PropertiesPane, type PropertiesSelection } from './PropertiesPane'
export { ViewAsBanner } from './RolesDialogs'
export { FormatControls } from './FormatControls'

export type ModelingCommandName =
  | 'newMeasure'
  | 'newColumn'
  | 'newTable'
  | 'quickMeasure'
  | 'manageRelationships'
  | 'newRelationship'
  | 'markAsDateTable'
  | 'manageRoles'
  | 'viewAsRoles'
  | 'newParameter'
  | 'newFieldParameter'
  | 'newCalculationGroup'
  | 'newVisualCalculation'
  | 'enterData'

/**
 * Dispatch a modeling command. `arg` may be a table name (new measure/column, mark as date table,
 * enter-data edit). Returns false for commands not handled here (e.g. visual calculations).
 */
export function openModelingDialog(cmd: ModelingCommandName | string, arg?: unknown): boolean {
  const table = typeof arg === 'string' ? arg : undefined
  switch (cmd) {
    case 'newMeasure':
      cmds.newMeasure(table)
      return true
    case 'newColumn':
      cmds.newColumn(table)
      return true
    case 'newTable':
      cmds.newTable()
      return true
    case 'quickMeasure':
      cmds.openQuickMeasure()
      return true
    case 'manageRelationships':
      cmds.openManageRelationships()
      return true
    case 'newRelationship':
      cmds.openNewRelationship(typeof arg === 'object' && arg ? (arg as Parameters<typeof cmds.openNewRelationship>[0]) : undefined)
      return true
    case 'markAsDateTable':
      cmds.openMarkAsDateTable(table)
      return true
    case 'manageRoles':
      cmds.openManageRoles()
      return true
    case 'viewAsRoles':
      cmds.openViewAs()
      return true
    case 'newParameter':
      cmds.openNumericRangeParameter()
      return true
    case 'newFieldParameter':
      cmds.openFieldParameter(table)
      return true
    case 'newCalculationGroup':
      void cmds.newCalculationGroup()
      return true
    case 'enterData':
      cmds.openEnterData(table)
      return true
    default:
      return false
  }
}

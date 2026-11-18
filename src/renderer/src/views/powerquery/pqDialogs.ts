/**
 * Power Query Editor dialogs: which one is open (rendered by <PqDialogHost/>). Ribbon buttons, menus
 * and the Applied Steps gear open them with `openPqDialog`. `step` = the applied step being edited
 * ("Edit Settings"): the dialog is prefilled from that step's formula and replaces it on OK.
 */
import { create } from 'zustand'
import type { DataSourceRef } from '@core/data/queries'
import type { FilterOp } from './logic/filters'
import type { ColumnOp } from './logic/transforms'

export type RowsDialogKind = 'keepTop' | 'keepBottom' | 'keepRange' | 'removeTop' | 'removeBottom' | 'removeAlternate'

export type PqDialog =
  | { id: 'advanced'; queryId: string }
  | { id: 'dataSources' }
  | { id: 'credentials'; source: DataSourceRef; returnTo?: 'dataSources' }
  | { id: 'parameters'; queryId?: string; create?: boolean }
  | { id: 'properties'; queryId: string }
  | { id: 'stepProperties'; step: string }
  | { id: 'enterData'; step?: string }
  | { id: 'chooseColumns' }
  | { id: 'groupBy'; step?: string }
  | { id: 'merge'; asNew?: boolean; step?: string }
  | { id: 'append'; asNew?: boolean; step?: string }
  | { id: 'split'; mode: 'delimiter' | 'positions'; column: string; step?: string }
  | { id: 'replace'; columns: string[]; errors?: boolean; step?: string }
  | { id: 'pivot'; column: string; step?: string }
  | { id: 'customColumn'; step?: string }
  | { id: 'conditionalColumn'; step?: string }
  | { id: 'filterRows'; column: string; op?: FilterOp; step?: string }
  | { id: 'rows'; kind: RowsDialogKind; step?: string }
  /** argument dialogs of Transform / Add Column ops (Add Prefix, Extract First Characters, Round…) */
  | { id: 'columnOp'; op: ColumnOp; insert: boolean; step?: string }
  | { id: 'mergeColumns'; insert: boolean; step?: string }
  | { id: 'indexColumn'; step?: string }
  | { id: 'renameColumn'; column: string }
  | { id: 'moveToGroup'; queryId: string }

export const usePqDialogs = create<{ dialog: PqDialog | null }>(() => ({ dialog: null }))

export function openPqDialog(d: PqDialog): void {
  usePqDialogs.setState({ dialog: d })
}

export function closePqDialog(): void {
  usePqDialogs.setState({ dialog: null })
}

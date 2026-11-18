/**
 * Open/close state of the conditional formatting (fx) dialog. One dialog at a time, like PBI.
 */
import { create } from 'zustand'
import type { CFTarget } from './target'

interface CfDialogState {
  target: CFTarget | null
  open(target: CFTarget): void
  close(): void
}

export const useCfDialog = create<CfDialogState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null })
}))

export function openCfDialog(target: CFTarget): void {
  useCfDialog.getState().open(target)
}

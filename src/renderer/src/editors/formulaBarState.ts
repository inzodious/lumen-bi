/** Shared formula bar state: focus requests (New measure…), expanded, and user options (persisted per viewer). */
import { create } from 'zustand'

interface FormulaBarState {
  /** bumps when a command wants the formula bar focused (caret at the end) */
  focusToken: number
  /** a focus request not yet consumed (the bar for the new object may mount after the request) */
  pendingFocus: boolean
  expanded: boolean
  /** apply "Format DAX" when committing */
  formatOnCommit: boolean
  /** show the live value chip while editing a measure */
  livePreview: boolean
  setExpanded(v: boolean): void
  setOption(key: 'formatOnCommit' | 'livePreview', v: boolean): void
}

const KEY = 'wbi.formulaBar.options'
function loadOptions(): { formatOnCommit: boolean; livePreview: boolean } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    const o = raw ? (JSON.parse(raw) as Partial<{ formatOnCommit: boolean; livePreview: boolean }>) : {}
    return { formatOnCommit: o.formatOnCommit ?? false, livePreview: o.livePreview ?? true }
  } catch {
    return { formatOnCommit: false, livePreview: true }
  }
}

export const useFormulaBarState = create<FormulaBarState>((set, get) => ({
  focusToken: 0,
  pendingFocus: false,
  expanded: false,
  ...loadOptions(),
  setExpanded: (expanded) => set({ expanded }),
  setOption(key, v) {
    set({ [key]: v } as Pick<FormulaBarState, typeof key>)
    try {
      localStorage.setItem(KEY, JSON.stringify({ formatOnCommit: get().formatOnCommit, livePreview: get().livePreview }))
    } catch {
      /* storage unavailable: option lasts for the session */
    }
  }
}))

export function requestFormulaBarFocus(): void {
  useFormulaBarState.setState((s) => ({ focusToken: s.focusToken + 1, pendingFocus: true }))
}

/** Consume a pending focus request (returns true when the caller should focus). */
export function takeFormulaBarFocus(): boolean {
  if (!useFormulaBarState.getState().pendingFocus) return false
  useFormulaBarState.setState({ pendingFocus: false })
  return true
}

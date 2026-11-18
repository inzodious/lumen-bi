/**
 * Undoable writes of conditional formatting values (one mutateReport per dialog OK / remove).
 */
import { useApp } from '../../../state/store'
import { findPage, findVisual } from '../../../report/pbir'
import { visualBag } from '../objects'
import type { ApplyTo } from './rules'
import { writeCF, type CFTarget } from './target'

/** Write (raw) or remove (undefined) a target's conditional formatting. */
export function commitCF(target: CFTarget, raw: any, applyTo: ApplyTo = 'values'): void {
  useApp.getState().mutateReport(raw === undefined ? 'Remove conditional formatting' : 'Conditional formatting', (r) => {
    const v = findVisual(findPage(r, target.pageName), target.visualName)
    const bag = visualBag(v?.json, target.container, true)
    if (bag) writeCF(bag, target, raw, applyTo)
  })
}

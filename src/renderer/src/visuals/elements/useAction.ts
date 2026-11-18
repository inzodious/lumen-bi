import { useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import type { VisualHostContext } from '../contract'
import { actionEnabled, drillthroughState, readAction, runAction, type ActionSpec } from './actions'
import { evaluateField } from './evaluate'
import { actionAllowed } from './util'

export interface ActionBinding {
  spec?: ActionSpec
  target?: string
  enabled: boolean
  /** true when clicking does something in the current mode (cursor: pointer) */
  interactive: boolean
  onClick(e: ReactMouseEvent): void
  title?: string
}

/** Resolve the visualLink action of a visual (with measure-bound destinations) into a click handler. */
export function useAction(visualJson: any, ctx: VisualHostContext): ActionBinding {
  const spec = useMemo(() => readAction(visualJson), [visualJson])
  const target = useMemo(() => {
    if (!spec) return undefined
    if (spec.targetExpr) {
      const v = evaluateField(ctx, spec.targetExpr).value
      return v === null || v === undefined || v === '' ? undefined : String(v)
    }
    return spec.target
  }, [spec, ctx])
  const dt = spec?.type === 'Drillthrough' ? drillthroughState(target, ctx.report, ctx.pageSelection ?? (ctx.selection.length ? ctx.selection : undefined)) : undefined
  const enabled = dt ? dt.enabled : actionEnabled(spec, target, ctx.report)
  let title = dt ? (dt.enabled ? spec?.tooltip ?? dt.tooltip : spec?.disabledTooltip ?? dt.tooltip) : enabled ? spec?.tooltip : spec?.disabledTooltip ?? spec?.tooltip
  // Power BI Desktop (edit mode) explains how to follow an enabled action
  if (spec && enabled && ctx.mode === 'edit') title = 'CTRL+click here to follow link'
  return {
    spec,
    target,
    enabled,
    interactive: !!spec && enabled && ctx.mode === 'view',
    title,
    onClick(e) {
      if (!spec || !enabled || !actionAllowed(ctx.mode, e)) return
      e.stopPropagation()
      runAction(spec, target, ctx.actions, ctx.report, dt?.identity)
    }
  }
}

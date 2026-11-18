/** Shared mock host context for the scatter / waterfall / funnel / treemap / gauge tests. */
import { resolveTheme } from '@core/report/theme'
import { createMockEngine } from '../../../gallery/mockEngine'
import { buildSampleModel } from '../../../gallery/sampleData'
import type { VisualHostContext } from '../../../contract'

const { model, data } = buildSampleModel()
export const engine = createMockEngine(model, data)
export const theme = resolveTheme()

export function mockCtx(extra: Partial<VisualHostContext> = {}): VisualHostContext {
  return {
    engine,
    theme,
    format: engine.format,
    locale: 'en-US',
    mode: 'view',
    filters: [],
    selection: [],
    select() {},
    setSlicerFilter() {},
    drill: { level: 0, path: [] },
    setDrill() {},
    showTooltip() {},
    showContextMenu() {},
    actions: {} as VisualHostContext['actions'],
    report: {} as VisualHostContext['report'],
    updateVisual() {},
    ...extra
  }
}

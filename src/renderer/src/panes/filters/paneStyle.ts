/**
 * Filter pane styling from Format ▸ Filter pane / Filter cards (page.json `objects.outspacePane` / `filterCard` with
 * `$id` Available | Applied) and the report theme (`visualStyles['*']['*'].outspacePane / filterCard`), exposed as CSS
 * variables consumed by filters.css. Unset values keep the default PBI Desktop look.
 */
import type { CSSProperties } from 'react'
import { decodeValue, rawProp } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import { withTransparency } from '@core/report/theme'
import type { PageDocument } from '@core/report/types'
import { fontStack, ptToPx } from '../../report/chrome'

export function filterPaneStyle(page: PageDocument | undefined, theme: ResolvedTheme): CSSProperties {
  const pc = { visualType: 'page', objects: page?.json?.objects, theme }
  const val = (object: string, prop: string, id?: string): unknown => {
    const raw = rawProp(pc, object, prop, id ? { id } : undefined)
    return raw === undefined ? undefined : decodeValue(raw, theme)
  }
  const vars: Record<string, string> = {}
  const color = (name: string, v: unknown, transparency?: unknown) => {
    if (typeof v === 'string' && v) vars[name] = typeof transparency === 'number' ? withTransparency(v, transparency) : v
  }
  color('--fp-bg', val('outspacePane', 'backgroundColor'), val('outspacePane', 'transparency'))
  color('--fp-fg', val('outspacePane', 'foregroundColor'))
  color('--fp-input', val('outspacePane', 'inputBoxColor'))
  color('--fp-accent', val('outspacePane', 'checkboxAndApplyColor'))
  const border = val('outspacePane', 'border')
  if (border === false) vars['--fp-border'] = 'transparent'
  else color('--fp-border', val('outspacePane', 'borderColor'))
  const headerSize = val('outspacePane', 'headerSize')
  if (typeof headerSize === 'number' && headerSize > 0) vars['--fp-header-size'] = `${ptToPx(headerSize)}px`
  const font = val('outspacePane', 'fontFamily')
  if (typeof font === 'string' && font) vars['--fp-font'] = fontStack(font)
  for (const [id, prefix] of [
    ['Available', '--fc'],
    ['Applied', '--fca']
  ] as const) {
    color(`${prefix}-bg`, val('filterCard', 'backgroundColor', id), val('filterCard', 'transparency', id))
    color(`${prefix}-fg`, val('filterCard', 'foregroundColor', id))
    color(`${prefix}-input`, val('filterCard', 'inputBoxColor', id))
    const b = val('filterCard', 'border', id)
    if (b === false) vars[`${prefix}-border`] = 'transparent'
    else color(`${prefix}-border`, val('filterCard', 'borderColor', id))
    const size = val('filterCard', 'textSize', id)
    if (typeof size === 'number' && size > 0) vars[`${prefix}-size`] = `${ptToPx(size)}px`
    const f = val('filterCard', 'fontFamily', id)
    if (typeof f === 'string' && f) vars[`${prefix}-font`] = fontStack(f)
  }
  return vars as CSSProperties
}

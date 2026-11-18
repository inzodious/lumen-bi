/**
 * The picture copy of an icon saved for Power BI: the icon component's own output (IconGlyph.tsx iconSvgElement,
 * rendered with react-dom/server's renderToStaticMarkup) as a standalone SVG document — `xmlns` on the root,
 * a 256 px intrinsic size, colours resolved to hex through the report theme, ids prefixed, no external references.
 * core/icons/bake.ts stores it (image visual: registered resource; card: data URI).
 */
import { BAKE_SIZE } from '@core/icons/bake'
import type { IconRef } from '@core/icons/types'
import type { ResolvedTheme } from '@core/report/theme'
import { iconSvgElement } from './IconGlyph'
import { getLoadedIconSet, loadIconSet, loadedServer } from './registry'

/** Id prefix inside saved pictures (each picture is its own SVG document; the prefix only keeps ids recognisable). */
export const PICTURE_ID_PREFIX = 'lumen-'

/**
 * The picture of an icon: an SVG document string, undefined while its set is not loaded, null when the set has no
 * such icon. Synchronous (used inside document edits: theme changes re-bake in the same undo step).
 */
export function renderIconPicture(ref: IconRef, theme: ResolvedTheme): string | null | undefined {
  const set = getLoadedIconSet(ref.set)
  const server = loadedServer()
  if (!set || !server) return undefined
  const el = iconSvgElement(set, ref, theme, { idPrefix: PICTURE_ID_PREFIX, size: BAKE_SIZE })
  return el ? server.renderToStaticMarkup(el) : null
}

/** renderIconPicture after loading the icon's set. */
export async function loadIconPicture(ref: IconRef, theme: ResolvedTheme): Promise<string | null> {
  await loadIconSet(ref.set)
  return renderIconPicture(ref, theme) ?? null
}

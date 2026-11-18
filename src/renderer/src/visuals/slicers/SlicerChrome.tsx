/** Shared slicer chrome: header (with eraser), search box, scoped stylesheet. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { fontStyle, ptToPx, type FontSpec } from '../common/textStyle'
import { EraserIcon, SearchIcon } from './icons'
import { outlineCss } from './slicerFormat'

/** Scoped CSS (hover states, scrollbars) — injected once per slicer root. */
export const SLICER_CSS = `
.wbi-slicer-root { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; user-select: none; }
.wbi-slicer-root *:focus { outline: none; }
.wbi-slicer-row { display: flex; align-items: center; cursor: pointer; white-space: nowrap; }
.wbi-slicer-row:hover { background: rgba(0,0,0,0.04); }
.wbi-slicer-scroll { overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #C8C6C4 transparent; }
.wbi-slicer-scroll::-webkit-scrollbar { width: 8px; }
.wbi-slicer-scroll::-webkit-scrollbar-thumb { background: #C8C6C4; border-radius: 4px; }
.wbi-slicer-eraser { opacity: 0; transition: opacity .1s; background: none; border: 0; padding: 2px; cursor: pointer; display: flex; color: #605E5C; }
.wbi-slicer-root:hover .wbi-slicer-eraser { opacity: 1; }
.wbi-slicer-eraser:hover { background: rgba(0,0,0,0.06); }
.wbi-slicer-tile { display: flex; align-items: center; justify-content: center; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box; }
.wbi-slicer-tile:hover { filter: brightness(0.96); }
.wbi-slicer-input { border: 1px solid #C8C6C4; background: #fff; box-sizing: border-box; min-width: 0; }
.wbi-slicer-input:hover { border-color: #8A8886; }
.wbi-slicer-input:focus { border-color: #605E5C; }
.wbi-slicer-select { appearance: none; -webkit-appearance: none; border: 1px solid #C8C6C4; background: #fff; box-sizing: border-box; cursor: pointer; }
.wbi-slicer-thumb { position: absolute; top: 50%; border-radius: 50%; background: #fff; box-sizing: border-box; cursor: grab; transform: translate(-50%, -50%); touch-action: none; }
.wbi-slicer-thumb:active { cursor: grabbing; }
.wbi-slicer-overlay { scrollbar-width: none; }
.wbi-slicer-overlay::-webkit-scrollbar { width: 0; height: 0; }
.wbi-slicer-vthumb { position: absolute; right: 1px; width: 6px; border-radius: 3px; background: #C8C6C4; opacity: 0; transition: opacity .15s; cursor: default; z-index: 1; }
.wbi-slicer-root:hover .wbi-slicer-vthumb, .wbi-slicer-vthumb:active { opacity: 1; }
.wbi-slicer-vthumb:hover { background: #A19F9D; }
.wbi-slicer-ddbox:focus-visible { outline: 1px dashed #605E5C; outline-offset: 1px; }
.wbi-slicer-chip { border: 1px solid #C8C6C4; border-radius: 12px; padding: 1px 8px; cursor: pointer; white-space: nowrap; flex: none; line-height: 1.4; }
.wbi-slicer-chip:hover { border-color: #605E5C; }
.wbi-slicer-pill { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; background: #F3F2F1; border: 1px solid #E1DFDD; border-radius: 2px; padding: 0 2px 0 6px; line-height: 1.5; box-sizing: border-box; }
.wbi-slicer-pill-x { display: inline-flex; align-items: center; justify-content: center; padding: 3px; border-radius: 2px; color: #605E5C; cursor: pointer; flex: none; }
.wbi-slicer-pager { border: 0; background: none; padding: 2px 4px; display: flex; cursor: pointer; color: #252423; border-radius: 2px; }
.wbi-slicer-pager:hover:not(:disabled) { background: rgba(0,0,0,0.06); }
.wbi-slicer-pager:disabled { color: #C8C6C4; cursor: default; }
.wbi-slicer-pill-x:hover { background: rgba(0,0,0,0.08); color: #252423; }
.wbi-slicer-standin { position: absolute; right: 24px; top: 2px; z-index: 2; font: 600 10px/14px 'Segoe UI', sans-serif; color: #8A6D00; background: #FFF4CE; border: 1px solid #F2D16B; border-radius: 2px; padding: 0 4px; pointer-events: auto; cursor: help; white-space: nowrap; }
`

export function SlicerStyle() {
  return <style>{SLICER_CSS}</style>
}

export interface HeaderProps {
  show: boolean
  text: string
  font: FontSpec
  background?: string
  outline: number
  outlineColor: string
  outlineWeight: number
  canClear: boolean
  onClear(): void
  extra?: ReactNode
}

export function SlicerHeader(p: HeaderProps) {
  if (!p.show) {
    // PBI still offers the eraser in the visual header area when the slicer header is hidden
    return p.canClear ? (
      <button className="wbi-slicer-eraser" title="Clear selections" style={{ position: 'absolute', right: 0, top: 0, zIndex: 2 }} onClick={p.onClear}>
        <EraserIcon />
      </button>
    ) : null
  }
  const fs = fontStyle(p.font)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: p.background,
        padding: '2px 0 4px 0',
        flex: 'none',
        ...outlineCss(p.outline, p.outlineColor, p.outlineWeight)
      }}
    >
      <div style={{ ...fs, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }} title={p.text}>
        {p.text}
      </div>
      {p.extra}
      {p.canClear && (
        <button className="wbi-slicer-eraser" title="Clear selections" onClick={p.onClear}>
          <EraserIcon size={Math.max(12, Math.round(ptToPx(p.font.size) * 0.95))} />
        </button>
      )}
    </div>
  )
}

export function SearchBox({
  value,
  onChange,
  font,
  autoFocus,
  background,
  borderColor = '#C8C6C4',
  onKeyDown
}: {
  value: string
  onChange(v: string): void
  font: FontSpec
  autoFocus?: boolean
  /** PBI searchBox.background / borderColor */
  background?: string
  borderColor?: string
  onKeyDown?(e: React.KeyboardEvent<HTMLInputElement>): void
}) {
  const [focus, setFocus] = useState(false)
  const fs = fontStyle(font)
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 2px',
    borderBottom: `1px solid ${focus ? '#605E5C' : borderColor}`,
    background,
    margin: '0 0 2px 0',
    flex: 'none'
  }
  return (
    <div style={style}>
      <SearchIcon size={Math.round(ptToPx(font.size) * 0.9)} color="#605E5C" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          onKeyDown?.(e)
        }}
        placeholder="Search"
        style={{ ...fs, color: font.color, border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0, padding: 0 }}
      />
    </div>
  )
}

/** The text of the stand-in notice (also its tooltip): never names the saved value. */
export const STANDIN_NOTE =
  'Sample data: the saved selection is a real name or id that is kept out of the generated rows. It is shown as an invented stand-in value, and the page is filtered to that value. Refresh from the source for real data.'

/** Notice on a slicer whose saved selection reads as a sample-data stand-in (core/data/standIns.ts). */
export function StandInBadge() {
  return (
    <span className="wbi-slicer-standin" role="note" aria-label="Sample stand-in selection" title={STANDIN_NOTE}>
      Sample stand-in
    </span>
  )
}

/** Error / empty message in the slicer body. */
export function SlicerMessage({ text, font }: { text: string; font: FontSpec }) {
  return <div style={{ ...fontStyle({ ...font, color: '#605E5C' }), padding: 4, whiteSpace: 'normal' }}>{text}</div>
}

/**
 * New text slicer (`textSlicer`): a search box that filters its field with `Contains`.
 * Objects: inputTextBox (padding*, accentBarShow, accentBarColor, placeholder, placeholderFontSize,
 * placeholderColor, font*), general.filter (persisted Contains filter).
 */
import { useEffect, useState } from 'react'
import { getColor, getProp, makePropContext } from '@core/report/props'
import type { VisualProps } from '../contract'
import { fontStyle, ptToPx, readFont } from '../common/textStyle'
import { containsFilter, parseContainsFilter } from './filterModel'
import { DismissIcon, SendIcon } from './icons'
import { SlicerStyle } from './SlicerChrome'
import { currentFilter, slicerProjections } from './slicerData'
import { cleanFamily } from './slicerFormat'

export function readTextSlicerFormat(visualJson: any, theme: any) {
  const pc = makePropContext(visualJson, theme)
  const num = (prop: string, d: number) => {
    const v = Number(getProp<any>(pc, 'inputTextBox', prop, d))
    return Number.isFinite(v) ? v : d
  }
  const font = readFont(pc, 'inputTextBox', { size: 10, color: theme.foreground, family: 'Segoe UI' })
  font.family = cleanFamily(font.family)
  return {
    padding: { top: num('paddingTop', 4), right: num('paddingRight', 4), bottom: num('paddingBottom', 4), left: num('paddingLeft', 4) },
    accentBar: getProp<boolean>(pc, 'inputTextBox', 'accentBarShow', true) !== false,
    accentColor: getColor(pc, 'inputTextBox', 'accentBarColor', theme.dataColors?.[0] ?? '#118DFF'),
    accentWeight: num('accentBarWeight', 2),
    placeholder: getProp<string>(pc, 'inputTextBox', 'placeholder', 'Type here'),
    placeholderSize: num('placeholderFontSize', font.size),
    placeholderColor: getColor(pc, 'inputTextBox', 'placeholderColor', '#605E5C'),
    background: getColor(pc, 'inputTextBox', 'background', '#FFFFFF'),
    border: getColor(pc, 'inputTextBox', 'borderColor', '#C8C6C4'),
    font
  }
}

export function TextSlicerVisual({ visual, ctx, height }: VisualProps) {
  const json = visual.json
  const fmt = readTextSlicerFormat(json, ctx.theme)
  const field = slicerProjections(json)[0]
  const filter = currentFilter(json, ctx)
  const applied = parseContainsFilter(filter) ?? ''
  const [text, setText] = useState(applied)
  const [focus, setFocus] = useState(false)
  useEffect(() => setText(applied), [applied])
  if (!field) return null
  const apply = (t: string) => ctx.setSlicerFilter(containsFilter(field.expr, t.trim()))
  const fs = fontStyle(fmt.font)
  const lineH = Math.ceil(ptToPx(Math.max(fmt.font.size, fmt.placeholderSize)) * 1.36)
  const boxH = Math.min(height, lineH + fmt.padding.top + fmt.padding.bottom + 2)
  const iconSize = Math.round(ptToPx(fmt.font.size) * 1.05)
  const dirty = text.trim() !== applied
  return (
    <div className="wbi-slicer-root" style={{ justifyContent: 'flex-start' }}>
      <SlicerStyle />
      <style>{`.wbi-textslicer-input::placeholder{color:${fmt.placeholderColor};font-size:${ptToPx(fmt.placeholderSize)}px;opacity:1}`}</style>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          height: boxH,
          background: fmt.background,
          border: `1px solid ${focus ? '#605E5C' : fmt.border}`,
          borderBottom: fmt.accentBar ? `${fmt.accentWeight}px solid ${fmt.accentColor}` : undefined,
          padding: `${fmt.padding.top}px ${fmt.padding.right}px ${fmt.padding.bottom}px ${fmt.padding.left}px`,
          gap: 6,
          boxSizing: 'border-box'
        }}
      >
        <input
          className="wbi-textslicer-input"
          value={text}
          placeholder={fmt.placeholder}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply(text)
            if (e.key === 'Escape') setText(applied)
          }}
          style={{ ...fs, border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0, padding: 0, height: '100%' }}
        />
        {(text || applied) && (
          <button
            title="Clear"
            onClick={() => {
              setText('')
              if (applied) apply('')
            }}
            style={{ border: 0, background: 'none', padding: 2, cursor: 'pointer', display: 'flex', color: '#605E5C' }}
          >
            <DismissIcon size={Math.round(iconSize * 0.75)} />
          </button>
        )}
        <button
          title="Apply"
          disabled={!dirty}
          onClick={() => apply(text)}
          style={{ border: 0, background: 'none', padding: 2, cursor: dirty ? 'pointer' : 'default', display: 'flex', color: dirty ? fmt.accentColor : '#C8C6C4' }}
        >
          <SendIcon size={iconSize} />
        </button>
      </div>
    </div>
  )
}

/**
 * PBI "Customize current theme": Name and colors · Text · Visuals · Page · Filter pane.
 * Edits a copy of the current theme JSON; Apply writes it as the report's custom theme (a
 * RegisteredResources CustomTheme item + themeCollection.customTheme, see app/themes setReportTheme).
 *
 * Where PBI's dialog writes each setting (same keys as a theme exported from PBI Desktop):
 *  - colors → top-level dataColors / good,neutral,bad / maximum,center,minimum / structural keys
 *  - text → textClasses.label (General), title, callout (Cards and KPIs), header (Tab headers)
 *  - visuals → visualStyles['*']['*'].background / border / visualHeader / visualTooltip
 *  - page → visualStyles.page['*'].outspace (wallpaper) / background
 *  - filter pane → visualStyles['*']['*'].outspacePane and filterCard ($id Available / Applied),
 *    which is also where the CY24SU10 base theme defines them.
 * Values not set in the draft display the base theme's value (not the replaced custom theme's).
 */
import { useMemo, useState } from 'react'
import { resolveTheme, type ResolvedTheme } from '@core/report/theme'
import { useApp } from '../state/store'
import { currentThemeJson, applyThemeJson, type ThemeJson } from '../app/themes'
import { Button, ColorPicker, Dropdown, Modal, NumberField, Pivot, TextField, Toggle, Slider } from '../app/ui'
import { cx } from '../app/ui/cx'
import { cloneDeep } from '@core/clone'

export const THEME_FONTS = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'DIN',
  'Georgia',
  'Lucida Sans Unicode',
  'Segoe (Bold)',
  'Segoe UI',
  'Segoe UI Light',
  'Segoe UI Semibold',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
]

type Section = 'colors' | 'text' | 'visuals' | 'page' | 'filters'
const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'colors', label: 'Name and colors' },
  { key: 'text', label: 'Text' },
  { key: 'visuals', label: 'Visuals' },
  { key: 'page', label: 'Page' },
  { key: 'filters', label: 'Filter pane' }
]

// --- visualStyles helpers (pure) ------------------------------------------------------------

export function getStyle(t: ThemeJson, visual: string, object: string, prop: string, id?: string): any {
  const arr: any[] | undefined = t.visualStyles?.[visual]?.['*']?.[object]
  const bag = id ? arr?.find((b) => b.$id === id) : arr?.find((b) => !b.$id) ?? arr?.[0]
  return bag?.[prop]
}

export function setStyle(t: ThemeJson, visual: string, object: string, prop: string, value: unknown, id?: string): void {
  t.visualStyles ??= {}
  t.visualStyles[visual] ??= {}
  t.visualStyles[visual]['*'] ??= {}
  const arr: any[] = (t.visualStyles[visual]['*'][object] ??= [])
  let bag = id ? arr.find((b) => b.$id === id) : arr.find((b) => !b.$id)
  if (!bag) {
    bag = id ? { $id: id } : {}
    arr.push(bag)
  }
  if (value === undefined) delete bag[prop]
  else bag[prop] = value
}

/** Value of a visualStyles property in a resolved theme ('page' / specific visual falls back to '*'). */
export function resolvedStyle(theme: ResolvedTheme, visual: string, object: string, prop: string, id?: string): any {
  for (const v of visual === '*' ? ['*'] : [visual, '*']) {
    const arr: any[] | undefined = theme.visualStyles?.[v]?.['*']?.[object]
    const bag = id ? arr?.find((b) => b.$id === id) : arr?.find((b) => !b.$id)
    if (bag && prop in bag) return bag[prop]
  }
  return undefined
}

/**
 * Final theme JSON for Apply: trims the name, drops empty visualStyles bags / objects / visuals and
 * empty textClasses, and removes unset top-level keys. Pure (unit-tested).
 */
export function buildCustomTheme(draft: ThemeJson): ThemeJson {
  const out = cloneDeep(draft) as ThemeJson
  out.name = (out.name ?? '').trim() || 'Custom theme'
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null) delete out[k]
  if (out.visualStyles) {
    for (const [visual, styles] of Object.entries<any>(out.visualStyles)) {
      for (const [style, objects] of Object.entries<any>(styles ?? {})) {
        for (const [object, arr] of Object.entries<any>(objects ?? {})) {
          const kept = (Array.isArray(arr) ? arr : []).filter((b: any) => b && Object.keys(b).some((k) => k !== '$id'))
          if (kept.length) objects[object] = kept
          else delete objects[object]
        }
        if (!Object.keys(objects ?? {}).length) delete styles[style]
      }
      if (!Object.keys(styles ?? {}).length) delete out.visualStyles[visual]
    }
    if (!Object.keys(out.visualStyles).length) delete out.visualStyles
  }
  if (out.textClasses) {
    for (const [k, v] of Object.entries(out.textClasses)) if (!v || !Object.keys(v).length) delete out.textClasses[k]
    if (!Object.keys(out.textClasses).length) delete out.textClasses
  }
  return out
}

/** Upper bound for theme colors in the dialog (the CY24SU10 base theme has 41). */
export const MAX_THEME_COLORS = 41

const solid = (c: string) => ({ solid: { color: c } })
const colorOf = (v: any): string | undefined => (typeof v === 'string' ? v : v?.solid?.color)

export function CustomizeThemeDialog({ onClose }: { onClose(): void }) {
  const resolved = useApp((s) => s.theme)
  const baseJson = useApp((s) => s.project?.report?.theme.base)
  // fallbacks shown for unset values: the base theme alone (the custom theme is being replaced)
  const base = useMemo(() => resolveTheme(baseJson), [baseJson])
  const [draft, setDraft] = useState<ThemeJson>(() => {
    const t = currentThemeJson()
    return { ...t, name: t.name && t.name !== 'CY24SU10' ? t.name : 'Custom theme', dataColors: [...(t.dataColors ?? resolved.dataColors)] }
  })
  const [section, setSection] = useState<Section>('colors')
  const [colorTab, setColorTab] = useState<'theme' | 'sentiment' | 'divergent' | 'structural'>('theme')
  const [textTab, setTextTab] = useState<'label' | 'title' | 'callout' | 'header'>('label')
  const [visualTab, setVisualTab] = useState<'background' | 'border' | 'header' | 'tooltip'>('background')
  const [filterTab, setFilterTab] = useState<'pane' | 'cards'>('pane')
  const [moreColors, setMoreColors] = useState(false)

  const edit = (fn: (t: ThemeJson) => void) =>
    setDraft((d) => {
      const n = cloneDeep(d)
      fn(n)
      return n
    })
  const themeColors = useMemo(() => ({ background: draft.background ?? '#FFFFFF', foreground: draft.foreground ?? '#252423', dataColors: draft.dataColors }), [draft])
  const colorField = (label: string, value: string | undefined, onChange: (c: string | undefined) => void, resettable = true) => (
    <div className="wbi-field">
      <span className="wbi-field__label">{label}</span>
      <ColorPicker value={value} themeColors={themeColors} onChange={(c) => onChange(c)} onReset={resettable ? () => onChange(undefined) : undefined} />
    </div>
  )
  const styleRaw = (visual: string, object: string, prop: string, id?: string) => getStyle(draft, visual, object, prop, id) ?? resolvedStyle(base, visual, object, prop, id)
  const topColor = (key: keyof ThemeJson, label: string, fallback: string) =>
    colorField(label, (draft[key] as string | undefined) ?? ((base as any)[key] as string | undefined) ?? fallback, (c) =>
      edit((t) => {
        if (c === undefined) delete t[key]
        else (t as any)[key] = c
      })
    )
  const styleColor = (label: string, visual: string, object: string, prop: string, fallback?: string, id?: string) => colorField(label, colorOf(styleRaw(visual, object, prop, id)) ?? fallback, (c) => edit((t) => setStyle(t, visual, object, prop, c ? solid(c) : undefined, id)))
  const styleNumber = (label: string, visual: string, object: string, prop: string, fallback: number, opts: { min?: number; max?: number; slider?: boolean; suffix?: string; id?: string } = {}) => {
    const v = styleRaw(visual, object, prop, opts.id)
    const value = typeof v === 'number' ? v : fallback
    return opts.slider ? (
      <div className="wbi-field">
        <span className="wbi-field__label">{label}</span>
        <Slider value={value} min={opts.min ?? 0} max={opts.max ?? 100} suffix={opts.suffix} onChange={(n) => edit((t) => setStyle(t, visual, object, prop, n, opts.id))} />
      </div>
    ) : (
      <NumberField label={label} value={value} min={opts.min} max={opts.max} onChange={(n) => edit((t) => setStyle(t, visual, object, prop, n, opts.id))} />
    )
  }
  const styleToggle = (label: string, visual: string, object: string, prop: string, fallback: boolean, id?: string) => {
    const v = styleRaw(visual, object, prop, id)
    return (
      <div className="wbi-field">
        <span className="wbi-field__label">{label}</span>
        <Toggle on={typeof v === 'boolean' ? v : fallback} showState onChange={(on) => edit((t) => setStyle(t, visual, object, prop, on, id))} />
      </div>
    )
  }
  const styleFont = (label: string, visual: string, object: string, prop: string, fallback: string) => {
    const v = styleRaw(visual, object, prop)
    const cur = typeof v === 'string' ? v.split(',')[0].replace(/['"]/g, '').trim() : fallback
    return <Dropdown label={label} value={THEME_FONTS.includes(cur) ? cur : fallback} options={THEME_FONTS.map((f) => ({ value: f, label: f, fontFamily: f }))} onChange={(f) => edit((t) => setStyle(t, visual, object, prop, f))} />
  }

  const textClass = (cls: 'label' | 'title' | 'callout' | 'header') => {
    const tc = { ...(base.textClasses[cls] ?? {}), ...(draft.textClasses?.[cls] ?? {}) }
    const set = (patch: Record<string, unknown>) =>
      edit((t) => {
        t.textClasses ??= {}
        t.textClasses[cls] = { ...(base.textClasses[cls] ?? {}), ...(t.textClasses[cls] ?? {}), ...patch }
      })
    return (
      <div className="wbi-dlg-grid3">
        <Dropdown label="Font family" value={tc.fontFace ?? 'Segoe UI'} options={THEME_FONTS.map((f) => ({ value: f, label: f, fontFamily: f }))} onChange={(f) => set({ fontFace: f })} />
        <NumberField label="Font size (pt)" value={tc.fontSize ?? 10} min={6} max={72} onChange={(n) => n !== undefined && set({ fontSize: n })} />
        {colorField('Font color', tc.color ?? draft.foreground ?? '#252423', (c) => set({ color: c ?? base.textClasses[cls]?.color ?? base.foreground }))}
      </div>
    )
  }

  const apply = () => {
    applyThemeJson(buildCustomTheme(draft))
    onClose()
  }

  return (
    <Modal
      title="Customize theme"
      onClose={onClose}
      width="min(820px, calc(100vw - 64px))"
      height="min(620px, calc(100vh - 64px))"
      footer={
        <>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-dlg-split">
        <div className="wbi-dlg-nav">
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" className={cx('wbi-dlg-nav__item', section === s.key && 'is-active')} onClick={() => setSection(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="wbi-dlg-main">
          {section === 'colors' && (
            <>
              <TextField label="Name" value={draft.name} onChange={(v) => edit((t) => void (t.name = v))} />
              <Pivot
                value={colorTab}
                onChange={setColorTab}
                tabs={[
                  { key: 'theme', label: 'Theme colors' },
                  { key: 'sentiment', label: 'Sentiment colors' },
                  { key: 'divergent', label: 'Divergent colors' },
                  { key: 'structural', label: 'Structural colors' }
                ]}
              />
              {colorTab === 'theme' && (
                <>
                  <div className="wbi-ct-colors">
                    {draft.dataColors.slice(0, moreColors ? MAX_THEME_COLORS : 8).map((c, i) => (
                      <div key={i}>
                        {colorField(`Color ${i + 1}`, c, (nc) => edit((t) => void (t.dataColors[i] = nc ?? base.dataColors[i] ?? c)), i < base.dataColors.length)}
                      </div>
                    ))}
                  </div>
                  <div className="wbi-ct-morerow">
                    <button type="button" className="wbi-link" onClick={() => setMoreColors((m) => !m)}>
                      {moreColors ? 'Show less' : `Show more (${Math.max(0, draft.dataColors.length - 8)})`}
                    </button>
                    {moreColors && draft.dataColors.length < MAX_THEME_COLORS && (
                      <button type="button" className="wbi-link" onClick={() => edit((t) => void t.dataColors.push(base.dataColors[t.dataColors.length] ?? t.dataColors[t.dataColors.length % 8] ?? '#118DFF'))}>
                        Add color
                      </button>
                    )}
                    {moreColors && draft.dataColors.length > 8 && (
                      <button type="button" className="wbi-link" onClick={() => edit((t) => void t.dataColors.pop())}>
                        Remove last
                      </button>
                    )}
                  </div>
                  <div className="wbi-dlg-help">Theme colors are used, in order, for series and categories in visuals. Colors after the eighth are used when a visual has more series.</div>
                </>
              )}
              {colorTab === 'sentiment' && (
                <div className="wbi-dlg-grid3">
                  {topColor('good', 'Positive', resolved.good)}
                  {topColor('neutral', 'Neutral', resolved.neutral)}
                  {topColor('bad', 'Negative', resolved.bad)}
                </div>
              )}
              {colorTab === 'divergent' && (
                <div className="wbi-dlg-grid3">
                  {topColor('maximum', 'Max', resolved.maximum)}
                  {topColor('center', 'Middle', resolved.center)}
                  {topColor('minimum', 'Min', resolved.minimum)}
                  {topColor('null', 'Null', resolved.null)}
                </div>
              )}
              {colorTab === 'structural' && (
                <div className="wbi-dlg-grid3">
                  {topColor('foreground', 'First-level elements', resolved.foreground)}
                  {topColor('foregroundNeutralSecondary', 'Second-level elements', resolved.foregroundNeutralSecondary)}
                  {topColor('foregroundNeutralTertiary', 'Third-level elements', resolved.foregroundNeutralTertiary)}
                  {topColor('background', 'Background', resolved.background)}
                  {topColor('backgroundLight', 'Secondary background', resolved.backgroundLight)}
                  {topColor('backgroundNeutral', 'Background elements', resolved.backgroundNeutral)}
                  {topColor('tableAccent', 'Table accent', resolved.tableAccent)}
                  {topColor('hyperlink', 'Hyperlink', resolved.hyperlink)}
                  {topColor('visitedHyperlink', 'Visited hyperlink', resolved.hyperlink)}
                </div>
              )}
            </>
          )}
          {section === 'text' && (
            <>
              <Pivot
                value={textTab}
                onChange={setTextTab}
                tabs={[
                  { key: 'label', label: 'General' },
                  { key: 'title', label: 'Title' },
                  { key: 'callout', label: 'Cards and KPIs' },
                  { key: 'header', label: 'Tab headers' }
                ]}
              />
              <div className="wbi-dlg-help">
                {textTab === 'label'
                  ? 'Labels, axis text, legends and table values.'
                  : textTab === 'title'
                    ? 'Visual titles and axis titles.'
                    : textTab === 'callout'
                      ? 'Callout values of cards and KPIs.'
                      : 'Column and row headers of tables and matrices, and slicer headers.'}
              </div>
              {textClass(textTab)}
            </>
          )}
          {section === 'visuals' && (
            <>
              <Pivot
                value={visualTab}
                onChange={setVisualTab}
                tabs={[
                  { key: 'background', label: 'Background' },
                  { key: 'border', label: 'Border' },
                  { key: 'header', label: 'Header' },
                  { key: 'tooltip', label: 'Tooltip' }
                ]}
              />
              {visualTab === 'background' && (
                <div className="wbi-dlg-grid2">
                  {styleColor('Color', '*', 'background', 'color', '#FFFFFF')}
                  {styleNumber('Transparency (%)', '*', 'background', 'transparency', 0, { slider: true, suffix: '%' })}
                </div>
              )}
              {visualTab === 'border' && (
                <div className="wbi-dlg-grid2">
                  {styleToggle('Border', '*', 'border', 'show', false)}
                  {styleColor('Color', '*', 'border', 'color', '#E1DFDD')}
                  {styleNumber('Width (px)', '*', 'border', 'width', 1, { min: 1, max: 10 })}
                  {styleNumber('Rounded corners (px)', '*', 'border', 'radius', 0, { min: 0, max: 50 })}
                </div>
              )}
              {visualTab === 'header' && (
                <div className="wbi-dlg-grid2">
                  {styleToggle('Show header', '*', 'visualHeader', 'show', true)}
                  {styleColor('Background color', '*', 'visualHeader', 'background')}
                  {styleColor('Border color', '*', 'visualHeader', 'border')}
                  {styleColor('Icon color', '*', 'visualHeader', 'foreground', '#252423')}
                  {styleNumber('Transparency (%)', '*', 'visualHeader', 'transparency', 0, { slider: true, suffix: '%' })}
                </div>
              )}
              {visualTab === 'tooltip' && (
                <div className="wbi-dlg-grid2">
                  {styleColor('Label text color', '*', 'visualTooltip', 'titleFontColor', '#605E5C')}
                  {styleColor('Value text color', '*', 'visualTooltip', 'valueFontColor', '#252423')}
                  {styleColor('Background', '*', 'visualTooltip', 'background', '#FFFFFF')}
                  {styleNumber('Background transparency (%)', '*', 'visualTooltip', 'transparency', 0, { slider: true, suffix: '%' })}
                  {styleFont('Font', '*', 'visualTooltip', 'fontFamily', 'Segoe UI')}
                  {styleNumber('Font size', '*', 'visualTooltip', 'fontSize', 10, { min: 6, max: 30 })}
                </div>
              )}
            </>
          )}
          {section === 'page' && (
            <>
              <div className="wbi-dlg-section-title">Wallpaper</div>
              <div className="wbi-dlg-grid2">
                {styleColor('Color', 'page', 'outspace', 'color', '#FFFFFF')}
                {styleNumber('Transparency (%)', 'page', 'outspace', 'transparency', 0, { slider: true, suffix: '%' })}
              </div>
              <div className="wbi-dlg-section-title">Page background</div>
              <div className="wbi-dlg-grid2">
                {styleColor('Color', 'page', 'background', 'color', '#FFFFFF')}
                {styleNumber('Transparency (%)', 'page', 'background', 'transparency', 100, { slider: true, suffix: '%' })}
              </div>
            </>
          )}
          {section === 'filters' && (
            <>
              <Pivot
                value={filterTab}
                onChange={setFilterTab}
                tabs={[
                  { key: 'pane', label: 'Filter pane' },
                  { key: 'cards', label: 'Filter cards' }
                ]}
              />
              {filterTab === 'pane' && (
                <div className="wbi-dlg-grid2">
                  {styleColor('Background color', '*', 'outspacePane', 'backgroundColor', '#FFFFFF')}
                  {styleNumber('Transparency (%)', '*', 'outspacePane', 'transparency', 0, { slider: true, suffix: '%' })}
                  {styleColor('Font and icon color', '*', 'outspacePane', 'foregroundColor', '#252423')}
                  {styleNumber('Title text size', '*', 'outspacePane', 'titleSize', 14, { min: 8, max: 30 })}
                  {styleNumber('Header text size', '*', 'outspacePane', 'headerSize', 10, { min: 8, max: 30 })}
                  {styleColor('Input box border color', '*', 'outspacePane', 'inputBoxColor', '#C8C6C4')}
                  {styleColor('Border color', '*', 'outspacePane', 'borderColor', '#E1DFDD')}
                  {styleToggle('Border', '*', 'outspacePane', 'border', true)}
                  {styleFont('Font', '*', 'outspacePane', 'fontFamily', 'Segoe UI')}
                  {styleNumber('Width (px)', '*', 'outspacePane', 'width', 260, { min: 150, max: 500 })}
                </div>
              )}
              {filterTab === 'cards' && (
                <>
                  <div className="wbi-dlg-section-title">Available</div>
                  <div className="wbi-dlg-grid2">
                    {styleColor('Background color', '*', 'filterCard', 'backgroundColor', '#FFFFFF', 'Available')}
                    {styleColor('Font and icon color', '*', 'filterCard', 'foregroundColor', '#252423', 'Available')}
                    {styleColor('Border color', '*', 'filterCard', 'borderColor', '#E1DFDD', 'Available')}
                    {styleNumber('Transparency (%)', '*', 'filterCard', 'transparency', 0, { slider: true, suffix: '%', id: 'Available' })}
                    {styleToggle('Border', '*', 'filterCard', 'border', true, 'Available')}
                    {styleColor('Input box color', '*', 'filterCard', 'inputBoxColor', '#FFFFFF', 'Available')}
                  </div>
                  <div className="wbi-dlg-section-title">Applied</div>
                  <div className="wbi-dlg-grid2">
                    {styleColor('Background color', '*', 'filterCard', 'backgroundColor', '#F3F2F1', 'Applied')}
                    {styleColor('Font and icon color', '*', 'filterCard', 'foregroundColor', '#252423', 'Applied')}
                    {styleColor('Border color', '*', 'filterCard', 'borderColor', '#E1DFDD', 'Applied')}
                    {styleNumber('Transparency (%)', '*', 'filterCard', 'transparency', 0, { slider: true, suffix: '%', id: 'Applied' })}
                    {styleToggle('Border', '*', 'filterCard', 'border', true, 'Applied')}
                    {styleColor('Input box color', '*', 'filterCard', 'inputBoxColor', '#FFFFFF', 'Applied')}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

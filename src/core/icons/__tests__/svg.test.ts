import { beforeAll, describe, expect, it } from 'vitest'
import { resolveTheme } from '../../report/theme'
import { loadIconSet } from '../registry'
import { ICON_SETS } from '../sets'
import { buildIconSvg, buildIconSvgHex, fillBody, namespaceIds } from '../svg'
import { iconKey, parseIconRef, resolveIconColors, serializeIconRef, themeColor, themeColorParts, usesThemeColors, withVariant } from '../ref'
import { iconParkTokens, phosphorDuotone } from '../normalize'
import { ICON_SET_IDS, type IconSetData, type IconSetId } from '../types'

const theme = resolveTheme()
const sets = {} as Record<IconSetId, IconSetData>
beforeAll(async () => {
  for (const id of ICON_SET_IDS) sets[id] = await loadIconSet(id)
})

/** Distinct colour attribute values in an SVG string. */
function colors(svg: string): Set<string> {
  return new Set([...svg.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)].map((m) => m[1]))
}

describe('icon references', () => {
  it('parse / serialise round trip, with defaults dropped and junk rejected', () => {
    const ref = { set: 'iconpark', name: 'wallet', variant: 'multi-color', colors: ['theme:2', null, '#123456'], strokeWidth: 3, padding: 10 } as const
    const s = serializeIconRef({ ...ref, colors: [...ref.colors] })
    expect(parseIconRef(JSON.parse(JSON.stringify(s)))).toEqual(s)
    expect(s).toEqual({ set: 'iconpark', name: 'wallet', variant: 'multi-color', colors: ['theme:2', null, '#123456'], strokeWidth: 3, padding: 10 })
    // trailing defaults and the default stroke are not stored
    expect(serializeIconRef({ set: 'tabler', name: 'chart-bar', variant: 'outline', colors: [null], strokeWidth: 2 })).toEqual({ set: 'tabler', name: 'chart-bar', variant: 'outline' })
    expect(parseIconRef({ set: 'nope', name: 'x' })).toBeUndefined()
    expect(parseIconRef({ set: 'tabler', name: '../etc' })).toBeUndefined()
    expect(parseIconRef({ set: 'tabler', name: 'x', variant: 'weird', colors: ['red', '#FFF'] })).toEqual({ set: 'tabler', name: 'x', variant: 'outline', colors: [null, '#FFF'] })
    expect(iconKey({ set: 'tabler', name: 'chart-bar', variant: 'outline' })).toBe('tabler:chart-bar@outline')
  })

  it('theme colour values', () => {
    expect(themeColor(2)).toBe('theme:2')
    expect(themeColor(3, 0.4)).toBe('theme:3:0.4')
    expect(themeColorParts('theme:3:-0.25')).toEqual({ colorId: 3, percent: -0.25 })
    expect(themeColorParts('#FFFFFF')).toBeUndefined()
  })

  it('resolves colours through the theme, with defaults and derived slots', () => {
    // CY24SU10: dataColors[0] #118DFF, foreground #252423
    expect(resolveIconColors({ set: 'tabler', name: 'x', variant: 'outline' }, theme)).toEqual(['#118DFF'])
    expect(resolveIconColors({ set: 'iconpark', name: 'x', variant: 'multi-color' }, theme)).toEqual(['#118DFF', '#A0D1FF', '#252423'])
    // secondary follows the primary unless set
    expect(resolveIconColors({ set: 'iconpark', name: 'x', variant: 'multi-color', colors: ['#00FF00'] }, theme)[1]).toBe('#99FF99')
    expect(resolveIconColors({ set: 'iconpark', name: 'x', variant: 'multi-color', colors: ['#00FF00', '#FF0000', '#0000FF'] }, theme)).toEqual(['#00FF00', '#FF0000', '#0000FF'])
    // a theme change changes the resolved colour
    const other = resolveTheme(undefined, { name: 'x', dataColors: ['#AA0000'] })
    expect(resolveIconColors({ set: 'phosphor', name: 'x', variant: 'regular' }, other)).toEqual(['#AA0000'])
    expect(usesThemeColors({ set: 'phosphor', name: 'x', variant: 'regular' })).toBe(true)
    expect(usesThemeColors({ set: 'phosphor', name: 'x', variant: 'regular', colors: ['#000000'] })).toBe(false)
    expect(usesThemeColors({ set: 'fluent', name: 'x', variant: 'color' })).toBe(false)
  })

  it('switching variant keeps colours slot by slot and drops strokes where unsupported', () => {
    const ref = { set: 'tabler' as const, name: 'chart-bar', variant: 'outline', colors: ['#FF0000'], strokeWidth: 1.5 }
    expect(withVariant(ref, 'filled')).toEqual({ set: 'tabler', name: 'chart-bar', variant: 'filled', colors: ['#FF0000'] })
  })
})

describe('SVG strings', () => {
  it('every set and variant builds a valid standalone SVG with the requested colours', () => {
    const samples: Record<IconSetId, string> = { fluent: 'data-pie', phosphor: 'chart-pie-slice', tabler: 'chart-pie', iconpark: 'wallet' }
    for (const id of ICON_SET_IDS) {
      for (const v of ICON_SETS[id].variants) {
        const name = samples[id]
        const slots = v.slots.map((_, i) => ['#010203', '#040506', '#070809'][i])
        const svg = buildIconSvgHex(sets[id], { set: id, name, variant: v.id }, slots, { size: 32 })
        expect(svg, `${id}/${v.id}`).toBeDefined()
        expect(svg!.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ')).toBe(true)
        expect(svg).toContain('width="32" height="32"')
        expect(svg).not.toMatch(/\{\{/)
        const c = colors(svg!)
        for (const hex of slots) expect(c.has(hex), `${id}/${v.id} uses ${hex}`).toBe(true)
        if (v.id !== 'color') expect([...c].filter((x) => x.startsWith('#') && !slots.includes(x) && x !== '#FFFFFF')).toEqual([])
      }
    }
  })

  it('IconPark: the four themes map its colour roles (tri-colour = fill, accent, line + white details)', () => {
    const body = iconParkTokens('<path fill="#2F88FF" stroke="#000" stroke-width="4"/><path fill="#43CCF8" stroke="#fff"/><circle fill="#000"/>')
    expect(body).toBe('<path fill="{{1}}" stroke="{{0}}" stroke-width="{{w:4}}"/><path fill="{{3}}" stroke="{{2}}"/><circle fill="{{0}}"/>')
    const roles = (variant: string) => ICON_SETS.iconpark.variants.find((v) => v.id === variant)!.roles
    expect(fillBody(body, roles('multi-color'), ['#AA0000', '#00BB00', '#0000CC'])).toBe('<path fill="#AA0000" stroke="#0000CC" stroke-width="4"/><path fill="#00BB00" stroke="#FFFFFF"/><circle fill="#0000CC"/>')
    expect(fillBody(body, roles('outline'), ['#AA0000'])).toBe('<path fill="none" stroke="#AA0000" stroke-width="4"/><path fill="none" stroke="#AA0000"/><circle fill="#AA0000"/>')
    expect(fillBody(body, roles('filled'), ['#AA0000'])).toBe('<path fill="#AA0000" stroke="#AA0000" stroke-width="4"/><path fill="#FFFFFF" stroke="#FFFFFF"/><circle fill="#AA0000"/>')
    expect(fillBody(body, roles('two-tone'), ['#111111', '#AA0000'], 0.5)).toBe('<path fill="#AA0000" stroke="#111111" stroke-width="2"/><path fill="#AA0000" stroke="#111111"/><circle fill="#111111"/>')
    // on real artwork: three distinct user colours + white
    const svg = buildIconSvg(sets.iconpark, { set: 'iconpark', name: 'wallet', variant: 'multi-color', colors: ['#AA0000', '#00BB00', '#0000CC'] }, theme)!
    expect(colors(svg)).toEqual(new Set(['none', '#AA0000', '#00BB00', '#0000CC', '#FFFFFF']))
  })

  it('Phosphor duotone back layer gets the secondary colour (no 20 % opacity)', () => {
    expect(phosphorDuotone('<g fill="{{0}}"><path d="M0" opacity=".2"/><path d="M1"/></g>')).toBe('<g fill="{{0}}"><path d="M0" fill="{{1}}"/><path d="M1"/></g>')
    const svg = buildIconSvg(sets.phosphor, { set: 'phosphor', name: 'chart-bar', variant: 'duotone', colors: ['#112233', '#445566'] }, theme)!
    expect(svg).toContain('fill="#445566"')
    expect(svg).not.toContain('opacity=".2"')
  })

  it('stroke weight scales strokes of stroke sets', () => {
    const thin = buildIconSvg(sets.tabler, { set: 'tabler', name: 'chart-bar', variant: 'outline', strokeWidth: 1 }, theme)!
    expect(thin).toContain('stroke-width="1"')
    expect(buildIconSvg(sets.tabler, { set: 'tabler', name: 'chart-bar', variant: 'outline' }, theme)).toContain('stroke-width="2"')
  })

  it('padding widens the viewBox, ids are namespaced, titles escaped', () => {
    expect(buildIconSvg(sets.tabler, { set: 'tabler', name: 'chart-bar', variant: 'outline', padding: 25 }, theme)).toContain('viewBox="-6 -6 36 36"')
    const color = buildIconSvg(sets.fluent, { set: 'fluent', name: 'data-pie', variant: 'color' }, theme, { idPrefix: 'p1-', title: 'A < B' })!
    const ids = [...color.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(id.startsWith('p1-')).toBe(true)
      expect(color).toContain(`url(#${id})`)
    }
    expect(color).toContain('<title>A &lt; B</title>')
    expect(namespaceIds('<g/>', 'x')).toBe('<g/>')
  })

  it('unknown icons build nothing', () => {
    expect(buildIconSvg(sets.tabler, { set: 'tabler', name: 'no-such-icon', variant: 'outline' }, theme)).toBeUndefined()
  })
})

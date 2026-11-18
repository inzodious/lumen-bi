import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IMAGE_VISUAL_SLOT, activeIcon, cardImageSlot, imageVisualItem } from '@core/icons/bake'
import { decodeLiteral } from '@core/report/literal'
import { useApp } from '../state/store'
import { fixtureProject } from '../report/dev/fixture'
import { addVisual } from '../report/editOps'
import { setReportTheme } from '../app/themes'
import { loadIconSets } from './registry'
import { rebakeIconsBeforeSave, setVisualIcon, clearVisualIcon } from './actions'

const report = () => useApp.getState().project!.report!
const page = () => report().pages[0]
const visual = (name: string) => page().visuals.find((v) => v.name === name)!.json
const svgOf = (name: string) => new TextDecoder().decode(report().resources[`StaticResources/RegisteredResources/${imageVisualItem(visual(name))}`].bytes)
const cardSvg = (name: string) => atob(String(decodeLiteral(visual(name).visual.objects.image[0].properties.imageUrl.expr.Literal.Value)).split(',')[1])

let name = ''
let card = ''
beforeAll(async () => {
  await loadIconSets(['lucide', 'fluent-color'])
})
beforeEach(() => {
  useApp.getState().setProject(fixtureProject())
  useApp.getState().mutateReport('add', (r) => {
    name = addVisual(r.pages[0], 'image', { x: 0, y: 0, width: 96, height: 96 })
    card = addVisual(r.pages[0], 'cardVisual', { x: 100, y: 0, width: 200, height: 120 })
  })
})

describe('icon edits in the document', () => {
  it('bakes, re-styles and removes an icon (each an undo step)', async () => {
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'lucide', name: 'chart-column', color: 'theme:2' })
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)?.icon.name).toBe('chart-column')
    expect(svgOf(name)).toContain('style="color:#118DFF"')
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'lucide', name: 'chart-pie', color: '#00AA00', strokeWidth: 1 })
    expect(svgOf(name)).toContain('style="color:#00AA00"')
    expect(svgOf(name)).toContain('stroke-width="1"')
    clearVisualIcon(page().name, name, IMAGE_VISUAL_SLOT)
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)).toBeUndefined()
    expect(Object.keys(report().resources).some((k) => k.includes('LumenIcon_'))).toBe(false)
    useApp.getState().undo()
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)?.icon).toEqual({ set: 'lucide', name: 'chart-pie', color: '#00AA00', strokeWidth: 1 })
  })

  it('an unknown icon is not baked', async () => {
    expect(await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'lucide', name: 'no-such-icon' })).toBe(false)
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)).toBeUndefined()
  })

  it('a theme change re-bakes theme-coloured icons (image visual and card) in the same undo step', async () => {
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'lucide', name: 'chart-column', color: 'theme:2' })
    await setVisualIcon(page().name, card, cardImageSlot('image'), { set: 'lucide', name: 'wallet', color: 'theme:2' })
    await setVisualIcon(page().name, card, cardImageSlot('cardImage'), { set: 'fluent-color', name: 'data-pie' })
    const fluentBefore = JSON.stringify(visual(card).visual.objects.cardImage)
    expect(svgOf(name)).toContain('color:#118DFF')
    expect(cardSvg(card)).toContain('color:#118DFF')
    const steps = useApp.getState().undoStack.length
    useApp.getState().mutateReport('Change theme', (r) => setReportTheme(r, { name: 'Ember', dataColors: ['#E66C37', '#6B007B'] } as any))
    expect(useApp.getState().undoStack.length).toBe(steps + 1)
    expect(svgOf(name)).toContain('color:#E66C37')
    expect(cardSvg(card)).toContain('color:#E66C37')
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)).toBeDefined()
    expect(activeIcon(report(), visual(card), cardImageSlot('image'))).toBeDefined()
    // fixed-colour artwork does not depend on the theme
    expect(JSON.stringify(visual(card).visual.objects.cardImage)).toBe(fluentBefore)
    // one undo restores the theme and the icons together
    useApp.getState().undo()
    expect(svgOf(name)).toContain('color:#118DFF')
    expect(cardSvg(card)).toContain('color:#118DFF')
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)).toBeDefined()
  })

  it('save-time re-bake changes nothing when the icons are current', async () => {
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'lucide', name: 'chart-column' })
    const before = report()
    await rebakeIconsBeforeSave()
    expect(report()).toBe(before)
  })
})

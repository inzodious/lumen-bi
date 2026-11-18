import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IMAGE_VISUAL_SLOT, activeIcon, imageVisualItem } from '@core/icons/bake'
import { loadIconSet } from '@core/icons/registry'
import { useApp } from '../state/store'
import { fixtureProject } from '../report/dev/fixture'
import { addVisual } from '../report/editOps'
import { setReportTheme } from '../app/themes'
import { rebakeIconsBeforeSave, setVisualIcon, clearVisualIcon } from './actions'

const report = () => useApp.getState().project!.report!
const page = () => report().pages[0]
const visual = (name: string) => page().visuals.find((v) => v.name === name)!.json
const svgOf = (name: string) => new TextDecoder().decode(report().resources[`StaticResources/RegisteredResources/${imageVisualItem(visual(name))}`].bytes)

let name = ''
beforeAll(async () => {
  await loadIconSet('tabler')
})
beforeEach(() => {
  useApp.getState().setProject(fixtureProject())
  useApp.getState().mutateReport('add', (r) => {
    name = addVisual(r.pages[0], 'image', { x: 0, y: 0, width: 96, height: 96 })
  })
})

describe('icon edits in the document', () => {
  it('bakes, re-styles and removes an icon (each an undo step)', async () => {
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'tabler', name: 'chart-bar', variant: 'outline' })
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)?.icon.name).toBe('chart-bar')
    expect(svgOf(name)).toContain('stroke="#118DFF"')
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'tabler', name: 'chart-pie', variant: 'filled', colors: ['#00AA00'] })
    expect(svgOf(name)).toContain('fill="#00AA00"')
    clearVisualIcon(page().name, name, IMAGE_VISUAL_SLOT)
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)).toBeUndefined()
    expect(Object.keys(report().resources).some((k) => k.includes('LumenIcon_'))).toBe(false)
    useApp.getState().undo()
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)?.icon.variant).toBe('filled')
  })

  it('a theme change re-bakes theme-coloured icons in the same undo step', async () => {
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'tabler', name: 'chart-bar', variant: 'outline' })
    expect(svgOf(name)).toContain('stroke="#118DFF"')
    const steps = useApp.getState().undoStack.length
    useApp.getState().mutateReport('Change theme', (r) => setReportTheme(r, { name: 'Ember', dataColors: ['#E66C37', '#6B007B'] } as any))
    expect(useApp.getState().undoStack.length).toBe(steps + 1)
    expect(svgOf(name)).toContain('stroke="#E66C37"')
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)).toBeDefined()
    // one undo restores the theme and the icon together
    useApp.getState().undo()
    expect(svgOf(name)).toContain('stroke="#118DFF"')
    expect(activeIcon(report(), visual(name), IMAGE_VISUAL_SLOT)).toBeDefined()
  })

  it('save-time re-bake changes nothing when the icons are current', async () => {
    await setVisualIcon(page().name, name, IMAGE_VISUAL_SLOT, { set: 'tabler', name: 'chart-bar', variant: 'outline' })
    const before = report()
    await rebakeIconsBeforeSave()
    expect(report()).toBe(before)
  })
})

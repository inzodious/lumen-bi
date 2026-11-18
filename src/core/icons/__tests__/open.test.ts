/**
 * Opening a PBIP saved by an earlier build with an icon of a set Lumen no longer offers: the picture stays as a plain
 * image, the reference is dropped and an info diagnostic says so.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyReport } from '../../report/types'
import { emptyModel } from '../../model/types'
import { emptyDataStore } from '../../model/data'
import { openProject, saveProject } from '../../io/open'
import { nodeFs } from '../../io/nodefs'
import { ICON_ANNOTATION, imageVisualItem, readIconBindings } from '../bake'
import { fingerprint } from '../hash'
import type { ProjectDocument } from '../../project'

describe('opening a report with an icon of a removed set', () => {
  it('keeps the picture as a plain image, drops the reference, reports an info diagnostic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumen-icons-'))
    try {
      const report = emptyReport()
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#118DFF" d="M0 0h1"/></svg>'
      const item = 'LumenIcon_iconpark_wallet_0123456789ab.svg'
      const path = `StaticResources/RegisteredResources/${item}`
      report.resources[path] = { path, bytes: new TextEncoder().encode(svg), mime: 'image/svg+xml' }
      report.report.resourcePackages = [{ name: 'RegisteredResources', type: 'RegisteredResources', items: [{ name: item, path: item, type: 'Image' }] }]
      const icons = [{ slot: { object: 'general', property: 'imageUrl', form: 'resource' }, icon: { set: 'iconpark', name: 'wallet', variant: 'multi-color' }, bake: fingerprint(new TextEncoder().encode(svg)), resource: item }]
      report.pages[0].visuals.push({
        name: 'icon1',
        json: {
          name: 'icon1',
          position: { x: 10, y: 10, z: 0, width: 96, height: 96 },
          visual: { visualType: 'image', objects: { general: [{ properties: { imageUrl: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: item } } } } }] } },
          annotations: [{ name: ICON_ANNOTATION, value: JSON.stringify({ version: 1, icons }) }]
        }
      })
      const project: ProjectDocument = { id: 'p', name: 'Old', source: { kind: 'new' }, model: emptyModel('Old'), data: emptyDataStore(), report, diagnostics: [], dirty: false }
      const target = join(root, 'Old.pbip')
      await saveProject(project, target, nodeFs, { format: 'pbip' })

      const doc = await openProject(target, nodeFs)
      const v = doc.report!.pages[0].visuals.find((x) => x.name === 'icon1')!.json
      expect(v.annotations).toBeUndefined()
      expect(readIconBindings(v)).toEqual([])
      expect(imageVisualItem(v)).toBe(item)
      expect(new TextDecoder().decode(doc.report!.resources[path].bytes)).toBe(svg)
      const info = doc.diagnostics.filter((d) => d.level === 'info' && /icon set Lumen no longer offers/.test(d.message))
      expect(info.map((d) => d.message)).toEqual(['1 icon from an icon set Lumen no longer offers (iconpark) now shows as a plain image; pick a new icon to edit it again.'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

/**
 * Screenshots of every starter template of the code visual at three sizes, on a light report and on a dark one, plus
 * the editor (only when LUMEN_E2E_SHOTS names a folder). Used to review the templates and for the documentation.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { useLumen, waitIdle, settle, lumenEval } from './harness'
import { STARTER_TEMPLATES, applyTemplate } from '../src/core/codevisual/templates'
import { CODE_VISUAL_TYPE } from '../src/core/codevisual/model'

const SHOTS = process.env['LUMEN_E2E_SHOTS'] ?? ''

const col = (t: string, c: string, extra: Record<string, unknown> = {}) => ({ field: { Column: { Expression: { SourceRef: { Entity: t } }, Property: c } }, queryRef: `${t}.${c}`, nativeQueryRef: c, ...extra })
const mea = (m: string) => ({ field: { Measure: { Expression: { SourceRef: { Entity: '_Measures' } }, Property: m } }, queryRef: `_Measures.${m}`, nativeQueryRef: m })

/** Wells per template, from the built-in sample. */
export function sampleWells(id: string): Record<string, { projections: unknown[] }> {
  const product = [col('Product', 'Category', { active: true }), col('Product', 'Subcategory'), col('Product', 'Product')]
  switch (id) {
    case 'kpi':
      return { Category: { projections: [col('Date', 'Year Month')] }, Y: { projections: [mea('Total Sales'), mea('Sales LY')] } }
    case 'ring':
      return { Y: { projections: [mea('Margin'), mea('Total Cost')] } }
    case 'scorecard':
      return { Category: { projections: [col('Region', 'Country')] }, Y: { projections: [mea('Total Sales'), mea('Sales LY')] } }
    case 'steps':
      return { Category: { projections: [col('Date', 'Quarter')] }, Y: { projections: [mea('Total Sales')] } }
    case 'badges':
      return { Category: { projections: [col('Region', 'Country')] }, Y: { projections: [mea('Total Sales'), mea('Margin %')] } }
    default:
      return { Category: { projections: product }, Y: { projections: [mea('Total Sales')] } }
  }
}

/** A code visual's JSON for a starter template with sample wells. */
export function templateVisual(name: string, id: string, rect: { x: number; y: number; w: number; h: number }, background?: string): any {
  const t = STARTER_TEMPLATES.find((x) => x.id === id)!
  const json: any = {
    name,
    position: { x: rect.x, y: rect.y, z: 1000, width: rect.w, height: rect.h, tabOrder: 1000 },
    visual: { visualType: CODE_VISUAL_TYPE, query: { queryState: sampleWells(id) }, objects: {}, drillFilterOtherVisuals: true }
  }
  applyTemplate(json, t)
  if (background)
    json.visual.visualContainerObjects = {
      background: [{ properties: { show: { expr: { Literal: { Value: 'true' } } }, color: { solid: { color: { expr: { Literal: { Value: `'${background}'` } } } } }, transparency: { expr: { Literal: { Value: '0D' } } } } }],
      border: [{ properties: { show: { expr: { Literal: { Value: 'false' } } } } }]
    }
  return json
}

export const DARK_THEME = {
  name: 'Code visual dark',
  dataColors: ['#4CA8FF', '#7FD1C9', '#FF9E6B', '#C59BFF', '#FF7BC2', '#9C8CFF', '#F2C94C', '#FF6F7D'],
  background: '#252423',
  backgroundLight: '#323130',
  backgroundNeutral: '#3B3A39',
  foreground: '#F3F2F1',
  foregroundNeutralSecondary: '#C8C6C4',
  foregroundNeutralTertiary: '#8A8886',
  good: '#3DD16B',
  bad: '#FF6F7D',
  neutral: '#F2B84B',
  tableAccent: '#4CA8FF',
  textClasses: { label: { color: '#F3F2F1' }, title: { color: '#F3F2F1' }, header: { color: '#F3F2F1' }, callout: { color: '#F3F2F1' } }
}

const SIZES = [
  { key: 's', w: 220, h: 140 },
  { key: 'm', w: 380, h: 240 },
  { key: 'l', w: 600, h: 300 }
]

async function layoutTemplates(page: Page, dark: boolean): Promise<string[]> {
  const names: string[] = []
  const visuals = STARTER_TEMPLATES.flatMap((t, ti) =>
    SIZES.map((s, si) => {
      const name = `shot${dark ? 'd' : 'l'}${ti}${s.key}`.padEnd(20, '0')
      names.push(name)
      const x = 20 + [0, 260, 680][si]
      const y = 20 + ti * 340
      return templateVisual(name, t.id, { x, y, w: s.w, h: s.h }, dark ? '#252423' : undefined)
    })
  )
  await lumenEval(
    page,
    (l, a) => {
      const s = l.useApp.getState()
      s.mutateReport('shots', (r: any) => {
        const p = r.pages.find((x: any) => x.name === s.activePage)
        p.json.width = 1320
        p.json.height = 20 + a.visuals.length / 3 * 340
        if (a.dark) {
          p.json.objects = { ...(p.json.objects ?? {}), background: [{ properties: { color: { solid: { color: { expr: { Literal: { Value: "'#1B1A19'" } } } } }, transparency: { expr: { Literal: { Value: '0D' } } } } }] }
          r.theme = { ...r.theme, custom: a.theme }
        }
        for (const v of a.visuals) p.visuals.push({ name: v.name, json: v })
      })
      s.setZoom(1)
    },
    { visuals, dark, theme: DARK_THEME }
  )
  return names
}

async function allRendered(page: Page, names: string[]): Promise<void> {
  await page.waitForFunction(
    (ns) => ns.every((n) => ['rendered', 'error'].includes(document.querySelector(`.wbi-page [data-visual="${n}"] .wbi-codevisual`)?.getAttribute('data-code-state') ?? '')),
    names,
    { timeout: 60_000 }
  )
}

describe.skipIf(!SHOTS)('code visual screenshots', () => {
  const lumen = useLumen({ route: { sample: '1' }, size: '1900x1300' })

  for (const dark of [false, true]) {
    it(`every template at three sizes (${dark ? 'dark' : 'light'})`, async () => {
      const { page } = lumen()
      const dir = join(SHOTS, 'templates')
      mkdirSync(dir, { recursive: true })
      await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
      await page.locator('.wbi-tab-add').click()
      await waitIdle(page)
      const names = await layoutTemplates(page, dark)
      await settle(page)
      await allRendered(page, names)
      const states = await page.evaluate((ns) => ns.map((n) => document.querySelector(`.wbi-page [data-visual="${n}"] .wbi-codevisual`)?.getAttribute('data-code-state')), names)
      expect(states.every((s) => s === 'rendered')).toBe(true)
      for (const [i, n] of names.entries()) {
        const t = STARTER_TEMPLATES[Math.floor(i / 3)]
        const size = SIZES[i % 3]
        const el = page.locator(`.wbi-page [data-visual="${n}"]`)
        await el.scrollIntoViewIfNeeded()
        await el.screenshot({ path: join(dir, `${t.id}-${size.key}-${dark ? 'dark' : 'light'}.png`) })
      }
    })
  }

  it('a report page mixing code visuals with native visuals, under a cross-highlight; the editor', async () => {
    const { page } = lumen()
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.locator('.wbi-tab-add').click()
    await waitIdle(page)
    const vs = [
      templateVisual('mixkpi00000000000000', 'kpi', { x: 16, y: 16, w: 300, h: 170 }),
      templateVisual('mixring0000000000000', 'ring', { x: 328, y: 16, w: 300, h: 170 }),
      templateVisual('mixbarlist0000000000', 'barlist', { x: 16, y: 198, w: 420, h: 300 }),
      templateVisual('mixsteps000000000000', 'steps', { x: 640, y: 16, w: 624, h: 170 })
    ]
    await lumenEval(
      page,
      (l, a) => {
        const s = l.useApp.getState()
        s.mutateReport('mix', (r: any) => {
          const p = r.pages.find((x: any) => x.name === s.activePage)
          for (const v of a.vs) p.visuals.push({ name: v.name, json: v })
          const add = (name: string, rect: number[], visual: any) =>
            p.visuals.push({ name, json: { name, position: { x: rect[0], y: rect[1], z: 100, width: rect[2], height: rect[3], tabOrder: 100 }, visual: { drillFilterOtherVisuals: true, ...visual } } })
          add('mixbar00000000000000', [448, 198, 400, 300], { visualType: 'clusteredBarChart', query: { queryState: { Category: { projections: [a.country] }, Y: { projections: [a.sales] } } } })
          add('mixtable000000000000', [860, 198, 404, 300], { visualType: 'tableEx', query: { queryState: { Values: { projections: [a.category, a.sales, a.margin] } } } })
        })
        s.setZoom(null)
      },
      { vs, country: col('Region', 'Country', { active: true }), sales: mea('Total Sales'), category: col('Product', 'Category'), margin: mea('Margin %') }
    )
    await settle(page)
    await allRendered(page, vs.map((v) => v.name))
    // cross-highlight from the code visual: click the Bikes row
    const frame = page.frameLocator('.wbi-page [data-visual="mixbarlist0000000000"] iframe')
    const r = await frame.locator('.bl__row', { hasText: 'Bikes' }).first().evaluate((el) => {
      const b = el.getBoundingClientRect()
      return { x: b.left + b.width / 3, y: b.top + b.height / 2 }
    })
    const iframe = page.locator('.wbi-page [data-visual="mixbarlist0000000000"] iframe')
    const fb = (await iframe.boundingBox())!
    const scale = fb.width / (await iframe.evaluate((el) => (el as HTMLElement).offsetWidth))
    await page.mouse.click(fb.x + r.x * scale, fb.y + r.y * scale)
    await settle(page)
    await allRendered(page, vs.map((v) => v.name))
    await page.locator('.wbi-main').screenshot({ path: join(SHOTS, 'mixed-page-cross-highlight.png') })
    // the editor on the bar list
    const vb = (await page.locator('.wbi-page [data-visual="mixbarlist0000000000"] .wbi-codevisual').boundingBox())!
    await page.mouse.click(vb.x + vb.width / 2, vb.y + 8, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit code' }).click()
    const dlg = page.getByRole('dialog', { name: 'Edit code' })
    await expect.poll(() => dlg.locator('.wbi-cve__visual iframe').count()).toBe(1)
    await dlg.getByRole('tab', { name: 'CSS' }).click()
    await page.waitForFunction(() => document.querySelector('.wbi-cve__visual .wbi-codevisual')?.getAttribute('data-code-state') === 'rendered')
    await dlg.screenshot({ path: join(SHOTS, 'editor-css.png') })
    await dlg.getByRole('tab', { name: 'Data' }).click()
    await dlg.screenshot({ path: join(SHOTS, 'editor-data.png') })
    await dlg.getByRole('tab', { name: 'HTML' }).click()
    await dlg.getByRole('button', { name: 'Wide' }).click()
    await page.waitForFunction(() => document.querySelector('.wbi-cve__visual .wbi-codevisual')?.getAttribute('data-code-state') === 'rendered')
    await dlg.screenshot({ path: join(SHOTS, 'editor-html-wide.png') })
    await dlg.locator('.wbi-modal__footer').getByRole('button', { name: 'Close' }).click()
  })
})

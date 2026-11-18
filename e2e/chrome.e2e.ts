/**
 * Rendering: visual container chrome in the real renderer — the title uses the face its Power BI font name asks for
 * (a Semibold family is semibold, from a font that is actually loaded, never a synthesized bold), the title block sits
 * at the padding edge with Power BI's spacing below it, and a divider respects the padding.
 */
import { describe, expect, it } from 'vitest'
import { useLumen, visualByTitle, lumenEval, settle } from './harness'

interface Geometry {
  scale: number
  box: { left: number; top: number; right: number }
  border: number
  padding: { top: number; left: number; right: number }
  title: { left: number; top: number; bottom: number; family: string; weight: string; size: number; padBottom: number; padLeft: number; faceLoaded: boolean }
  divider: { left: number; right: number; top: number; width: number; style: string } | null
  content: { top: number }
}

describe('visual container chrome', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  const measure = (name: string): Promise<Geometry> =>
    lumen().page.evaluate((n) => {
      const vc = document.querySelector<HTMLElement>(`.wbi-page [data-visual="${n}"]`)!
      const box = vc.querySelector<HTMLElement>('.wbi-vc-box')!
      const title = vc.querySelector<HTMLElement>('.wbi-vc-titles > div')!
      const divider = vc.querySelector<HTMLElement>('.wbi-vc-divider')
      const content = vc.querySelector<HTMLElement>('.wbi-vc-content')!
      const b = box.getBoundingClientRect()
      // the page is zoomed to fit: report everything in page px
      const scale = b.width / box.offsetWidth
      const px = (v: number) => v / scale
      const bs = getComputedStyle(box)
      const ts = getComputedStyle(title)
      const t = title.getBoundingClientRect()
      const d = divider?.getBoundingClientRect()
      const face = ts.fontFamily.split(',')[0].trim()
      return {
        scale,
        box: { left: 0, top: 0, right: px(b.width) },
        border: parseFloat(bs.borderTopWidth),
        padding: { top: parseFloat(bs.paddingTop), left: parseFloat(bs.paddingLeft), right: parseFloat(bs.paddingRight) },
        title: {
          left: px(t.left - b.left),
          top: px(t.top - b.top),
          bottom: px(t.bottom - b.top),
          family: ts.fontFamily,
          weight: ts.fontWeight,
          size: parseFloat(ts.fontSize),
          padBottom: parseFloat(ts.paddingBottom),
          padLeft: parseFloat(ts.paddingLeft),
          faceLoaded: document.fonts.check(`${ts.fontWeight} ${ts.fontSize} ${face}`)
        },
        divider: d ? { left: px(d.left - b.left), right: px(d.right - b.left), top: px(d.top - b.top), width: parseFloat(getComputedStyle(divider!).borderTopWidth), style: getComputedStyle(divider!).borderTopStyle } : null,
        content: { top: px(content.getBoundingClientRect().top - b.top) }
      }
    }, name)

  it('title: semibold face that is really loaded, at the padding edge, 5 px above the content', async () => {
    const { page } = lumen()
    const name = await visualByTitle(page, 'Sales by category')
    const g = await measure(name)
    // "'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif" → the Semibold face at weight 600
    expect(g.title.weight).toBe('600')
    expect(g.title.family).toMatch(/^"?Segoe UI Semibold"?,\s*"?Segoe UI"?/)
    expect(g.title.family).not.toMatch(/helvetica\s*,|wf_/i)
    expect(g.title.faceLoaded).toBe(true)
    expect(g.title.size).toBeCloseTo((11 * 4) / 3, 1) // 11pt
    // the title band spans the container (inside the border); its text is inset by the left padding
    expect(g.title.left).toBeCloseTo(g.border, 0)
    expect(g.title.padLeft).toBe(g.padding.left)
    expect(g.title.top).toBeCloseTo(g.border + g.padding.top, 0)
    // Power BI's vertical spacing: 5 px between the title's line box and the content
    expect(g.title.padBottom).toBe(5)
    expect(g.content.top).toBeCloseTo(g.title.bottom, 0)
    expect(g.divider).toBeNull()
  })

  it('divider: one spacing below the title, inside the padding, one spacing above the content', async () => {
    const { page } = lumen()
    const name = await visualByTitle(page, 'Sales by category')
    await lumenEval(
      page,
      (l, n) =>
        l.useApp.getState().mutateReport('Add divider', (r) => {
          const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
          for (const p of r.pages)
            for (const v of p.visuals)
              if (v.name === n)
                v.json.visual.visualContainerObjects.divider = [{ properties: { show: lit('true'), width: lit('3D'), style: lit("'solid'"), color: { solid: { color: lit("'#C83D95'") } }, ignorePadding: lit('false') } }]
        }),
      name
    )
    await expect.poll(() => page.locator(`.wbi-page [data-visual="${name}"] .wbi-vc-divider`).count()).toBe(1)
    await settle(page)
    const g = await measure(name)
    const d = g.divider!
    expect(d.width).toBe(3)
    expect(d.style).toBe('solid')
    expect(d.top).toBeCloseTo(g.title.bottom, 0)
    expect(g.title.padBottom).toBe(5)
    expect(d.left).toBeCloseTo(g.border + g.padding.left, 0)
    expect(d.right).toBeCloseTo(g.box.right - g.border - g.padding.right, 0)
    expect(g.content.top).toBeCloseTo(d.top + 3 + 5, 0)
  })
  it('semibold text is visibly between regular and bold (the bundled Segoe UI stand-in faces)', async () => {
    const { page } = lumen()
    const ink = await page.evaluate(async () => {
      const text = 'Rating Distribution by Question'
      const out: Record<string, number> = {}
      for (const w of [400, 600, 700]) {
        await document.fonts.load(`${w} 40px "Segoe UI"`)
        const c = document.createElement('canvas')
        c.width = 900
        c.height = 60
        const g = c.getContext('2d')!
        g.font = `${w} 40px "Segoe UI"`
        g.fillStyle = '#000'
        g.fillText(text, 4, 44)
        const d = g.getImageData(0, 0, c.width, c.height).data
        let sum = 0
        for (let i = 3; i < d.length; i += 4) sum += d[i]
        out[w] = sum / 255
      }
      return { ...out, loaded: document.fonts.check('600 40px "Segoe UI"') }
    })
    expect(ink.loaded).toBe(true)
    const [regular, semibold, bold] = [ink[400], ink[600], ink[700]]
    expect(regular).toBeLessThan(semibold)
    expect(semibold).toBeLessThan(bold)
    // Power BI's Segoe UI Semibold reads clearly lighter than Bold. By ink, Selawik's own Semibold sits at ≈ 0.64 of the
    // regular → bold range (it read as bold next to bold text); the derived face Lumen bundles sits at ≈ 0.3
    const t = (semibold - regular) / (bold - regular)
    expect(t).toBeGreaterThan(0.15)
    expect(t).toBeLessThan(0.5)
  })
})

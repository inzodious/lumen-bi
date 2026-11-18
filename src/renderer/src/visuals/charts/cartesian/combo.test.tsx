/**
 * Line-and-column combo chart defaults matched against a Power BI render: the line labels sit in light boxes, the
 * legend marks the line series with a circle like the columns, and the secondary axis has its own range (its zero is
 * not lined up with the primary zero unless "Align zeros" is on).
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryEngine } from '../../common/memoryEngine'
import { createMockHost } from '../../common/mockHost'
import { col, msr, props, visualJson } from '../../gallery/registry'
import { getVisual } from '../../registry'
import { COMBO_LINE_LABEL_BG_TRANSPARENCY, legendShapeFor } from './CartesianChart'
import '../index'

const T = 'Visits'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr']
const COUNTS = [40, 55, 62, 48]
// the line is mostly negative: its own axis runs from about 0 down
const CHANGE = [0.01, -0.22, -0.31, -0.12]

function engine() {
  const fact = MONTHS.map((Month, i) => ({ Month, Count: COUNTS[i], Change: CHANGE[i] }))
  return createMemoryEngine({
    factTable: T,
    fact,
    measures: [
      { table: T, name: 'Count', formatString: '0', fn: (rows) => (rows.length ? rows.reduce((a, x) => a + (x.Count as number), 0) : null) },
      { table: T, name: 'Change', formatString: '0.0%', fn: (rows) => (rows.length ? rows.reduce((a, x) => a + (x.Change as number), 0) : null) }
    ]
  })
}

function render(objects: Record<string, any> = {}): string {
  const json = visualJson('v', 'lineClusteredColumnComboChart', { Category: [col(T, 'Month')], Y: [msr(T, 'Count')], Y2: [msr(T, 'Change')] }, { objects })
  const def = getVisual('lineClusteredColumnComboChart')!
  const ctx = createMockHost({ engine: engine() })
  const Comp = def.component
  return renderToStaticMarkup(<Comp visual={{ name: 'v', json }} pageName="p" width={600} height={300} ctx={ctx} />)
}

/** `<g>` groups of data labels: background rect (if any) + text */
function labelGroups(html: string): Array<{ text: string; rect?: string }> {
  const out: Array<{ text: string; rect?: string }> = []
  for (const m of html.matchAll(/<g pointer-events="none"[^>]*>(<rect[^>]*>(?:<\/rect>)?)?<text[^>]*>([^<]*)<\/text><\/g>/g)) out.push({ rect: m[1], text: m[2] })
  return out
}

/** y of an axis tick label */
function tickY(html: string, text: string): number[] {
  return [...html.matchAll(new RegExp(`<text[^>]*\\by="([-\\d.]+)"[^>]*>${text.replace(/[%.]/g, (c) => `\\${c}`)}</text>`, 'g'))].map((m) => Number(m[1]))
}

describe('line and clustered column chart defaults', () => {
  it('line labels get a light background box by default; column labels do not', () => {
    const html = render({ labels: [props({ show: true })] })
    const groups = labelGroups(html)
    const line = groups.filter((g) => /%$/.test(g.text))
    const cols = groups.filter((g) => /^\d+$/.test(g.text))
    expect(line.length).toBeGreaterThan(1)
    expect(cols.length).toBeGreaterThan(0)
    for (const g of line) {
      expect(g.rect).toContain(`fill="rgba(255,255,255,${1 - COMBO_LINE_LABEL_BG_TRANSPARENCY / 100})"`)
      expect(g.rect).toMatch(/stroke="rgba\(255,255,255,0\.9\)"/)
    }
    for (const g of cols) expect(g.rect).toBeUndefined()
  })

  it('an explicit label background setting wins over the combo default', () => {
    const off = labelGroups(render({ labels: [props({ show: true, enableBackground: false })] })).filter((g) => /%$/.test(g.text))
    expect(off.length).toBeGreaterThan(1)
    for (const g of off) expect(g.rect).toBeUndefined()
    const on = labelGroups(render({ labels: [props({ show: true, enableBackground: true, backgroundColor: '#FF0000', backgroundTransparency: 50 })] })).filter((g) => /%$/.test(g.text))
    for (const g of on) {
      expect(g.rect).toContain('fill="rgba(255,0,0,0.5)"')
      expect(g.rect).not.toContain('stroke=')
    }
  })

  it('legend: circles for every series by default; line swatches only when asked for', () => {
    expect(legendShapeFor('line', 'markerCircleDefault')).toBe('circle')
    expect(legendShapeFor('bar', 'lineAndMarker')).toBe('circle')
    expect(legendShapeFor('line', 'lineAndMarker')).toBe('line')
    expect(legendShapeFor('line', 'lineOnly')).toBe('lineOnly')
  })

  it('the secondary axis has its own range: its zero is not lined up with the primary zero unless Align zeros is on', () => {
    const own = render()
    const primaryZero = tickY(own, '0')
    const secondaryZero = tickY(own, '0%')
    expect(primaryZero.length).toBe(1)
    expect(secondaryZero.length).toBe(1)
    // all-negative line: its 0% sits at the top of the plot, the columns' 0 at the bottom
    expect(secondaryZero[0]).toBeLessThan(primaryZero[0] - 100)
    const aligned = render({ valueAxis: [props({ alignZeros: true })] })
    expect(tickY(aligned, '0%')[0]).toBeCloseTo(tickY(aligned, '0')[0], 0)
  })
})

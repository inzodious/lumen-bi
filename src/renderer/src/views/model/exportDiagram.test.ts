import { describe, expect, it } from 'vitest'
import { diagramSvg, type DiagramImageSpec } from './exportDiagram'
import { GROUP_PALETTE } from './groups'

const spec = (): DiagramImageSpec => ({
  name: 'All tables',
  cards: [
    { name: 'Sales & <Returns>', rect: { x: 0, y: 0, width: 200, height: 160 }, collapsed: false, rows: ['Amount', 'Date', null, 'Total "Sales"'] },
    { name: 'Date', rect: { x: 400, y: 40, width: 200, height: 40 }, collapsed: true, rows: ['Date'] }
  ],
  groups: [
    { name: 'Dimensions', color: 'blue', rect: { x: 380, y: 0, width: 240, height: 100 }, collapsed: false, count: 1 },
    { name: 'Hidden', color: 'gray', rect: { x: 700, y: 0, width: 220, height: 40 }, collapsed: true, count: 3 }
  ],
  edges: [{ d: 'M200,80 C300,80 300,60 400,60', inactive: true, from: '*', to: '1', decor: { l1: { x: 214, y: 89 }, l2: { x: 386, y: 69 }, mid: { x: 300, y: 70, angle: -10 } }, both: false, towardTo: false }]
})

describe('diagram image export', () => {
  it('produces a standalone SVG sized to the content with a margin', () => {
    const { svg, width, height } = diagramSvg(spec())
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(width).toBe(920 + 64)
    expect(height).toBe(160 + 64)
    expect(svg).toContain('viewBox="-32 -32 984 224"')
  })

  it('draws containers behind lines behind cards', () => {
    const { svg } = diagramSvg(spec())
    const group = svg.indexOf(GROUP_PALETTE.blue.fill)
    const line = svg.indexOf('M200,80 C300,80 300,60 400,60')
    const cardTitle = svg.indexOf('Sales &amp; &lt;Returns&gt;')
    expect(group).toBeGreaterThan(0)
    expect(line).toBeGreaterThan(group)
    expect(cardTitle).toBeGreaterThan(line)
  })

  it('keeps line styling, markers, collapsed chips and escapes text', () => {
    const { svg } = diagramSvg(spec())
    expect(svg).toContain('stroke-dasharray="6 4"')
    expect(svg).toContain('>*</text>')
    expect(svg).toContain('>1</text>')
    expect(svg).toContain('rotate(170)')
    expect(svg).toContain('Hidden  ·  3 tables')
    expect(svg).toContain('Total &quot;Sales&quot;')
    // a collapsed card shows no field rows
    expect(svg.match(/>Date<\/text>/g)).toHaveLength(2) // the Sales field + the Date card title
  })

  it('handles an empty layout', () => {
    const { width, height } = diagramSvg({ name: 'x', cards: [], groups: [], edges: [] })
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
})

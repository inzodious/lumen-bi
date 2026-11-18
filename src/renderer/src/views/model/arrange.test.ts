import { describe, expect, it } from 'vitest'
import { arrange, classify, components, countCrossings, countOverlaps, resultRects, suggestArrangement, tableInfo, totalLinkLength, type ArrangeInput, type ArrangeLink, type ArrangeTable, type TableInfo } from './arrange'
import type { Rect } from './edges'
import type { TableDef } from '@core/model/types'

const info = (p: Partial<TableInfo> = {}): TableInfo => ({ columns: 6, measures: 0, calculated: false, parameter: false, calcGroup: false, date: false, ...p })
const table = (name: string, height = 200, i?: Partial<TableInfo>): ArrangeTable => ({ name, width: 234, height, info: info(i) })
/** many-to-one relationship many → one */
const rel = (many: string, one: string, both = false): ArrangeLink => ({ from: many, to: one, fromMany: true, toMany: false, both })

/** The "naive grid": every card alphabetically in rows of ceil(sqrt(n)). */
function naiveGrid(input: ArrangeInput): Map<string, Rect> {
  const ts = [...input.tables].sort((a, b) => (a.name < b.name ? -1 : 1))
  const cols = Math.ceil(Math.sqrt(ts.length))
  const m = new Map<string, Rect>()
  ts.forEach((t, i) => m.set(t.name, { x: (i % cols) * 294, y: Math.floor(i / cols) * 360, width: t.width, height: t.height }))
  return m
}

const starModel: ArrangeInput = {
  tables: [
    table('Sales', 300, { columns: 12, measures: 4 }),
    ...['Customer', 'Product', 'Store', 'Calendar', 'Promotion', 'Currency', 'Employee', 'Channel'].map((n) => table(n, n === 'Calendar' ? 300 : 180, n === 'Calendar' ? { date: true } : {})),
    table('Category', 120),
    table('Department', 100),
    table('Region', 120),
    table('Key measures', 160, { columns: 1, measures: 9 }),
    table('Top N', 90, { columns: 1, parameter: true, calculated: true }),
    table('Scratch', 90, { calculated: true })
  ],
  links: [
    ...['Customer', 'Product', 'Store', 'Calendar', 'Promotion', 'Currency', 'Employee', 'Channel'].map((d) => rel('Sales', d)),
    rel('Product', 'Category'),
    rel('Category', 'Department'),
    rel('Store', 'Region'),
    rel('Customer', 'Region')
  ]
}

const multiFact: ArrangeInput = {
  tables: [
    table('Sales', 300, { columns: 10, measures: 3 }),
    table('Returns', 260, { columns: 8, measures: 2 }),
    table('Budget', 220, { columns: 6, measures: 1 }),
    ...['Calendar', 'Product', 'Store', 'Customer', 'Reason', 'Scenario', 'Promotion', 'Account'].map((n) => table(n, 160)),
    table('Brand', 100)
  ],
  links: [
    rel('Sales', 'Calendar'),
    rel('Sales', 'Product'),
    rel('Sales', 'Store'),
    rel('Sales', 'Customer'),
    rel('Sales', 'Promotion'),
    rel('Returns', 'Calendar'),
    rel('Returns', 'Product'),
    rel('Returns', 'Store'),
    rel('Returns', 'Reason'),
    rel('Budget', 'Calendar'),
    rel('Budget', 'Store'),
    rel('Budget', 'Scenario'),
    rel('Budget', 'Account'),
    rel('Product', 'Brand')
  ]
}

/** Deterministic pseudo-random generator (tests must not depend on Math.random). */
function lcg(seed: number): () => number {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

function bigModel(n = 150): ArrangeInput {
  const rnd = lcg(42)
  const tables: ArrangeTable[] = []
  const links: ArrangeLink[] = []
  const facts = 10
  const dims = 100
  for (let f = 0; f < facts; f++) tables.push(table(`F${f}`, 300, { columns: 20, measures: 5 }))
  for (let d = 0; d < dims; d++) tables.push(table(`D${String(d).padStart(3, '0')}`, 80 + Math.floor(rnd() * 220)))
  for (let i = facts + dims; i < n; i++) tables.push(table(`M${i}`, 120, { columns: 1, measures: 5 }))
  for (let f = 0; f < facts; f++) {
    const k = 5 + Math.floor(rnd() * 8)
    const seen = new Set<number>()
    for (let j = 0; j < k; j++) {
      const d = Math.floor(rnd() * dims)
      if (seen.has(d)) continue
      seen.add(d)
      links.push(rel(`F${f}`, `D${String(d).padStart(3, '0')}`))
    }
  }
  // a few snowflakes
  for (let d = 0; d < 20; d++) links.push(rel(`D${String(d).padStart(3, '0')}`, `D${String(d + 50).padStart(3, '0')}`))
  return { tables, links }
}

describe('classify', () => {
  it('finds facts, dimensions, bridges and the kinds of loose tables', () => {
    const k = classify(starModel.tables, starModel.links)
    expect(k.get('Sales')).toBe('fact')
    for (const d of ['Customer', 'Product', 'Calendar', 'Category', 'Department', 'Region']) expect(k.get(d)).toBe('dimension')
    expect(k.get('Key measures')).toBe('measure')
    expect(k.get('Top N')).toBe('parameter')
    expect(k.get('Scratch')).toBe('calculated')
  })

  it('a small many-side table between two dimensions next to a fact is a bridge', () => {
    const tables = [table('Sales', 300, { columns: 10, measures: 2 }), table('Customer'), table('Account'), table('CustomerAccount', 80, { columns: 2 })]
    const links = [rel('Sales', 'Customer'), rel('CustomerAccount', 'Customer', true), rel('CustomerAccount', 'Account')]
    const k = classify(tables, links)
    expect(k.get('Sales')).toBe('fact')
    expect(k.get('CustomerAccount')).toBe('bridge')
    expect(k.get('Account')).toBe('dimension')
  })

  it('a component without a many-side-only table still gets a lead table (one-to-one chains)', () => {
    const tables = [table('A'), table('B'), table('C')]
    const links: ArrangeLink[] = [
      { from: 'A', to: 'B', fromMany: false, toMany: false },
      { from: 'B', to: 'C', fromMany: false, toMany: false }
    ]
    const k = classify(tables, links)
    expect([...k.values()].filter((x) => x === 'fact')).toHaveLength(1)
    expect(k.get('B')).toBe('fact')
  })

  it('reads table facts from the model definition', () => {
    const t = (p: Partial<TableDef>): TableDef => ({ name: 'T', columns: [], measures: [], hierarchies: [], partitions: [], ...p })
    expect(tableInfo(t({ partitions: [{ name: 'p', sourceType: 'calculated', expression: 'GENERATESERIES(1, 10)' }], columns: [{ name: 'Value', kind: 'calculatedTableColumn', dataType: 'int64' } as never] })).parameter).toBe(true)
    expect(tableInfo(t({ dataCategory: 'Time' })).date).toBe(true)
    expect(tableInfo(t({ partitions: [{ name: 'p', sourceType: 'calculated', expression: 'CALENDARAUTO()' }] })).date).toBe(true)
  })

  it('components are found and ordered biggest first', () => {
    expect(components(['A', 'B', 'C', 'D', 'E'], [rel('A', 'B'), rel('C', 'D'), rel('D', 'E')])).toEqual([['C', 'D', 'E'], ['A', 'B']])
  })
})

describe('arrange', () => {
  const check = (input: ArrangeInput, a: 'star' | 'layered' | 'grid') => {
    const r = arrange(input, a)
    const rects = resultRects(input, r)
    expect(rects.size).toBe(input.tables.length)
    expect(countOverlaps(rects)).toBe(0)
    return { r, rects }
  }

  it('suggests star for one fact, layered for many facts, grid without relationships', () => {
    expect(suggestArrangement(starModel)).toBe('star')
    expect(suggestArrangement(bigModel())).toBe('layered')
    expect(suggestArrangement({ tables: [table('A'), table('B')], links: [] })).toBe('grid')
  })

  it('star: the fact sits between its dimensions, snowflakes further out, loose tables in a block at the right', () => {
    const { rects } = check(starModel, 'star')
    const sales = rects.get('Sales')!
    const above = ['Customer', 'Product', 'Store', 'Calendar', 'Promotion', 'Currency', 'Employee', 'Channel'].filter((d) => rects.get(d)!.y + rects.get(d)!.height <= sales.y)
    const below = ['Customer', 'Product', 'Store', 'Calendar', 'Promotion', 'Currency', 'Employee', 'Channel'].filter((d) => rects.get(d)!.y >= sales.y + sales.height)
    expect(above.length + below.length).toBe(8)
    expect(Math.abs(above.length - below.length)).toBeLessThanOrEqual(2)
    // snowflake chain Product → Category → Department goes further out on Product's side
    const p = rects.get('Product')!
    const c = rects.get('Category')!
    const d = rects.get('Department')!
    const out = p.y < sales.y ? -1 : 1
    expect(Math.sign(c.y - p.y)).toBe(out)
    expect(Math.sign(d.y - c.y)).toBe(out)
    // loose tables right of everything connected
    const connectedRight = Math.max(...[...rects].filter(([n]) => !['Key measures', 'Top N', 'Scratch'].includes(n)).map(([, r]) => r.x + r.width))
    for (const n of ['Key measures', 'Top N', 'Scratch']) expect(rects.get(n)!.x).toBeGreaterThan(connectedRight)
  })

  it('beats the naive grid on crossings and line length', () => {
    for (const [input, a] of [
      [starModel, 'star'],
      [starModel, 'layered'],
      [multiFact, 'star'],
      [multiFact, 'layered']
    ] as const) {
      const { rects } = check(input, a)
      const naive = naiveGrid(input)
      const mine = countCrossings(rects, input.links)
      const base = countCrossings(naive, input.links)
      expect(mine, `${a}: ${mine} vs naive ${base}`).toBeLessThan(Math.max(1, base))
      expect(totalLinkLength(rects, input.links)).toBeLessThan(totalLinkLength(naive, input.links))
    }
    if (process.env['LUMEN_ARRANGE_REPORT'])
      for (const [n, input] of [['star', starModel], ['multiFact', multiFact]] as const)
        process.stdout.write(`[arrange] ${n}: ${(['star', 'layered', 'grid'] as const).map((a) => `${a} ${countCrossings(resultRects(input, arrange(input, a)), input.links)}`).join(', ')}, naive ${countCrossings(naiveGrid(input), input.links)}\n`)
    // the plain star has no crossings at all
    expect(countCrossings(resultRects(starModel, arrange(starModel, 'star')), starModel.links)).toBe(0)
  })

  it('layered: dimensions above, facts in the bottom row', () => {
    const { rects } = check(multiFact, 'layered')
    const factsTop = Math.min(...['Sales', 'Returns', 'Budget'].map((f) => rects.get(f)!.y))
    for (const d of ['Calendar', 'Product', 'Store', 'Customer', 'Reason', 'Scenario', 'Promotion', 'Account', 'Brand']) expect(rects.get(d)!.y + rects.get(d)!.height).toBeLessThanOrEqual(factsTop)
    // the snowflaked Brand is above Product
    expect(rects.get('Brand')!.y).toBeLessThan(rects.get('Product')!.y)
  })

  it('star with several facts: a dimension shared by two facts lies between them', () => {
    const { rects } = check(multiFact, 'star')
    const cx = (n: string) => rects.get(n)!.x + rects.get(n)!.width / 2
    // Product is shared by Sales and Returns only: nearer the middle of those two than to Budget
    const mid = (cx('Sales') + cx('Returns')) / 2
    expect(Math.abs(cx('Product') - mid)).toBeLessThan(Math.abs(cx('Product') - cx('Budget')))
    // Calendar and Store are shared by all three facts: within the facts' span
    const lo = Math.min(cx('Sales'), cx('Returns'), cx('Budget'))
    const hi = Math.max(cx('Sales'), cx('Returns'), cx('Budget'))
    for (const d of ['Calendar', 'Store']) {
      expect(cx(d)).toBeGreaterThanOrEqual(lo - 1)
      expect(cx(d)).toBeLessThanOrEqual(hi + 1)
    }
  })

  it('compact grid: groups first, then alphabetical, no overlaps', () => {
    const input: ArrangeInput = { ...starModel, groups: [{ id: 'g1', name: 'Geo', tables: ['Store', 'Region'] }] }
    const { rects } = check(input, 'grid')
    const others = [...rects].filter(([n]) => n !== 'Store' && n !== 'Region').sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x)
    expect(others[0][0]).toBe('Calendar')
    // the group's members are the first unit (top-left)
    expect(Math.min(rects.get('Store')!.x, rects.get('Region')!.x) - 16).toBe(0)
    expect(Math.min(rects.get('Store')!.y, rects.get('Region')!.y) - 34).toBe(0)
  })

  it('keeps groups together as one unit, inside the container padding, in every arrangement', () => {
    const input: ArrangeInput = { ...starModel, groups: [{ id: 'g1', name: 'Product family', tables: ['Product', 'Category', 'Department'] }] }
    for (const a of ['star', 'layered', 'grid'] as const) {
      const { rects } = check(input, a)
      const members = ['Product', 'Category', 'Department'].map((n) => rects.get(n)!)
      const box = { x0: Math.min(...members.map((r) => r.x)) - 16, y0: Math.min(...members.map((r) => r.y)) - 34, x1: Math.max(...members.map((r) => r.x + r.width)) + 16, y1: Math.max(...members.map((r) => r.y + r.height)) + 16 }
      // no other card inside the container
      for (const [n, r] of rects) {
        if (members.includes(r)) continue
        const inside = r.x < box.x1 && r.x + r.width > box.x0 && r.y < box.y1 && r.y + r.height > box.y0
        expect(inside, `${a}: ${n} inside the group`).toBe(false)
      }
    }
  })

  it('a collapsed group takes the room of its chip', () => {
    const input: ArrangeInput = { ...starModel, groups: [{ id: 'g1', name: 'Geo', tables: ['Store', 'Region'], collapsed: true }] }
    const r = arrange(input, 'star')
    const visible = resultRects({ ...input, tables: input.tables.filter((t) => t.name !== 'Store' && t.name !== 'Region') }, r)
    const s = r.positions.get('Store')!
    const g = r.positions.get('Region')!
    // chip at the container's top-left (16 / 34 before the first member)
    const chip = { x: Math.min(s.x, g.x) - 16, y: Math.min(s.y, g.y) - 34, width: 220, height: 40 }
    visible.set('chip', chip)
    expect(countOverlaps(visible)).toBe(0)
  })

  it('respects card sizes (collapsed cards are short)', () => {
    const short = { ...starModel, tables: starModel.tables.map((t) => ({ ...t, height: 40 })) }
    const tall = arrange(starModel, 'star')
    const flat = arrange(short, 'star')
    const h = (inp: ArrangeInput, r: ReturnType<typeof arrange>) => Math.max(...[...resultRects(inp, r).values()].map((x) => x.y + x.height))
    expect(h(short, flat)).toBeLessThan(h(starModel, tall))
    expect(countOverlaps(resultRects(short, flat))).toBe(0)
  })

  it('is deterministic and independent of the input order', () => {
    const a = arrange(multiFact, 'star')
    const b = arrange({ tables: [...multiFact.tables].reverse(), links: [...multiFact.links].reverse() }, 'star')
    expect([...b.positions].sort()).toEqual([...a.positions].sort())
  })

  it('handles 150 tables quickly with fewer crossings than the naive grid', () => {
    const input = bigModel()
    for (const a of ['star', 'layered', 'grid'] as const) {
      const t0 = performance.now()
      const r = arrange(input, a)
      const ms = performance.now() - t0
      const rects = resultRects(input, r)
      expect(countOverlaps(rects)).toBe(0)
      expect(ms).toBeLessThan(500)
      if (a !== 'grid') expect(countCrossings(rects, input.links)).toBeLessThan(countCrossings(naiveGrid(input), input.links))
      // reported in the arrangement summary of the work log
      if (process.env['LUMEN_ARRANGE_REPORT']) process.stdout.write(`[arrange] 150 tables ${a}: ${ms.toFixed(1)} ms, crossings ${countCrossings(rects, input.links)} (naive grid ${countCrossings(naiveGrid(input), input.links)})\n`)
    }
  })

  it('ignores self-references and relationships to tables that are not in the diagram', () => {
    const r = arrange({ tables: [table('A'), table('B')], links: [rel('A', 'A'), rel('A', 'Z'), rel('A', 'B')] }, 'star')
    expect(r.positions.size).toBe(2)
  })
})

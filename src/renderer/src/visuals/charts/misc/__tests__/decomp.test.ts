import { describe, expect, it } from 'vitest'
import { createEngine } from '@core/engine/engine'
import { columnExpr, identitiesToFilter, measureExpr } from '@core/report/sq'
import { createMockHost } from '../../../common/mockHost'
import { buildSampleModel } from '../../../gallery/sampleData'
import { col, msr, visualJson } from '../../../gallery/registry'
import { addLevel, barFraction, chooseAiSplit, readDecompState, removeLevel, revertAi, selectPathNode, setLocked, writeDecompState, type DecompState } from '../decomp/state'
import { computeTree, splitCandidates, treeTable } from '../decomp/query'

const ids = (r: string) => columnExpr(r.split('.')[0], r.split('.')[1])

function treeJson(explain: string[]) {
  return visualJson('t', 'decompositionTreeVisual', { Analyze: [msr('Sales', 'Total Sales')], ExplainBy: explain.map((c) => col('Sales', c)) })
}

describe('decomposition tree expansion state (PBIR expansionStates)', () => {
  const state: DecompState = {
    levels: [{ queryRef: 'Sales.Region', locked: true }, { queryRef: 'Sales.Category' }, { queryRef: 'Sales.Channel', ai: 'MaxSplit' }],
    path: ['Europe', 'Bikes']
  }

  it('writes the PBIR shape and reads it back', () => {
    const j = treeJson(['Region', 'Category', 'Channel'])
    writeDecompState(j, state, ids)
    const es = j.visual.expansionStates
    expect(es).toHaveLength(1)
    expect(es[0].roles).toEqual(['ExplainBy'])
    expect(es[0].levels[0]).toEqual({ queryRefs: ['Sales.Region'], isCollapsed: true, identityKeys: [columnExpr('Sales', 'Region')], isPinned: true, isLocked: true })
    expect(es[0].levels[2].AIInformation).toEqual({ method: 'MaxSplit' })
    expect(es[0].root.isToggled).toBe(true)
    expect(es[0].root.children[0].identityValues).toEqual([{ Literal: { Value: "'Europe'" } }])
    expect(es[0].root.children[0].children[0].identityValues).toEqual([{ Literal: { Value: "'Bikes'" } }])
    expect(readDecompState(j, ['Sales.Region', 'Sales.Category', 'Sales.Channel'])).toEqual(state)
  })

  it('keeps other roles, removes its entry when empty', () => {
    const j = treeJson(['Region'])
    j.visual.expansionStates = [{ roles: ['Rows'], levels: [{ queryRefs: ['x'] }] }]
    writeDecompState(j, state, ids)
    expect(j.visual.expansionStates).toHaveLength(2)
    writeDecompState(j, { levels: [], path: [] }, ids)
    expect(j.visual.expansionStates).toEqual([{ roles: ['Rows'], levels: [{ queryRefs: ['x'] }] }])
  })

  it('truncates at a removed field, reads BestSplit as MaxSplit and ignores disabled AI', () => {
    const j = treeJson(['Region'])
    j.visual.expansionStates = [
      {
        roles: ['ExplainBy'],
        levels: [{ queryRefs: ['Sales.Region'], AIInformation: { method: 'BestSplit' } }, { queryRefs: ['Sales.Gone'] }, { queryRefs: ['Sales.Region'] }],
        root: { isToggled: true }
      }
    ]
    expect(readDecompState(j, ['Sales.Region']).levels).toEqual([{ queryRef: 'Sales.Region', ai: 'MaxSplit' }])
    j.visual.expansionStates[0].levels[0].AIInformation.disabled = true
    expect(readDecompState(j, ['Sales.Region']).levels).toEqual([{ queryRef: 'Sales.Region' }])
  })

  it('adds levels: deeper levels are replaced; a manual split freezes preceding AI levels', () => {
    const s1 = addLevel({ levels: [], path: [] }, -1, undefined, { queryRef: 'Sales.Region' })
    expect(s1).toEqual({ levels: [{ queryRef: 'Sales.Region' }], path: [] })
    const s2 = addLevel(s1, 0, 'Europe', { queryRef: 'Sales.Category', ai: 'MaxSplit' })
    expect(s2.path).toEqual(['Europe'])
    const s3 = addLevel(s2, 1, 'Bikes', { queryRef: 'Sales.Channel' }, ['Sales.Region', 'Sales.Segment'])
    expect(s3.levels).toEqual([{ queryRef: 'Sales.Region' }, { queryRef: 'Sales.Segment' }, { queryRef: 'Sales.Channel' }])
    expect(s3.path).toEqual(['Europe', 'Bikes'])
    const s4 = addLevel(s2, 1, 'Bikes', { queryRef: 'Sales.Channel', ai: 'MinSplit' })
    expect(s4.levels[1].ai).toBe('MaxSplit')
    // splitting an earlier node replaces everything after it
    const s5 = addLevel(s3, 0, 'Pacific', { queryRef: 'Sales.Channel' })
    expect(s5).toEqual({ levels: [{ queryRef: 'Sales.Region' }, { queryRef: 'Sales.Channel' }], path: ['Pacific'] })
  })

  it('removes, moves the path, locks and reverts AI', () => {
    expect(removeLevel(state, 0)).toBe(state) // level 0 is locked
    const unlocked = setLocked(state, 0, false)
    expect(unlocked.levels.some((l) => l.locked)).toBe(false)
    expect(removeLevel(unlocked, 1)).toEqual({ levels: [{ queryRef: 'Sales.Region' }], path: [] })
    expect(removeLevel(unlocked, 2)).toEqual({ levels: unlocked.levels.slice(0, 2), path: ['Europe'] })
    expect(selectPathNode(unlocked, 0, 'Pacific').path).toEqual(['Pacific'])
    expect(selectPathNode({ ...unlocked, path: [] }, 1, 'Bikes').path).toEqual([undefined, 'Bikes'])
    expect(selectPathNode(unlocked, 2, 'Online')).toBe(unlocked) // last level: selection, not path
    const locked = setLocked(unlocked, 1, true)
    expect(locked.levels.map((l) => !!l.locked)).toEqual([true, true, false])
    expect(setLocked(locked, 0, false).levels.map((l) => !!l.locked)).toEqual([false, false, false])
    expect(revertAi(unlocked, 2, 'Sales.Segment').levels[2]).toEqual({ queryRef: 'Sales.Segment' })
  })

  it('refuses to remove locked levels', () => {
    const s = setLocked(state, 1, true)
    expect(removeLevel(s, 1)).toBe(s)
    expect(removeLevel(s, 2).levels).toHaveLength(2)
  })
})

describe('AI splits', () => {
  const cands = [
    { key: 'A', values: [10, 9, 1] },
    { key: 'B', values: [12, 0.5] },
    { key: 'C', values: [] }
  ]
  it('absolute: High picks the field with the highest node, Low the lowest', () => {
    expect(chooseAiSplit(cands, 'MaxSplit', 'absolute')).toEqual({ index: 1, node: 0, score: 12 })
    expect(chooseAiSplit(cands, 'MinSplit', 'absolute')).toEqual({ index: 1, node: 1, score: 0.5 })
  })
  it('relative: value / |average of the column| (Microsoft Learn example)', () => {
    // a single value is 1x its own average; a value 4.25x the column average wins although it is smaller
    const genre = [19.55, 11.14, 5, 4, 3, 2, 1.5, 0.8, 0.47, 0.06].map((x) => x * 1e6)
    const platform = [46.95e6]
    const r = chooseAiSplit(
      [
        { key: 'Platform', values: platform },
        { key: 'Genre', values: genre }
      ],
      'MaxSplit',
      'relative'
    )
    expect(r?.index).toBe(1)
    expect(r?.node).toBe(0)
    expect(r?.score).toBeCloseTo(19.55 / (genre.reduce((a, b) => a + b, 0) / 10 / 1e6), 6)
  })
  it('skips blank values, keeps the first on ties, null without data', () => {
    expect(chooseAiSplit([{ key: 'A', values: [NaN, 5] }, { key: 'B', values: [5] }], 'MaxSplit', 'absolute')).toEqual({ index: 0, node: 1, score: 5 })
    expect(chooseAiSplit([{ key: 'A', values: [] }], 'MaxSplit', 'absolute')).toBeNull()
  })
})

describe('bar scaling', () => {
  const ref = { root: 200, parent: 50, levelMax: 40 }
  it('level maximum (default), parent and top node', () => {
    expect(barFraction(20, 'levelMaximum', ref)).toBe(0.5)
    expect(barFraction(20, 'parentNode', ref)).toBe(0.4)
    expect(barFraction(20, 'topNode', ref)).toBe(0.1)
    expect(barFraction(-20, 'levelMaximum', ref)).toBe(0.5)
    expect(barFraction(80, 'parentNode', ref)).toBe(1)
    expect(barFraction(null, 'levelMaximum', ref)).toBe(0)
    expect(barFraction(5, 'parentNode', { root: 0, parent: 0, levelMax: 10 })).toBe(0.5)
  })
})

describe('computeTree (DAX engine, sample model)', () => {
  const { model, data } = buildSampleModel()
  const engine = createEngine(model, data)
  engine.processCalculated()
  const ctx = createMockHost({ engine })
  const total = (filters: any[] = []) => engine.summarize({ groupBy: [], values: [{ id: 'v', expr: { kind: 'sq', expr: measureExpr('Sales', 'Total Sales') } }], filters }).rows[0][0] as number

  it('returns null without Analyze and a root-only tree without expansion', () => {
    expect(computeTree(visualJson('t', 'decompositionTreeVisual', {}), ctx, { aiEnabled: true, aiMode: 'absolute' })).toBeNull()
    const t = computeTree(treeJson(['Region', 'Category']), ctx, { aiEnabled: true, aiMode: 'absolute' })!
    expect(t.total).toBeCloseTo(total(), 6)
    expect(t.columns).toEqual([])
    expect(splitCandidates(t, -1).map((f) => f.label)).toEqual(['Region', 'Category'])
  })

  it('splits along the expanded path, nodes sorted by value', () => {
    const j = treeJson(['Region', 'Category', 'Channel'])
    writeDecompState(j, { levels: [{ queryRef: 'Sales.Region' }, { queryRef: 'Sales.Category' }], path: ['Europe'] }, ids)
    const t = computeTree(j, ctx, { aiEnabled: true, aiMode: 'absolute' })!
    expect(t.columns).toHaveLength(2)
    const [regions, cats] = t.columns
    const vals = regions.nodes.map((n) => n.measure!)
    expect([...vals].sort((a, b) => b - a)).toEqual(vals)
    expect(vals.reduce((a, b) => a + b, 0)).toBeCloseTo(t.total!, 4)
    expect(regions.nodes[regions.pathIndex].value).toBe('Europe')
    const europe = total([identitiesToFilter([{ fields: [{ expr: columnExpr('Sales', 'Region'), value: 'Europe' }] }])!])
    expect(cats.parentValue).toBeCloseTo(europe, 4)
    expect(cats.nodes.reduce((a, n) => a + n.measure!, 0)).toBeCloseTo(europe, 4)
    expect(cats.nodes[0].identity.fields.map((f) => f.value)).toEqual(['Europe', cats.nodes[0].value])
    expect(cats.pathIndex).toBe(-1)
    expect(splitCandidates(t, 1).map((f) => f.label)).toEqual(['Channel'])
    const table = treeTable(t)
    expect(table.columns).toEqual(['Region', 'Category', 'Total Sales'])
    expect(table.rows[0][0]).toBe('Europe')
  })

  it('stops at a path node that no longer exists (levels stay pinned)', () => {
    const j = treeJson(['Region', 'Category'])
    writeDecompState(j, { levels: [{ queryRef: 'Sales.Region' }, { queryRef: 'Sales.Category' }], path: ['Atlantis'] }, ids)
    const t = computeTree(j, ctx, { aiEnabled: true, aiMode: 'absolute' })!
    expect(t.columns).toHaveLength(1)
    expect(t.state.levels).toHaveLength(2)
  })

  it('AI level picks the field whose best node is highest (brute force check) and follows it', () => {
    const j = treeJson(['Region', 'Category', 'Channel', 'Segment'])
    writeDecompState(j, { levels: [{ queryRef: 'Sales.Region' }, { queryRef: 'Sales.Channel', ai: 'MaxSplit' }, { queryRef: 'Sales.Segment', ai: 'MinSplit' }], path: ['Pacific'] }, ids)
    const t = computeTree(j, ctx, { aiEnabled: true, aiMode: 'absolute' })!
    const pac = identitiesToFilter([{ fields: [{ expr: columnExpr('Sales', 'Region'), value: 'Pacific' }] }])!
    const best = ['Category', 'Channel', 'Segment']
      .map((c) => ({ c, max: Math.max(...engine.summarize({ groupBy: [{ table: 'Sales', column: c }], values: [{ id: 'v', expr: { kind: 'sq', expr: measureExpr('Sales', 'Total Sales') } }], filters: [pac] }).rows.map((r) => r[1] as number)) }))
      .sort((a, b) => b.max - a.max)[0]
    expect(t.columns[1].field.label).toBe(best.c)
    expect(t.columns[1].nodes[t.columns[1].aiNode!].measure).toBeCloseTo(best.max, 4)
    expect(t.columns[1].pathIndex).toBe(t.columns[1].aiNode)
    // the Low value level comes after, under the recommended node, and uses another field
    expect(t.columns).toHaveLength(3)
    expect(t.resolved[2]).not.toBe(t.resolved[1])
    const low = t.columns[2]
    expect(low.nodes[low.aiNode!].measure).toBe(Math.min(...low.nodes.map((n) => n.measure!)))
    // AI disabled: the stored fields are used as plain levels
    const plain = computeTree(j, ctx, { aiEnabled: false, aiMode: 'absolute' })!
    expect(plain.resolved).toEqual(['Sales.Region', 'Sales.Channel'])
  })

  it('applies the visual filter context', () => {
    const f = identitiesToFilter([{ fields: [{ expr: columnExpr('Sales', 'Channel'), value: 'Online' }] }])!
    const t = computeTree(treeJson(['Region']), createMockHost({ engine, filters: [f] }), { aiEnabled: true, aiMode: 'absolute' })!
    expect(t.total).toBeCloseTo(total([f]), 4)
  })
})

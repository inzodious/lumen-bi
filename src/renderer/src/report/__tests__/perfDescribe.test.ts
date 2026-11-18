import { describe as describeQuery } from '../perf'

describe('Performance analyzer "Copy query" text', () => {
  it('uses the engine DAX form for visual queries', () => {
    const dax = '// DAX Query\nEVALUATE SUMMARIZECOLUMNS(\'Product\'[Category], "Sales", [Total Sales])'
    const engine = { toDaxQuery: () => dax } as any
    // the engine's text already carries the header: not duplicated
    expect(describeQuery('summarize', [{ groupBy: [], values: [] }], engine)).toBe(dax)
  })
  it('uses the engine visual-calculation DAX form (PBI Performance analyzer shape)', () => {
    const dax = "// DAX Query\nDEFINE\n\tCOLUMN '__DS0VisualCalcs'[Running] = RUNNINGSUM([Sales])\nEVALUATE ..."
    const req = { visualCalcs: [] }
    const engine = { toVisualCalcDaxQuery: (r: unknown) => (r === req ? dax : '') } as any
    expect(describeQuery('evaluateVisualCalculations', [req], engine)).toBe(dax)
    // without the engine form: request JSON fallback
    expect(describeQuery('evaluateVisualCalculations', [req], {} as any)).toContain('// evaluateVisualCalculations')
  })
  it('passes DAX queries through and wraps scalar expressions', () => {
    expect(describeQuery('runDaxQuery', ['EVALUATE Sales'])).toBe('// DAX Query\nEVALUATE Sales')
    expect(describeQuery('evaluateScalar', ['[Total Sales]'])).toBe('// DAX Query\nEVALUATE { [Total Sales] }')
  })
  it('falls back to the request JSON when the engine has no DAX form', () => {
    expect(describeQuery('summarize', [{ groupBy: [] }], {} as any)).toContain('// summarize')
  })
})

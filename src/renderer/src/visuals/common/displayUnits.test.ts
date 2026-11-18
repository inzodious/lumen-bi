
describe('format-string scaling with display units None', () => {
  it('keeps ",," scaling when a precision override is applied and units are None', async () => {
    const { formatWithUnits } = await import('./displayUnits')
    const { formatValue } = await import('@core/engine/format')
    const text = formatWithUnits(4_312_345.6, formatValue, { formatString: '$#,##0,,.0M', units: 1, precision: 1, dataType: 'double' })
    expect(text).toBe('$4.3M')
  })
})

describe('negative format sections', () => {
  it('uses the negative section with display units, like PBI axes ("($0.2M)")', async () => {
    const { formatWithUnits } = await import('./units')
    expect(formatWithUnits(-200000, { unit: 1e6, decimals: 1, formatString: '\\$#,0;(\\$#,0);\\$#,0' })).toBe('($0.2M)')
    expect(formatWithUnits(200000, { unit: 1e6, decimals: 1, formatString: '\\$#,0;(\\$#,0);\\$#,0' })).toBe('$0.2M')
    expect(formatWithUnits(-1234, { unit: 1, decimals: 0, formatString: '#,0;(#,0)' })).toBe('(1,234)')
    // no negative section: leading minus before the prefix
    expect(formatWithUnits(-2500, { unit: 1e3, decimals: 1, formatString: '\\$#,0' })).toBe('-$2.5K')
    expect(formatWithUnits(-0.25, { unit: 1, decimals: 0, formatString: '0%' })).toBe('-25%')
  })
})

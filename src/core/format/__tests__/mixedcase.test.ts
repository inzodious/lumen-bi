import { formatValue } from '../index'

const aug = new Date(Date.UTC(2026, 7, 31, 14, 5, 0))

describe('mixed-case month tokens (PBI models use e.g. "Mmm yy")', () => {
  it.each([
    ['Mmm yy', 'Aug 26'],
    ['Mmmm yyyy', 'August 2026'],
    ['mmm yy', 'Aug 26'],
    ['MMM d, yyyy', 'Aug 31, 2026'],
    ['M/d/yyyy', '8/31/2026'],
    ['hh:mm', '14:05']
  ])('%s', (fmt, expected) => {
    expect(formatValue(aug, fmt)).toBe(expected)
  })
})

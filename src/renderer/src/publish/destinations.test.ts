import { describe, expect, it } from 'vitest'
import { normalizeSite, slugify } from './destinations'

describe('site names', () => {
  it('matches the main-process rule', () => {
    expect(slugify('Sales & Customers — 2025')).toBe('sales-customers-2025')
    expect(normalizeSite('netlify', 'My Sales/Report')).toBe('my-sales-report')
    expect(normalizeSite('github-pages', ' Team A / Sales Q1 /')).toBe('team-a/sales-q1')
    expect(normalizeSite('s3', '')).toBe('')
  })
})

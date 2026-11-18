import { describe, expect, it } from 'vitest'
import { cachedTranspile, transpileJsx } from './transpile'

describe('code visual: JSX transpile', () => {
  it('turns JSX and type annotations into CommonJS that requires react', async () => {
    const src = `import { useState } from 'react'
export default function Visual({ rows }: { rows: any[] }) {
  const [n] = useState<number>(3)
  return <ul>{rows.slice(0, n).map((r) => <li key={r.key}>{r.label}</li>)}</ul>
}`
    const r = await transpileJsx(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.code).toContain("require('react')")
    expect(r.code).toContain('React.createElement')
    expect(r.code).not.toContain(': { rows')
    expect(cachedTranspile(src)).toBe(r)
  })

  it('keeps line numbers, so runtime errors map to the author source', async () => {
    const src = `export default function Visual() {\n  const a = 1\n\n  return <div>\n    {missing.value}\n  </div>\n}`
    const r = await transpileJsx(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lines = r.code.split('\n')
    const at = lines.findIndex((l) => l.includes('missing.value'))
    expect(at + 1).toBe(5)
  })

  it('reports syntax errors with a 1-based line and column', async () => {
    const r = await transpileJsx(`export default function Visual() {\n  return <div>\n    <span>unclosed\n  </div>\n}`)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.line).toBeGreaterThanOrEqual(3)
    expect(r.column).toBeGreaterThanOrEqual(1)
    expect(r.message).not.toMatch(/\(\d+:\d+\)$/)
  })
})

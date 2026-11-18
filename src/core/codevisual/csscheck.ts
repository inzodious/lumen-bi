/**
 * Code visual: checks of the author's stylesheet that the browser would not report (Chromium's CSS parser recovers
 * silently): unbalanced braces, unclosed comments and strings are errors with line and column; remote resources
 * (`@import`, `url(http…)`), which the frame's Content-Security-Policy blocks, are warnings.
 */

export interface CssIssue {
  severity: 'error' | 'warning'
  message: string
  line: number
  column: number
}

export function checkCss(css: string): CssIssue[] {
  const issues: CssIssue[] = []
  let line = 1
  let col = 1
  const stack: Array<{ line: number; column: number }> = []
  let i = 0
  const n = css.length
  const advance = (c: string) => {
    if (c === '\n') {
      line++
      col = 1
    } else col++
  }
  while (i < n) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const at = { line, column: col }
      const end = css.indexOf('*/', i + 2)
      if (end < 0) {
        issues.push({ severity: 'error', message: 'Unclosed comment /*', ...at })
        return issues
      }
      for (; i < end + 2; i++) advance(css[i])
      continue
    }
    if (c === '"' || c === "'") {
      const at = { line, column: col }
      advance(c)
      i++
      let closed = false
      while (i < n) {
        const d = css[i]
        if (d === '\\') {
          advance(d)
          i++
          if (i < n) advance(css[i])
          i++
          continue
        }
        if (d === '\n') break
        advance(d)
        i++
        if (d === c) {
          closed = true
          break
        }
      }
      if (!closed) issues.push({ severity: 'error', message: 'Unclosed string', ...at })
      continue
    }
    if (c === '{') stack.push({ line, column: col })
    else if (c === '}') {
      if (!stack.pop()) issues.push({ severity: 'error', message: 'Unexpected }', line, column: col })
    }
    advance(c)
    i++
  }
  for (const s of stack) issues.push({ severity: 'error', message: '{ is never closed', ...s })
  // remote resources (blocked in the frame)
  const re = /@import\b|url\(\s*["']?\s*(?:https?:|\/\/|ftp:|file:)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const before = css.slice(0, m.index)
    const l = before.split('\n').length
    const c2 = m.index - before.lastIndexOf('\n')
    issues.push({ severity: 'warning', message: m[0].startsWith('@') ? '@import is blocked: code visuals cannot load remote stylesheets' : 'Remote URLs are blocked: use a data: URI or a registered image (resource "name")', line: l, column: c2 })
  }
  return issues
}

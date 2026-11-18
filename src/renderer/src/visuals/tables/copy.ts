/**
 * "Copy value" / "Copy selection" for tables and matrices (Ctrl+C on a focused visual).
 * Power BI copies formatted cell text; multi-cell selections paste as tab-separated rows with the
 * column headers on top (Excel-friendly).
 */

/** Escape one TSV field (quotes when the text contains tabs, newlines or quotes). */
export function tsvField(s: string): string {
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toTsv(headers: string[] | undefined, rows: string[][]): string {
  const lines = [...(headers ? [headers] : []), ...rows].map((r) => r.map(tsvField).join('\t'))
  return lines.join('\n')
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to execCommand */
  }
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

/** Is this keyboard event a copy shortcut (Ctrl/Cmd+C)? */
export function isCopyKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')
}

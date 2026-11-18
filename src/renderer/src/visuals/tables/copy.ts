/**
 * "Copy value" / "Copy selection" for tables and matrices (Ctrl+C on a focused visual).
 * Multi-cell selections paste as formatted text, tab-separated rows with the column headers on top
 * (Excel-friendly). Copy ▸ Copy value copies the cell's data value: Learn — "Power BI copies only the data value
 * in the cell. It doesn't copy any formatting applied to the cell value."
 */
import type { Scalar } from '@core/model/data'

/** Text of Copy ▸ Copy value for a cell: numbers unformatted (full precision), everything else as displayed. */
export function copyValueText(cell: { value: Scalar; text: string }): string {
  return typeof cell.value === 'number' && Number.isFinite(cell.value) ? String(cell.value) : cell.text
}

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

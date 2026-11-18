/**
 * Recent files list (start screen + backstage Open). Reads window.wbi.app.getRecent().
 */
import { useEffect, useState } from 'react'
import { DocumentRegular, FolderRegular, ArchiveRegular } from '@fluentui/react-icons'
import { openPath } from './commands'
import { showContextMenu } from './ui/Menu'

export interface RecentItem {
  path: string
  name: string
  openedAt: number
}

export function useRecent(): RecentItem[] | null {
  const [items, setItems] = useState<RecentItem[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = window.wbi?.app.getRecent() ?? Promise.resolve([])
    load.then((r) => alive && setItems(r)).catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [])
  return items
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'Just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function iconFor(path: string) {
  if (/\.wbi$/i.test(path)) return <ArchiveRegular fontSize={20} />
  if (/\.(Report|SemanticModel)\/?$/i.test(path)) return <FolderRegular fontSize={20} />
  return <DocumentRegular fontSize={20} />
}

export function RecentList({ limit = 12, emptyText = 'Reports you open will show up here.' }: { limit?: number; emptyText?: string }) {
  const items = useRecent()
  if (!items) return null
  if (!items.length) return <div className="wbi-recent__empty">{emptyText}</div>
  return (
    <div className="wbi-recent" role="list">
      <div className="wbi-recent__head">
        <span>Name</span>
        <span>Opened</span>
      </div>
      {items.slice(0, limit).map((r) => (
        <button
          key={r.path}
          role="listitem"
          type="button"
          className="wbi-recent__row"
          title={r.path}
          onClick={() => void openPath(r.path)}
          onContextMenu={(e) =>
            showContextMenu(e, [
              { label: 'Open', onClick: () => void openPath(r.path) },
              { label: 'Show in folder', onClick: () => void window.wbi.app.showItemInFolder(r.path) },
              { label: 'Copy path', onClick: () => void navigator.clipboard.writeText(r.path) }
            ])
          }
        >
          <span className="wbi-recent__icon">{iconFor(r.path)}</span>
          <span className="wbi-recent__name">
            <span className="wbi-recent__title">{r.name}</span>
            <span className="wbi-recent__path">{r.path}</span>
          </span>
          <span className="wbi-recent__time">{relativeTime(r.openedAt)}</span>
        </button>
      ))}
    </div>
  )
}
